"""Define public response and shared view-context contracts."""
from typing import Any, Generic, Literal, TypeVar
from pydantic import BaseModel, Field

Availability = Literal['available', 'unavailable']
Source = Literal['sample', 'local', 'uploaded']
T = TypeVar('T')


class QueryContext(BaseModel):
    """Carry explicitly selected display scope, never authorization."""
    personaId: str | None = None
    hierarchyNodeId: str | None = None
    filters: dict[str, list[str]] = Field(default_factory=dict)


class Envelope(BaseModel, Generic[T]):
    """Qualify returned data and unsupported context dimensions."""
    data: T
    availability: Availability = 'available'
    unavailableDimensions: list[str] = Field(default_factory=list)


class ApiProblem(BaseModel):
    """Expose actionable failures without storage internals."""
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class ProblemEnvelope(BaseModel):
    """Wrap every HTTP error consistently."""
    error: ApiProblem


class Persona(BaseModel):
    """Describe an approved mock display persona."""
    id: str
    label: str
    description: str = ''


class MetricValue(BaseModel):
    """Preserve supplied precision, provenance and reporting period."""
    id: str
    label: str
    family: str
    value: float | str | None
    unit: str | None
    period: str | None
    availability: Availability
    source: Source
    sourceRef: str | None


class Widget(BaseModel):
    """Expose one configured visible widget with its exact metric."""
    id: str
    title: str
    visible: bool = True
    metric: MetricValue


class Scenario(BaseModel):
    """Describe a supplied destination without promising module availability."""
    id: str
    label: str
    description: str
    destination: str


class Dashboard(BaseModel):
    """Compose persona-isolated widgets and explicit scenario records."""
    persona: Persona
    widgets: list[Widget]
    scenarios: list[Scenario]


class Health(BaseModel):
    """Report process liveness only."""
    status: Literal['ok'] = 'ok'
