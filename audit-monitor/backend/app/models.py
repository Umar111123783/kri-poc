"""Domain models for the Audit Monitor API.

All models are plain data; field names are camelCase on the wire so the
React front end can use them without mapping.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class Threshold(BaseModel):
    key: str
    label: str
    value: float
    unit: str


KriStatus = Literal["active", "paused", "draft", "handed"]
Frequency = Literal["monthly", "quarterly", "weekly", "custom"]


class Kri(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    area: str
    kind: str
    status: KriStatus = "draft"
    risk: str = ""
    objective: str = ""
    sources: list[str] = Field(default_factory=list)
    steps: list[str] = Field(default_factory=list)
    thresholds: list[Threshold] = Field(default_factory=list)
    frequency: Frequency = "monthly"
    alignToClose: bool = True
    fetchOffsetDays: int = 3
    sampling: int = 100
    reviewer: str = "Audit Manager"
    hitl: Literal["exceptions", "all"] = "exceptions"
    owner: str = "Internal Audit"
    lastRun: Optional[str] = None
    note: Optional[str] = None
    customDate: Optional[str] = None
    category: Optional[str] = None


class KriStatusUpdate(BaseModel):
    status: KriStatus


class Run(BaseModel):
    id: str
    kriId: str
    trigger: str
    period: str
    startedAt: str
    duration: str
    status: str = "Complete"
    population: int
    tested: int
    exceptions: int
    explainable: int
    unexplained: int


class RunRequest(BaseModel):
    kriId: str
    period: str
    region: str = "All regions"
    bg: str = "BG-A + BG-B"
    sampling: int = Field(default=100, ge=1, le=100)


class Evidence(BaseModel):
    source: str
    record: str
    value: str


class Hypothesis(BaseModel):
    text: str
    confidence: float


ExceptionStatus = Literal["open", "accepted", "anomaly", "planner"]
Classification = Literal["unexplained", "explainable", "review"]


class AuditException(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    runId: str
    kriId: str
    ref: str
    wbs: str
    project: str
    region: str
    bg: str
    amount: float
    currency: str = "EUR"
    category: str
    classification: Classification
    status: ExceptionStatus = "open"
    summary: str
    evidence: list[Evidence] = Field(default_factory=list)
    reasoning: list[str] = Field(default_factory=list)
    hypothesis: Hypothesis
    confirm: str = ""
    reviewNote: Optional[str] = None


class ExceptionUpdate(BaseModel):
    status: Optional[ExceptionStatus] = None
    reviewNote: Optional[str] = None


class RunResult(BaseModel):
    run: Run
    exceptions: list[AuditException]


PlanStepStatus = Literal["kept", "updated", "new", "dropped"]


class PlanStep(BaseModel):
    step: str
    status: PlanStepStatus
    note: str


class PlannerItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    type: str
    source: str
    title: str
    region: str
    bg: str
    createdAt: str
    status: str = "New"
    scope: str = ""
    suggestedLength: str = "1 week"
    policyDefault: str = "v4.1"
    link: str = "—"
    plan: Optional[list[PlanStep]] = None


class PlannerCreate(BaseModel):
    title: str
    region: str = "MEA"
    bg: str = "BG-A"
    scope: str = ""
    suggestedLength: str = "1 week"


class PlannerUpdate(BaseModel):
    status: Optional[str] = None
    policyDefault: Optional[str] = None
    plan: Optional[list[PlanStep]] = None
    clearPlan: bool = False


class DraftRequest(BaseModel):
    policy: str = "v4.1"


class CalendarSettings(BaseModel):
    pattern: str = "4-4-5"
    fyStart: str = "January"
    weekEnd: str = "Sunday"


class Connection(BaseModel):
    source: str
    account: str
    environment: str
    state: str


class SettingsView(BaseModel):
    calendar: CalendarSettings
    connections: list[Connection]
