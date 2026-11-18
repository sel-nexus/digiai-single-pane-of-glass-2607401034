"""Expose typed thin configuration and audit routes with dependency injection."""
from typing import Annotated
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from app.domain.config_service import ConfigService
from app.domain.audit_service import AuditService
from app.schemas.admin import AdminFailure, AuditFilter, AuditPage, ConfigCatalog, ConfigEnvelope, KpiConfig, MappingConfig, ScenarioConfig, WidgetConfig, Identifier
from app.schemas.contracts import Envelope, ProblemEnvelope

router = APIRouter(prefix='/api/v1/admin', tags=['Admin'])


def get_config_service(request: Request) -> ConfigService:
    """Resolve the lifespan-initialized config boundary."""
    return request.app.state.config_service


def get_audit_service(request: Request) -> AuditService:
    """Resolve the lifespan-initialized audit boundary."""
    return request.app.state.audit_service


def save_response(service: ConfigService, kind: str, payload: KpiConfig | MappingConfig | ScenarioConfig | WidgetConfig, persona_id: str | None = None, widget_id: str | None = None) -> ConfigEnvelope | JSONResponse:
    """Map known failures and ambiguous completion without changing their meaning."""
    try:
        result = service.save(kind, payload, persona_id, widget_id)
        if not result.data.saved:
            return JSONResponse(status_code=503, content=result.model_dump())
        return result
    except AdminFailure as error:
        return JSONResponse(status_code=error.status, content={'error': {'code': error.code, 'message': str(error), 'details': error.details}})


@router.get('/config', response_model=Envelope[ConfigCatalog], summary='Read bounded supported demo configuration')
def catalog(service: Annotated[ConfigService, Depends(get_config_service)]) -> Envelope[ConfigCatalog]:
    """Return actual options without making a selection or write."""
    return Envelope(data=service.catalog())


@router.post('/mappings', response_model=ConfigEnvelope, summary='Save an explicit existing journey mapping')
def mapping(payload: MappingConfig, service: Annotated[ConfigService, Depends(get_config_service)]) -> ConfigEnvelope | JSONResponse:
    """Delegate the validated mapping to one atomic unit of work."""
    return save_response(service, 'mapping', payload)


@router.post('/kpis', response_model=ConfigEnvelope, summary='Rename supplied KPI definition, never calculate values')
def kpi(payload: KpiConfig, service: Annotated[ConfigService, Depends(get_config_service)]) -> ConfigEnvelope | JSONResponse:
    """Delegate the supported label/title edit."""
    return save_response(service, 'kpi', payload)


@router.post('/scenarios', response_model=ConfigEnvelope, summary='Save an existing scenario with an available destination')
def scenario(payload: ScenarioConfig, service: Annotated[ConfigService, Depends(get_config_service)]) -> ConfigEnvelope | JSONResponse:
    """Delegate exact internal destination validation."""
    return save_response(service, 'scenario', payload)


@router.put('/personas/{personaId}/widgets/{widgetId}', response_model=ConfigEnvelope, summary='Override one existing persona widget visibility')
def widget(personaId: Identifier, widgetId: Identifier, payload: WidgetConfig, service: Annotated[ConfigService, Depends(get_config_service)]) -> ConfigEnvelope | JSONResponse:
    """Preserve all other persona widgets."""
    return save_response(service, 'widget', payload, personaId, widgetId)


@router.get('/audit', response_model=AuditPage, summary='Read audit with exact bounded engineering-defined filters')
def audit(filters: Annotated[AuditFilter, Query()], service: Annotated[AuditService, Depends(get_audit_service)]) -> AuditPage:
    """Read actual persisted events with bounded filters."""
    return service.list(filters)


@router.post('/audit/export', response_model=ProblemEnvelope, status_code=409, summary='Disclose blocked audit export definition')
def export(filters: AuditFilter, service: Annotated[AuditService, Depends(get_audit_service)]) -> JSONResponse:
    """Return actionable dependency-unavailable feedback, never an invented file."""
    try:
        service.export(filters)
    except AdminFailure as error:
        return JSONResponse(status_code=error.status, content={'error': {'code': error.code, 'message': str(error), 'details': error.details}})
    raise RuntimeError('Export must remain unavailable')
