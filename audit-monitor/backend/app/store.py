"""SQLite and JSON-compatible store for the Audit Monitor API.

Stores KRIs, Runs, Exceptions, Planner items, Settings, Order Intake,
and Purchase Orders with SQLite backing.
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

from .database import get_connection, init_db
from .models import (
    AuditException,
    CalendarSettings,
    Evidence,
    Hypothesis,
    Kri,
    PlanStep,
    PlannerItem,
    Run,
    Threshold,
)

APP_DIR = Path(__file__).resolve().parent
SEED_PATH = APP_DIR / "seed.json"
DATA_DIR = Path(os.environ.get("DATA_DIR", APP_DIR.parent / "data"))
STORE_PATH = DATA_DIR / "store.json"


class Store:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._load()

    def _load(self) -> None:
        init_db()
        self.seed: dict[str, Any] = {}
        if SEED_PATH.exists():
            try:
                self.seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
            except Exception:
                self.seed = {}
        DATA_DIR.mkdir(parents=True, exist_ok=True)

    @property
    def kris(self) -> list[Kri]:
        conn = get_connection()
        rows = conn.execute("SELECT * FROM kris").fetchall()
        conn.close()
        items: list[Kri] = []
        for r in rows:
            items.append(
                Kri(
                    id=r["id"],
                    name=r["name"],
                    area=r["area"],
                    kind=r["kind"],
                    status=r["status"],
                    risk=r["risk"] or "",
                    objective=r["objective"] or "",
                    sources=json.loads(r["sources"] or "[]"),
                    steps=json.loads(r["steps"] or "[]"),
                    thresholds=[Threshold(**t) for t in json.loads(r["thresholds"] or "[]")],
                    frequency=r["frequency"],
                    alignToClose=bool(r["align_to_close"]),
                    fetchOffsetDays=r["fetch_offset_days"],
                    sampling=r["sampling"],
                    reviewer=r["reviewer"],
                    hitl=r["hitl"],
                    owner=r["owner"],
                    lastRun=r["last_run"],
                    note=r["note"],
                    customDate=r["custom_date"],
                    category=r["category"] if "category" in r.keys() else None,
                )
            )
        return items

    @kris.setter
    def kris(self, value: list[Kri]) -> None:
        conn = get_connection()
        with conn:
            conn.execute("DELETE FROM kris")
            for k in value:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO kris (
                        id, name, area, kind, status, risk, objective, sources,
                        steps, thresholds, frequency, align_to_close, fetch_offset_days,
                        sampling, reviewer, hitl, owner, last_run, note, custom_date, category
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        k.id,
                        k.name,
                        k.area,
                        k.kind,
                        k.status,
                        k.risk,
                        k.objective,
                        json.dumps(k.sources),
                        json.dumps(k.steps),
                        json.dumps([t.model_dump() for t in k.thresholds]),
                        k.frequency,
                        1 if k.alignToClose else 0,
                        k.fetchOffsetDays,
                        k.sampling,
                        k.reviewer,
                        k.hitl,
                        k.owner,
                        k.lastRun,
                        k.note,
                        k.customDate,
                        k.category,
                    ),
                )
        conn.close()

    @property
    def runs(self) -> list[Run]:
        conn = get_connection()
        rows = conn.execute("SELECT * FROM runs ORDER BY ROWID DESC").fetchall()
        conn.close()
        return [
            Run(
                id=r["id"],
                kriId=r["kri_id"],
                trigger=r["trigger"],
                period=r["period"],
                startedAt=r["started_at"],
                duration=r["duration"],
                status=r["status"],
                population=r["population"],
                tested=r["tested"],
                exceptions=r["exceptions"],
                explainable=r["explainable"],
                unexplained=r["unexplained"],
            )
            for r in rows
        ]

    @runs.setter
    def runs(self, value: list[Run]) -> None:
        conn = get_connection()
        with conn:
            conn.execute("DELETE FROM runs")
            for r in value:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO runs (
                        id, kri_id, trigger, period, started_at, duration, status,
                        population, tested, exceptions, explainable, unexplained
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        r.id,
                        r.kriId,
                        r.trigger,
                        r.period,
                        r.startedAt,
                        r.duration,
                        r.status,
                        r.population,
                        r.tested,
                        r.exceptions,
                        r.explainable,
                        r.unexplained,
                    ),
                )
        conn.close()

    @property
    def exceptions(self) -> list[AuditException]:
        conn = get_connection()
        rows = conn.execute("SELECT * FROM audit_exceptions ORDER BY ROWID DESC").fetchall()
        conn.close()
        items: list[AuditException] = []
        for r in rows:
            hypo_raw = json.loads(r["hypothesis"] or "{}")
            items.append(
                AuditException(
                    id=r["id"],
                    runId=r["run_id"],
                    kriId=r["kri_id"],
                    ref=r["ref"] or "",
                    wbs=r["wbs"] or "",
                    project=r["project"] or "",
                    region=r["region"] or "",
                    bg=r["bg"] or "",
                    amount=r["amount"],
                    currency=r["currency"] or "EUR",
                    category=r["category"] or "",
                    classification=r["classification"] or "unexplained",
                    status=r["status"] or "open",
                    summary=r["summary"] or "",
                    evidence=[Evidence(**e) for e in json.loads(r["evidence"] or "[]")],
                    reasoning=json.loads(r["reasoning"] or "[]"),
                    hypothesis=Hypothesis(**hypo_raw) if hypo_raw else Hypothesis(text="", confidence=0.0),
                    confirm=r["confirm"] or "",
                    reviewNote=r["review_note"],
                )
            )
        return items

    @exceptions.setter
    def exceptions(self, value: list[AuditException]) -> None:
        conn = get_connection()
        with conn:
            conn.execute("DELETE FROM audit_exceptions")
            for e in value:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO audit_exceptions (
                        id, run_id, kri_id, ref, wbs, project, region, bg,
                        amount, currency, category, classification, status,
                        summary, evidence, reasoning, hypothesis, confirm,
                        review_note, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    """,
                    (
                        e.id,
                        e.runId,
                        e.kriId,
                        e.ref,
                        e.wbs,
                        e.project,
                        e.region,
                        e.bg,
                        e.amount,
                        e.currency,
                        e.category,
                        e.classification,
                        e.status,
                        e.summary,
                        json.dumps([ev.model_dump() for ev in e.evidence]),
                        json.dumps(e.reasoning),
                        json.dumps(e.hypothesis.model_dump()),
                        e.confirm,
                        e.reviewNote,
                    ),
                )
        conn.close()

    @property
    def planner(self) -> list[PlannerItem]:
        conn = get_connection()
        rows = conn.execute("SELECT * FROM planner_items ORDER BY ROWID DESC").fetchall()
        conn.close()
        items: list[PlannerItem] = []
        for r in rows:
            plan_raw = json.loads(r["plan"]) if r["plan"] else None
            items.append(
                PlannerItem(
                    id=r["id"],
                    type=r["type"],
                    source=r["source"],
                    title=r["title"],
                    region=r["region"],
                    bg=r["bg"],
                    createdAt=r["created_at"],
                    status=r["status"],
                    scope=r["scope"] or "",
                    suggestedLength=r["suggested_length"] or "1 week",
                    policyDefault=r["policy_default"] or "v4.1",
                    link=r["link"] or "—",
                    plan=[PlanStep(**s) for s in plan_raw] if plan_raw is not None else None,
                )
            )
        return items

    @planner.setter
    def planner(self, value: list[PlannerItem]) -> None:
        conn = get_connection()
        with conn:
            conn.execute("DELETE FROM planner_items")
            for p in value:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO planner_items (
                        id, type, source, title, region, bg, created_at,
                        status, scope, suggested_length, policy_default, link, plan
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        p.id,
                        p.type,
                        p.source,
                        p.title,
                        p.region,
                        p.bg,
                        p.createdAt,
                        p.status,
                        p.scope,
                        p.suggestedLength,
                        p.policyDefault,
                        p.link,
                        json.dumps([s.model_dump() for s in p.plan]) if p.plan is not None else None,
                    ),
                )
        conn.close()

    @property
    def calendar(self) -> CalendarSettings:
        conn = get_connection()
        row = conn.execute("SELECT value FROM settings WHERE key = 'calendar'").fetchone()
        conn.close()
        if row and row["value"]:
            return CalendarSettings(**json.loads(row["value"]))
        return CalendarSettings()

    @calendar.setter
    def calendar(self, value: CalendarSettings) -> None:
        conn = get_connection()
        with conn:
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('calendar', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (json.dumps(value.model_dump()),),
            )
        conn.close()

    def save(self) -> None:
        pass

    def reset(self) -> None:
        with self._lock:
            init_db(force_reset=True)
            self._load()

    def lock(self) -> threading.RLock:
        return self._lock

    def kri(self, kri_id: str) -> Kri | None:
        return next((k for k in self.kris if k.id == kri_id), None)

    def exception(self, exc_id: str) -> AuditException | None:
        return next((e for e in self.exceptions if e.id == exc_id), None)

    def planner_item(self, item_id: str) -> PlannerItem | None:
        return next((p for p in self.planner if p.id == item_id), None)

    def seed_exceptions_for(self, kri_id: str) -> list[dict[str, Any]]:
        # Always read fresh seed data
        try:
            current_seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
        except Exception:
            current_seed = self.seed
        
        exceptions_pool = current_seed.get("exceptions", [])
        kri_obj = self.kri(kri_id)
        area = (kri_obj.area if kri_obj else "").upper()
        kri_upper = kri_id.upper()
        kri_name = (kri_obj.name if kri_obj else "").upper()

        # 1. Exact match by kriId or normalized alias (e.g. S2P-03 <-> S2P-0300)
        exact_pool = [
            e for e in exceptions_pool
            if e.get("kriId") == kri_id
            or (kri_id in ("S2P-0300", "S2P-03") and e.get("kriId") in ("S2P-0300", "S2P-03"))
        ]
        if exact_pool:
            return exact_pool

        # 2. Check dedicated SAP S2P sample data file if S2P / Vendor / Bank
        sap_s2p_file = DATA_DIR / "sap_s2p_sample_data.json"
        if (area == "S2P" or "S2P" in kri_upper or "VENDOR" in kri_name or "BANK" in kri_name) and sap_s2p_file.exists():
            try:
                sap_data = json.loads(sap_s2p_file.read_text(encoding="utf-8"))
                cdhdr_records = sap_data.get("tables", {}).get("CDHDR_CDPOS", {}).get("records", [])
                f110_records = sap_data.get("tables", {}).get("F110_REGUP", {}).get("records", [])
                sharepoint_records = sap_data.get("tables", {}).get("SHAREPOINT_AUDIT_LOG", {}).get("records", [])
                
                derived_exceptions = []
                for i, cd in enumerate(cdhdr_records):
                    f110 = next((f for f in f110_records if f.get("vendorId") == cd.get("vendorId")), {})
                    sp = next((s for s in sharepoint_records if s.get("vendorId") == cd.get("vendorId")), {})
                    is_unexplained = cd.get("dualApprovalStatus") == "MISSING_SIGN_OFF" or f110.get("riskFlag") == "CRITICAL_PAYMENT_DIVERSION_RISK"
                    
                    derived_exceptions.append({
                        "id": f"X-S2P-{i+1}",
                        "runId": "R-SAP",
                        "kriId": kri_id,
                        "ref": f"Vendor {cd.get('vendorId')} ({cd.get('vendorName')})",
                        "wbs": "N.10455.01" if i == 0 else "N.09877.01",
                        "project": f"{cd.get('vendorName')} – Payment Run Proposal",
                        "region": "MEA" if i == 0 else "Europe",
                        "bg": "BG-A" if i == 0 else "BG-B",
                        "amount": f110.get("grossAmount", 145000.0),
                        "currency": f110.get("currency", "EUR"),
                        "category": "Vendor bank modified 3 days prior to payment" if is_unexplained else "Vendor bank change with verified approval",
                        "classification": "unexplained" if is_unexplained else "explainable",
                        "status": "open" if is_unexplained else "accepted",
                        "summary": f"Vendor bank details (IBAN) were altered in SAP master data on {cd.get('changeDate')} by {cd.get('changedBy')}; included in {f110.get('paymentRunDate', '2026-08-29')} payment proposal of EUR {int(f110.get('grossAmount', 145000)):,}.",
                        "evidence": [
                            {"source": "sap", "record": f"SAP CDHDR / CDPOS · {cd.get('changeDate')}", "value": f"IBAN changed from {cd.get('oldValue')} to {cd.get('newValue')} by user {cd.get('changedBy')}"},
                            {"source": "sap", "record": f"SAP F110 Payment Proposal · {f110.get('paymentRunDate', '2026-08-29')}", "value": f"Payment of EUR {int(f110.get('grossAmount', 0)):,} routed to new {f110.get('destinationIban', '')} account"},
                            {"source": "tickets", "record": "SharePoint Dual-Approval Log", "value": f"Dual-approval status: {sp.get('complianceStatus', 'MISSING_SIGN_OFF')}"}
                        ],
                        "reasoning": [
                            f"Vendor bank account modification occurred within the 14-day pre-payment window threshold ({f110.get('daysSinceBankModification', 3)} days).",
                            f"User {cd.get('changedBy')} who altered the record is also configured on the payment release workflow.",
                            "No independent callback confirmation or dual-authorization document exists in Audit Ticketing." if is_unexplained else "Verified callback documentation and dual-approval ticket logged."
                        ],
                        "hypothesis": {
                            "text": "Unverified vendor master update directly preceding high-value payment disbursement; potential payment diversion risk." if is_unexplained else "Authorized corporate banking change. Fully documented.",
                            "confidence": 0.89 if is_unexplained else 0.96
                        },
                        "confirm": "Contact vendor controller directly to verify authentic banking change notice before releasing payment." if is_unexplained else "Accepted by reviewer."
                    })
                if derived_exceptions:
                    return derived_exceptions
            except Exception:
                pass
        # 2b. OI-02 specific handling for Order Intake reversals vs revenue linkage
        if kri_id.upper() == "OI-02":
            oi_file = DATA_DIR / "sap_oi02_sample_data.json"
            if oi_file.exists():
                try:
                    oi_data = json.loads(oi_file.read_text(encoding="utf-8"))
                    oi_bookings = oi_data.get("tables", {}).get("OI_BOOKINGS", {}).get("records", [])
                    revenue = oi_data.get("tables", {}).get("REVENUE_POSTINGS", {}).get("records", [])
                    derived_exceptions = []
                    rev_lookup = {}
                    for rev in revenue:
                        key = (rev.get("cpo"), rev.get("period"))
                        rev_lookup.setdefault(key, []).append(rev)
                    for i, rec in enumerate(oi_bookings):
                        if rec.get("type") != "reversal":
                            continue
                        cpo = rec.get("cpo")
                        # Find matching revenue reversal entry (type reversal) for same CPO in same period after reversal
                        # Simplify: check any revenue entry with amount == 0 for that CPO
                        revs = rev_lookup.get((cpo, None), [])
                        # Look for any revenue entry with amount 0 (indicating no reversal)
                        has_rev = any(r.get("amount", 0) != 0 for r in revs)
                        classification = "explainable" if has_rev else "unexplained"
                        category = "Reversal with re-booking" if has_rev else "Reversal without revenue adjustment"
                        derived_exceptions.append({
                            "id": f"X-OI02-{i+1}",
                            "runId": "R-OI02",
                            "kriId": kri_id,
                            "ref": f"CPO {cpo}",
                            "wbs": rec.get("wbs", ""),
                            "project": "<unknown>",
                            "region": "MEA",
                            "bg": "BG-A",
                            "amount": abs(rec.get("amount", 0)),
                            "currency": rec.get("currency", "EUR"),
                            "category": category,
                            "classification": classification,
                            "status": "open" if classification == "unexplained" else "accepted",
                            "summary": f"OI reversal of EUR {abs(rec.get('amount',0)):,} for CPO {cpo} on {rec.get('bookingDate')} – {category}.",
                            "evidence": [],
                            "reasoning": [],
                            "hypothesis": {"text": "", "confidence": 0.0},
                            "confirm": ""
                        })
                    if derived_exceptions:
                        return derived_exceptions
                except Exception:
                    pass

        # 3. S2P / Vendor / Bank matching (Prioritize authentic Vendor Bank & Supplier anomalies)
        if area == "S2P" or "S2P" in kri_upper or "VENDOR" in kri_name or "BANK" in kri_name or "PAYMENT" in kri_name:
            s2p_pool = [
                e for e in exceptions_pool
                if e.get("kriId") in ("S2P-0300", "S2P-03", "S2P-01")
                or "VENDOR" in e.get("category", "").upper()
                or "BANK" in e.get("category", "").upper()
            ]
            if s2p_pool:
                return s2p_pool

        # 4. P2P / Procurement matching (Purchase Orders)
        if area == "P2P" or "P2P" in kri_upper:
            p2p_pool = [
                e for e in exceptions_pool
                if e.get("kriId") == "P2P-02"
                or e.get("category", "").startswith("Active PO")
                or "DUPLICATE PAYMENT" in e.get("category", "").upper()
            ]
            if p2p_pool:
                return p2p_pool

        # 5. O2C / Order Intake matching
        if area == "O2C" or "OI" in kri_upper or "OBL" in kri_upper:
            o2c_pool = [e for e in exceptions_pool if "OI" in e.get("kriId", "")]
            if o2c_pool:
                return o2c_pool

        # 6. Fallback pool
        return [e for e in exceptions_pool if e.get("kriId") == "S2P-0300"] or [e for e in exceptions_pool if e.get("kriId") == "OI-02"] or exceptions_pool[:2]


store = Store()


