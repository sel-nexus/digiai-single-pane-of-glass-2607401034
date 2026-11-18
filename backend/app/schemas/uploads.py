"""Define the bounded demo upload mapping and public outcomes."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.schemas.contracts import Envelope

DatasetClass = Literal['master', 'journey_mapping', 'incident', 'problem_rca', 'release_metrics', 'qe_metrics', 'automation_metrics', 'security_findings', 'observability_kpi', 'transformation_maturity', 'value_trend']
DATASET_CLASSES = ('master', 'journey_mapping', 'incident', 'problem_rca', 'release_metrics', 'qe_metrics', 'automation_metrics', 'security_findings', 'observability_kpi', 'transformation_maturity', 'value_trend')
FIELDS = {
    'entity': ('id', 'type', 'label', 'parentId', 'criticality', 'attributes'),
    'relationship': ('id', 'sourceEntityId', 'targetEntityId', 'type', 'sourceRef'),
    'metric': ('id', 'label', 'family', 'value', 'unit', 'period', 'entityId'),
}
REQUIRED = {'entity': ('id', 'type', 'label'), 'relationship': ('id', 'sourceEntityId', 'targetEntityId', 'type'), 'metric': ('id', 'label', 'family')}


class UploadMapping(BaseModel):
    """Assign source column names to supported logical fields, never fixed headers."""
    model_config = ConfigDict(extra='forbid', strict=True)
    recordKind: Literal['entity', 'relationship', 'metric']
    columns: dict[str, str] = Field(min_length=1, max_length=100)

    @model_validator(mode='after')
    def supported_fields(self) -> 'UploadMapping':
        """Reject unknown targets, blank sources and missing identity assignments."""
        targets = list(self.columns.values())
        if any(not name or len(name) > 200 for name in self.columns):
            raise ValueError('Source column names must contain 1–200 characters')
        if len(set(targets)) != len(targets) or set(targets) - set(FIELDS[self.recordKind]):
            raise ValueError('Assign each supported target field at most once')
        if set(REQUIRED[self.recordKind]) - set(targets):
            raise ValueError(f'Required mapped fields: {", ".join(REQUIRED[self.recordKind])}')
        return self


class UploadActor(BaseModel):
    """Record supplied mock display context without treating it as authentication."""
    model_config = ConfigDict(extra='forbid', strict=True)
    personaId: str = Field(min_length=1, max_length=100)


class UploadIssue(BaseModel):
    """Locate a correction without returning raw row contents."""
    code: str
    message: str
    row: int | None = None
    field: str | None = None


class UploadReflection(BaseModel):
    """Report committed query visibility, not browser refresh or external propagation."""
    status: Literal['confirmed', 'unconfirmed']
    views: list[str]


class UploadResult(BaseModel):
    """Identify an accepted version or an ambiguous attempted commit."""
    uploadId: str
    datasetVersion: str
    datasetClass: DatasetClass
    outcome: Literal['success', 'unconfirmed']
    source: Literal['uploaded'] = 'uploaded'
    reflection: UploadReflection
    issues: list[UploadIssue] = Field(default_factory=list)
    acceptedRows: int | None = None


class UploadEnvelope(Envelope[UploadResult]):
    """Qualify upload completion separately from availability."""


class UploadFailure(Exception):
    """Carry an HTTP classification without storage internals."""
    def __init__(self, status: int, code: str, message: str, issues: list[UploadIssue] | None = None) -> None:
        """Retain safe public issues for the boundary adapter."""
        super().__init__(message)
        self.status = status
        self.code = code
        self.issues = issues or []
