"""Define engineering-bounded demo configuration and audit contracts."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from app.schemas.contracts import Envelope

Identifier = Annotated[str, StringConstraints(min_length=1, max_length=100, pattern=r'^[A-Za-z0-9_-]+$')]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
EventType = Literal['edit', 'override', 'annotation', 'uploaded_data_version']


class StrictModel(BaseModel):
    """Reject extra fields and coercion at administrator write boundaries."""
    model_config = ConfigDict(extra='forbid', strict=True)


class Actor(StrictModel):
    """Identify mock display context, not authenticated identity."""
    personaId: Identifier
    userId: Literal['demo-operator'] = 'demo-operator'


class KpiConfig(StrictModel):
    """Rename a supplied metric and associated widget title without formulas."""
    metricId: Identifier
    label: Title
    title: Title
    actor: Actor


class ScenarioConfig(StrictModel):
    """Edit one existing scenario using an available internal destination."""
    scenarioId: Identifier
    label: Title
    description: Annotated[str, StringConstraints(max_length=500)]
    destination: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    actor: Actor


class WidgetConfig(StrictModel):
    """Change only visibility for one existing persona widget."""
    visible: bool
    actor: Actor


class MappingConfig(StrictModel):
    """Configure an explicit existing journey relationship; never infer a link."""
    relationshipId: Identifier
    sourceEntityId: Identifier
    targetEntityId: Identifier
    type: Literal['depends_on', 'impact']
    actor: Actor


class ConfigResult(BaseModel):
    """Distinguish a freshly verified save from ambiguous completion."""
    configId: str
    auditId: str
    outcome: Literal['success', 'unconfirmed']
    effectiveStatus: Literal['confirmed', 'unconfirmed']
    saved: bool
    config: dict = Field(default_factory=dict)


class ConfigEnvelope(Envelope[ConfigResult]):
    """Qualify the explicit write outcome."""


class ConfigCatalog(BaseModel):
    """Expose bounded supported options including currently hidden widgets."""
    personas: list[dict]
    widgets: list[dict]
    metrics: list[dict]
    scenarios: list[dict]
    relationships: list[dict]
    destinations: list[str]


class AuditFilter(StrictModel):
    """Apply exact AND filters, parsing numeric URL parameters with bounded pagination."""
    model_config = ConfigDict(extra='forbid', strict=False)
    eventType: EventType | None = None
    target: Identifier | None = None
    persona: Identifier | None = None
    limit: int = Field(default=50, ge=1, le=100)
    offset: int = Field(default=0, ge=0, le=10000)


class AuditEvent(BaseModel):
    """Return actual persisted actor, timestamp, target and event details."""
    id: str
    eventType: EventType
    occurredAt: str
    actor: dict | None
    targetType: str
    targetId: str | None
    summary: str
    details: dict
    datasetVersionId: str | None


class AuditPage(Envelope[list[AuditEvent]]):
    """Bound persisted event review and expose matching count."""
    total: int
    limit: int
    offset: int


class AdminFailure(Exception):
    """Carry safe errors with field feedback and known commit classification."""
    def __init__(self, status: int, code: str, message: str, details: dict | None = None) -> None:
        """Retain public correction details for the HTTP adapter."""
        super().__init__(message)
        self.status = status
        self.code = code
        self.details = details or {}
