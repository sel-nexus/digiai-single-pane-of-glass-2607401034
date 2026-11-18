"""Expose thin read-only readiness routes with shared scope and bounded lists."""
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, Query, Request
from app.api.dashboard import get_context
from app.api.domains import pagination
from app.domain.entity_service import DIMENSIONS
from app.domain.readiness_service import ReadinessService
from app.schemas.contracts import QueryContext, ReadinessEvidencePage, ReadinessMetricsPage

router = APIRouter(prefix='/api/v1/readiness', tags=['Readiness'])


def get_service(request: Request) -> ReadinessService:
    """Resolve the lifespan-owned service for dependency overrides."""
    return request.app.state.readiness_service


def readiness_context(request: Request, context: Annotated[QueryContext, Depends(get_context)]) -> QueryContext:
    """Retain unknown selected dimensions so the service can fail closed."""
    controls = {'applicationId', 'releaseId', 'period'} if request.url.path.endswith('/evidence') else {'family', 'period'}
    known = set(DIMENSIONS) | controls | {'personaId', 'hierarchyNodeId', 'limit', 'cursor'}
    extra = {key: request.query_params.getlist(key) for key in request.query_params if key not in known}
    return context.model_copy(update={'filters': context.filters | extra})


@router.get('/evidence', response_model=ReadinessEvidencePage, summary='Read five supplied release evidence categories')
def evidence(service: Annotated[ReadinessService, Depends(get_service)],
             context: Annotated[QueryContext, Depends(readiness_context)],
             page: Annotated[dict, Depends(pagination)],
             applicationId: Annotated[str | None, Query(min_length=1, max_length=200)] = None,
             releaseId: Annotated[str | None, Query(min_length=1, max_length=200)] = None,
             period: Literal['day', 'week', 'month', 'quarter'] = 'month') -> ReadinessEvidencePage:
    """Delegate exact identity and period without computing a readiness decision."""
    return service.evidence(context, applicationId, releaseId, period, **page)


@router.get('/metrics', response_model=ReadinessMetricsPage, summary='Read named release QE or security measures')
def metrics(family: Literal['release', 'qe', 'security'],
            service: Annotated[ReadinessService, Depends(get_service)],
            context: Annotated[QueryContext, Depends(readiness_context)],
            page: Annotated[dict, Depends(pagination)],
            period: Literal['day', 'week', 'month', 'quarter'] = 'month') -> ReadinessMetricsPage:
    """Read source values for an exact family and reporting period."""
    return service.metrics(context, family, period, **page)
