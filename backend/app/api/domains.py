"""Expose thin validated shared discovery reads."""
from typing import Annotated
from fastapi import APIRouter, Depends, Query, Request
from app.api.dashboard import get_context
from app.domain.entity_service import EntityService
from app.schemas.contracts import EntityPage, EntityType, Envelope, FilterOption, HierarchyPage, QueryContext

router = APIRouter(prefix='/api/v1', tags=['Discovery'])


def get_service(request: Request) -> EntityService:
    """Resolve the lifespan-initialized entity service."""
    return request.app.state.entity_service


def pagination(limit: Annotated[int, Query(ge=1, le=100)] = 50,
               cursor: Annotated[str | None, Query(pattern=r'^(0|[1-9][0-9]{0,6})$')] = None) -> dict:
    """Collect bounded canonical offset pagination."""
    return {'limit': limit, 'cursor': cursor}


@router.get('/entities', response_model=EntityPage, summary='Discover exact source entities')
def entities(service: Annotated[EntityService, Depends(get_service)],
             context: Annotated[QueryContext, Depends(get_context)],
             page: Annotated[dict, Depends(pagination)], type: EntityType | None = None,
             q: Annotated[str, Query(max_length=200)] = '') -> EntityPage:
    """Delegate search and scope without creating detail semantics."""
    return service.entities(context, type, q, **page)


@router.get('/hierarchy', response_model=HierarchyPage, summary='Read represented hierarchy children')
def hierarchy(service: Annotated[EntityService, Depends(get_service)],
              context: Annotated[QueryContext, Depends(get_context)],
              page: Annotated[dict, Depends(pagination)],
              parentId: Annotated[str | None, Query(min_length=1, max_length=100)] = None) -> HierarchyPage:
    """Return only current-parent represented children and ancestors."""
    return service.hierarchy(context, parentId, **page)


@router.get('/filters/options', response_model=Envelope[dict[str, list[FilterOption]]], summary='Read eight source filter facets')
def options(service: Annotated[EntityService, Depends(get_service)],
            context: Annotated[QueryContext, Depends(get_context)]) -> Envelope[dict[str, list[FilterOption]]]:
    """Delegate exact-value facet discovery to the service."""
    return service.options(context)
