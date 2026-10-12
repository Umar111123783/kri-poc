"""Domain services.

`simulate_run` and `build_plan` are the two places where a real agent would
plug in (Azure OpenAI / AI Foundry). They currently reproduce the prototype
behaviour deterministically enough for a demo.
"""
from __future__ import annotations

import random
import re
from datetime import date, datetime, timezone

from .models import AuditException, Kri, PlanStep, PlannerItem, Run, RunRequest, RunResult
from .store import Store

# The prototype pins "today" so that scheduled dates in the sample data stay
# meaningful. Set DEMO_TODAY=off (see main.py) to use the real clock.
DEMO_TODAY = date(2026, 9, 16)

PRIOR_WORK = [
    {"audit": "Order Intake – Q2 FY26", "policy": "v4.1", "steps": 14, "date": "Jul 2026"},
    {"audit": "Order Intake – Q1 FY26", "policy": "v4.0", "steps": 14, "date": "Apr 2026"},
    {"audit": "Order Intake – Q4 FY25", "policy": "v4.0", "steps": 15, "date": "Jan 2026"},
]


def _next_number(ids: list[str], prefix: str, start: int) -> int:
    nums = [int(m.group(1)) for i in ids if (m := re.match(rf"{prefix}-?0*(\d+)$", i))]
    return max(nums, default=start - 1) + 1


def next_run_id(store: Store) -> str:
    return f"R-{_next_number([r.id for r in store.runs], 'R', 920):04d}"


def next_exception_id(store: Store) -> str:
    return f"X-{_next_number([e.id for e in store.exceptions], 'X', 1100)}"


def next_planner_id(store: Store) -> str:
    return f"PL-{_next_number([p.id for p in store.planner], 'PL', 19):03d}"


def today_iso() -> str:
    return DEMO_TODAY.isoformat()


def simulate_run(store: Store, kri: Kri, req: RunRequest) -> RunResult:
    """Pretend to execute the KRI: pick 1–2 sample exceptions for it and size a population."""
    pool = store.seed_exceptions_for(kri.id)
    take = 1 + random.randint(0, min(1, len(pool) - 1))
    picked = pool[:take]

    # Query real SQLite tables if available
    real_pop = 0
    try:
        from .database import get_connection

        conn = get_connection()
        if "P2P" in kri.id or "PO" in kri.id or "S2P" in kri.id:
            real_pop = conn.execute("SELECT COUNT(*) FROM purchase_orders").fetchone()[0]
        elif "OI" in kri.id or "OBL" in kri.id:
            real_pop = conn.execute("SELECT COUNT(*) FROM order_intake").fetchone()[0]
        conn.close()
    except Exception:
        pass

    if real_pop > 0:
        population = max(real_pop, len(picked) + 1)
    else:
        population = round((40 + random.random() * 200) * (req.sampling / 100))
        population = max(population, len(picked) + 1)

    run_id = next_run_id(store)
    fresh: list[AuditException] = []
    base_no = _next_number([e.id for e in store.exceptions], "X", 1100)
    for n, src in enumerate(picked):
        data = {**src}
        data.update(
            id=f"X-{base_no + n}",
            runId=run_id,
            kriId=kri.id,
            status="open",
            region=src["region"] if req.region == "All regions" else req.region,
            summary=f"{src['summary']} (ad hoc run for {req.period})",
        )
        fresh.append(AuditException(**data))

    run = Run(
        id=run_id,
        kriId=kri.id,
        trigger="Ad hoc",
        period=req.period,
        startedAt=datetime.now(timezone.utc).isoformat(),
        duration=f"{4 + random.randint(0, 8)} min",
        status="Complete",
        population=population,
        tested=population,
        exceptions=len(fresh),
        explainable=sum(1 for e in fresh if e.classification == "explainable"),
        unexplained=sum(1 for e in fresh if e.classification == "unexplained"),
    )
    return RunResult(run=run, exceptions=fresh)


def build_plan(policy_id: str) -> list[PlanStep]:
    using_old = policy_id == "v3.2"
    return [
        PlanStep(step="Confirm scope: WBS family N.10871.* (4 WBSs), P7–P8, BG-A business group.", status="new", note="Derived from the KRI trigger; not in the generic checklist."),
        PlanStep(step="Obtain the CPO and any revised CPO / change orders from the account manager.", status="kept", note="Standard step, unchanged."),
        PlanStep(
            step="Reconcile each reversal to a customer document; a scope change must leave a reduced OI, not zero.",
            status="updated",
            note="v3.2 has no scope-change rule – step written against v4.1 §4.3 anyway." if using_old else "Updated to policy v4.1 §4.3 (scope changes).",
        ),
        PlanStep(step="Confirm revenue true-up for every reversal where revenue was already recognised.", status="new", note="Not a legacy step; added because OI-02 found a broken OI → revenue link."),
        PlanStep(step="Interview the accepting manager (AM-104) on the period-end timing of the six reversals.", status="new", note="Pointed step from OI-03 evidence."),
        PlanStep(step="Test OI against the quarterly forecast submission for the project.", status="dropped", note="Legacy step from the 5-week process audit; forecast comparison is now covered by OBL-01 and adds no evidence here."),
        PlanStep(step="Sample 25 bookings across the region for accuracy re-performance.", status="dropped", note="Population already tested at 100% by OI-01; sampling would duplicate the KRI."),
        PlanStep(step="Document conclusion at KRI level and update the residual-risk rating for the region / business group.", status="kept", note="Closing step; anchors on risk, not process."),
    ]


def planner_item_from_exception(store: Store, exc: AuditException) -> PlannerItem:
    kri = store.kri(exc.kriId)
    reviewer = kri.reviewer if kri else "reviewer"
    return PlannerItem(
        id=next_planner_id(store),
        type="Auto · from KRI",
        source=exc.kriId,
        title=f"{exc.project} – {exc.category.lower()}",
        region=exc.region,
        bg=exc.bg,
        createdAt=today_iso(),
        status="New",
        scope=f"{exc.summary} Escalated by {reviewer} from exception {exc.id}.",
        suggestedLength="1–2 weeks",
        policyDefault="v4.1",
        link=exc.id,
    )
