"""Define public response and shared view-context contracts."""
from typing import Any, Generic, Literal, TypeVar
from pydantic import BaseModel, Field, JsonValue

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


EntityType = Literal['domain', 'portfolio', 'service', 'application', 'environment', 'ticket', 'release', 'journey', 'owner']


class Entity(BaseModel):
    """Expose an exact source record without synthesizing a profile."""
    id: str
    type: EntityType
    label: str
    parentId: str | None
    source: Source
    sourceRef: str | None
    distinguishingInfo: str = ''


class Page(BaseModel):
    """Carry bounded pagination and matching count."""
    limit: int
    nextCursor: str | None
    total: int


class EntityPage(Envelope[list[Entity]]):
    """Return bounded discovery records."""
    page: Page


class HierarchyNode(Entity):
    """Describe a represented five-level link."""
    level: str
    hasRepresentedChildren: bool


class HierarchyPage(Envelope[list[HierarchyNode]]):
    """Preserve ancestry separately from scoped children."""
    ancestry: list[Entity] = Field(default_factory=list)
    page: Page


class FilterOption(BaseModel):
    """Name an exact source filter value."""
    id: str
    label: str


class JourneyTarget(BaseModel):
    """Identify an explicitly represented application or API asset."""
    entityType: Literal['application', 'api']
    entityId: str
    label: str
    source: Source
    sourceRef: str | None


class JourneyRelationship(BaseModel):
    """Preserve one directed source row without claiming causality."""
    id: str
    type: Literal['depends_on', 'impact']
    sourceEntityId: str
    sourceLabel: str
    target: JourneyTarget
    source: Source
    sourceRef: str | None
    representedContext: str | None


class JourneyOverlay(BaseModel):
    """Qualify a represented overlay independently of other overlays."""
    availability: Availability
    value: list[JourneyRelationship] | None


class JourneyImpact(BaseModel):
    """Expose supplied business-impact prose only."""
    availability: Availability
    value: str | None


class JourneyDetail(BaseModel):
    """Compose exact identity, supplied fields and separate overlays."""
    id: str
    label: str
    description: str | None
    source: Source
    sourceRef: str | None
    relationships: list[JourneyRelationship]
    dependency: JourneyOverlay
    impactOverlay: JourneyOverlay
    impact: JourneyImpact


class ApplicationEvidence(BaseModel):
    """Preserve one supplied value and its exact association and provenance."""
    id: str
    label: str
    value: JsonValue
    source: Source
    sourceRef: str | None
    association: str
    unit: str | None = None
    period: str | None = None


class ApplicationCategory(BaseModel):
    """Keep absent category evidence explicitly unavailable and null."""
    availability: Availability
    value: list[ApplicationEvidence] | None


class ApplicationCategories(BaseModel):
    """Name all eleven source-associated profile categories."""
    ownership: ApplicationCategory
    domainPortfolio: ApplicationCategory
    criticality: ApplicationCategory
    health: ApplicationCategory
    incidents: ApplicationCategory
    releaseHistory: ApplicationCategory
    defects: ApplicationCategory
    securityPosture: ApplicationCategory
    dependencies: ApplicationCategory
    automationMaturity: ApplicationCategory
    observabilityCoverage: ApplicationCategory


class ApplicationProfile(BaseModel):
    """Compose exact application identity without inferred status or links."""
    id: str
    label: str
    source: Source
    sourceRef: str | None
    categories: ApplicationCategories


class OperationRecord(BaseModel):
    """Expose supplied operational fields separately from security findings."""
    id: str
    label: str
    recordType: Literal['incident', 'problem_rca', 'major_incident', 'observability_event', 'observability_summary']
    source: Source
    sourceRef: str | None
    evidence: ApplicationCategory
    businessContext: ApplicationCategory


class OperationsPage(Envelope[list[OperationRecord]]):
    """Bound operational records and preserve matching counts."""
    page: Page


class CorrelationLink(BaseModel):
    """Identify one explicit directed evidence relationship without diagnosis."""
    id: str
    sourceEntityId: str
    targetEntityId: str
    relationshipLabel: Literal['represented correlation'] = 'represented correlation'
    evidence: ApplicationEvidence


class CorrelationsPage(Envelope[list[CorrelationLink]]):
    """Bound links for one exact incident identity."""
    incidentId: str
    page: Page


class OperationsMetricsPage(Envelope[list[MetricValue]]):
    """Bound the named supplied reliability measures."""
    page: Page
