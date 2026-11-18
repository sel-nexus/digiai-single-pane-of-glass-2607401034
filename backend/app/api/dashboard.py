"""Expose thin persona, dashboard and KPI read routes."""
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, Query, Request
from app.domain.kpi_service import KpiService
from app.schemas.contracts import Dashboard, Envelope, MetricValue, Persona, QueryContext

router = APIRouter(prefix='/api/v1', tags=['Dashboard'])


def get_service(request: Request) -> KpiService:
    """Resolve the lifespan-initialized service for dependency override support."""
    return request.app.state.kpi_service


def get_context(request: Request, personaId: Annotated[str | None, Query(min_length=1, max_length=100)] = None, hierarchyNodeId: Annotated[str | None, Query(min_length=1, max_length=100)] = None) -> QueryContext:
    """Collect repeated shared filter parameters without silently dropping scope."""
    dimensions = ('domain', 'portfolio', 'application', 'environment', 'criticality', 'dateRange', 'toolSource', 'incidentSeverity')
    return QueryContext(personaId=personaId, hierarchyNodeId=hierarchyNodeId, filters={key: request.query_params.getlist(key) for key in dimensions if request.query_params.getlist(key)})


@router.get('/personas', response_model=Envelope[list[Persona]], summary='List approved mock personas')
def personas(service: Annotated[KpiService, Depends(get_service)]) -> Envelope[list[Persona]]:
    """Return the bounded catalog; no selection is made by this read."""
    items = service.personas()
    return Envelope(data=items, availability='available' if items else 'unavailable')


@router.get('/dashboard', response_model=Envelope[Dashboard], summary='Read persona-isolated dashboard')
def dashboard(service: Annotated[KpiService, Depends(get_service)], context: Annotated[QueryContext, Depends(get_context)], personaId: Annotated[str, Query(min_length=1, max_length=100)], period: Literal['day', 'week', 'month', 'quarter'] = 'month') -> Envelope[Dashboard]:
    """Delegate validated context and exact period to the domain service."""
    return service.dashboard(context, period)


@router.get('/kpis', response_model=Envelope[list[MetricValue]], summary='Read supplied KPI family')
def kpis(service: Annotated[KpiService, Depends(get_service)], context: Annotated[QueryContext, Depends(get_context)], family: Literal['enterprise', 'reliability', 'release', 'qe', 'security', 'transformation'], period: Literal['day', 'week', 'month', 'quarter'] = 'month') -> Envelope[list[MetricValue]]:
    """Retrieve supplied measures without formulas or time-series synthesis."""
    return service.summary(context, period, family)
