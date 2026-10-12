from fastapi import APIRouter

from ..models import CalendarSettings, Connection, SettingsView
from ..store import store

router = APIRouter(prefix="/api/settings", tags=["settings"])

CONNECTIONS = [
    Connection(source="sap", account="svc-ia-agent-01", environment="Pre-prod (UAT)", state="ok"),
    Connection(source="obs", account="svc-ia-agent-01", environment="Pre-prod (UAT)", state="ok"),
    Connection(source="mrep", account="svc-ia-agent-02", environment="Prod (read)", state="ok"),
    Connection(source="pmaster", account="svc-ia-agent-01", environment="Dev", state="warn"),
    Connection(source="tickets", account="svc-ia-agent-03", environment="Prod (read/write)", state="ok"),
]


@router.get("", response_model=SettingsView)
def get_settings() -> SettingsView:
    return SettingsView(calendar=store.calendar, connections=CONNECTIONS)


@router.put("/calendar", response_model=CalendarSettings)
def save_calendar(body: CalendarSettings) -> CalendarSettings:
    with store.lock():
        store.calendar = body
        store.save()
    return body


@router.post("/reset", status_code=204)
def reset() -> None:
    """Restore the sample data. Demo convenience – protect or remove before production."""
    store.reset()
