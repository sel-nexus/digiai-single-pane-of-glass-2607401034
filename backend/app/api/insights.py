"""Expose typed read-only insights through injected SQLite-backed services."""
from typing import Annotated
from fastapi import APIRouter, Depends, Query, Request
from app.api.dashboard import get_context
from app.api.domains import pagination
from app.domain.entity_service import DIMENSIONS
from app.domain.insights_service import InsightsService
from app.schemas.contracts import QueryContext, RecommendationsPage, TransformationPage

router = APIRouter(prefix='/api/v1', tags=['Insights'])


def get_service(request: Request) -> InsightsService:
    """Resolve the lifespan-owned service, allowing dependency overrides in tests."""
    return request.app.state.insights_service


def insights_context(request: Request, context: Annotated[QueryContext, Depends(get_context)]) -> QueryContext:
    """Retain unknown selected dimensions for explicit fail-closed availability."""
    controls = {'applicationId'} | ({'period'} if request.url.path.endswith('/transformation') else set())
    known = set(DIMENSIONS) | controls | {'personaId', 'hierarchyNodeId', 'limit', 'cursor'}
    extra = {key: request.query_params.getlist(key) for key in request.query_params if key not in known}
    return context.model_copy(update={'filters': context.filters | extra})


@router.get('/recommendations', response_model=RecommendationsPage, summary='Read per-item mock explanations')
def recommendations(service: Annotated[InsightsService, Depends(get_service)],
                    context: Annotated[QueryContext, Depends(insights_context)],
                    page: Annotated[dict, Depends(pagination)],
                    applicationId: Annotated[str | None, Query(min_length=1, max_length=200)] = None) -> RecommendationsPage:
    """Delegate bounded source-associated reads without any live AI calls."""
    return service.recommendations(context, applicationId, **page)


@router.get('/transformation', response_model=TransformationPage, summary='Read supplied measures and explicit series')
def transformation(service: Annotated[InsightsService, Depends(get_service)],
                   context: Annotated[QueryContext, Depends(insights_context)],
                   page: Annotated[dict, Depends(pagination)],
                   applicationId: Annotated[str | None, Query(min_length=1, max_length=200)] = None,
                   period: Annotated[str | None, Query(min_length=1, max_length=100, pattern=r'^\S(?:.*\S)?$')] = None) -> TransformationPage:
    """Read exact source periods; unsupported periods never fall back to another value."""
    return service.transformation(context, applicationId, period, **page)
