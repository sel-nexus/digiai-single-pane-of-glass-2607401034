"""Expose bounded read-only operations routes with shared display context."""
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, Query, Request
from app.api.dashboard import get_context
from app.api.domains import pagination
from app.domain.entity_service import DIMENSIONS
from app.domain.operations_service import OperationsService
from app.schemas.contracts import CorrelationsPage, OperationsMetricsPage, OperationsPage, QueryContext

router = APIRouter(prefix='/api/v1/operations', tags=['Operations'])


def get_service(request: Request) -> OperationsService:
    """Resolve the lifespan-owned service for dependency injection."""
    return request.app.state.operations_service


def operations_context(request: Request, context: Annotated[QueryContext, Depends(get_context)]) -> QueryContext:
    """Report unsupported query filters rather than silently serving unfiltered data."""
    controls = {'incidents': {'incidentId', 'recordType'}, 'correlations': {'incidentId'},
                'metrics': {'period'}, 'observability': set()}
    known = set(DIMENSIONS) | {'personaId', 'hierarchyNodeId', 'limit', 'cursor'} | controls[request.url.path.rsplit('/', 1)[-1]]
    extra = {key: request.query_params.getlist(key) for key in request.query_params if key not in known}
    return context.model_copy(update={'filters': context.filters | extra})


@router.get('/incidents', response_model=OperationsPage, summary='Read distinct operational record types')
def incidents(service: Annotated[OperationsService, Depends(get_service)],
              context: Annotated[QueryContext, Depends(operations_context)],
              page: Annotated[dict, Depends(pagination)],
              recordType: Literal['incident', 'problem_rca', 'major_incident'] | None = None,
              incidentId: Annotated[str | None, Query(min_length=1, max_length=200)] = None) -> OperationsPage:
    """Delegate exact identity, type selection and bounded shared scope."""
    return service.incidents(context, record_type=recordType, incident_id=incidentId, **page)


@router.get('/correlations', response_model=CorrelationsPage, summary='Read represented non-causal correlations')
def correlations(incidentId: Annotated[str, Query(min_length=1, max_length=200)],
                 service: Annotated[OperationsService, Depends(get_service)],
                 context: Annotated[QueryContext, Depends(operations_context)],
                 page: Annotated[dict, Depends(pagination)]) -> CorrelationsPage:
    """Read only explicit relationship links for the exact selected record."""
    return service.correlations(incidentId, context, **page)


@router.get('/metrics', response_model=OperationsMetricsPage, summary='Read nine supplied reliability measures')
def metrics(service: Annotated[OperationsService, Depends(get_service)],
            context: Annotated[QueryContext, Depends(operations_context)],
            page: Annotated[dict, Depends(pagination)],
            period: Literal['day', 'week', 'month', 'quarter'] = 'month') -> OperationsMetricsPage:
    """Keep requested period exact and absent values unavailable."""
    return service.metrics(context, period, **page)


@router.get('/observability', response_model=OperationsPage, summary='Read supplied observability summaries')
def observability(service: Annotated[OperationsService, Depends(get_service)],
                  context: Annotated[QueryContext, Depends(operations_context)],
                  page: Annotated[dict, Depends(pagination)]) -> OperationsPage:
    """Return summary signals and direct app/service context, never live telemetry."""
    return service.observability(context, **page)
