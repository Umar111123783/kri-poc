from fastapi import APIRouter, HTTPException

from ..models import AuditException, ExceptionUpdate, PlannerItem
from ..services import planner_item_from_exception
from ..store import store

router = APIRouter(prefix="/api/exceptions", tags=["exceptions"])


@router.get("", response_model=list[AuditException])
def list_exceptions() -> list[AuditException]:
    return store.exceptions


@router.get("/{exc_id}", response_model=AuditException)
def get_exception(exc_id: str) -> AuditException:
    """Retrieve full audit exception details."""
    exc = store.exception(exc_id)
    if not exc:
        raise HTTPException(404, f"Exception {exc_id} not found")
    return exc


@router.get("/{exc_id}/trace")
def get_exception_trace(exc_id: str) -> dict:
    """Retrieve agent reasoning trace, hypothesis, and confirmation protocol."""
    exc = store.exception(exc_id)
    if not exc:
        raise HTTPException(404, f"Exception {exc_id} not found")
    return {
        "exceptionId": exc.id,
        "kriId": exc.kriId,
        "runId": exc.runId,
        "classification": exc.classification,
        "summary": exc.summary,
        "reasoning": exc.reasoning,
        "hypothesis": exc.hypothesis.model_dump(),
        "confirm": exc.confirm,
    }


@router.get("/{exc_id}/evidence")
def get_evidence_package(exc_id: str) -> dict:
    """Retrieve structured evidence package across multi-source ERPs."""
    exc = store.exception(exc_id)
    if not exc:
        raise HTTPException(404, f"Exception {exc_id} not found")
    return {
        "exceptionId": exc.id,
        "kriId": exc.kriId,
        "wbs": exc.wbs,
        "project": exc.project,
        "amount": exc.amount,
        "currency": exc.currency,
        "evidence": [e.model_dump() for e in exc.evidence],
    }


@router.patch("/{exc_id}", response_model=AuditException)
def update_exception(exc_id: str, body: ExceptionUpdate) -> AuditException:
    """Record a reviewer decision: open / accepted / anomaly, with an optional note."""
    with store.lock():
        exc = store.exception(exc_id)
        if not exc:
            raise HTTPException(404, f"Exception {exc_id} not found")
        if body.status is not None:
            exc.status = body.status
        if body.reviewNote is not None:
            exc.reviewNote = body.reviewNote
        store.exceptions = [exc if e.id == exc_id else e for e in store.exceptions]
        store.save()
    return exc


@router.post("/{exc_id}/planner", response_model=PlannerItem, status_code=201)
def send_to_planner(exc_id: str) -> PlannerItem:
    """Escalate an exception to the Audit planner as a spot-audit candidate."""
    with store.lock():
        exc = store.exception(exc_id)
        if not exc:
            raise HTTPException(404, f"Exception {exc_id} not found")
        item = planner_item_from_exception(store, exc)
        store.planner = [item] + store.planner
        exc.status = "planner"
        store.exceptions = [exc if e.id == exc_id else e for e in store.exceptions]
        store.save()
    return item
