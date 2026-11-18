"""Expose synchronous journey reads through injected domain services."""
from typing import Annotated
from fastapi import APIRouter, Depends, Request
from app.api.dashboard import get_context
from app.api.domains import pagination
from app.domain.journey_service import JourneyService
from app.schemas.contracts import EntityPage, Envelope, JourneyDetail, QueryContext

router = APIRouter(prefix='/api/v1', tags=['Journeys'])


def get_service(request: Request) -> JourneyService:
    """Resolve the lifespan-owned service for dependency override support."""
    return request.app.state.journey_service


@router.get('/journeys', response_model=EntityPage, summary='List represented journeys')
def journeys(service: Annotated[JourneyService, Depends(get_service)],
             context: Annotated[QueryContext, Depends(get_context)],
             page: Annotated[dict, Depends(pagination)]) -> EntityPage:
    """Delegate bounded identities and shared context unchanged."""
    return service.list_journeys(context, **page)


@router.get('/journeys/{journeyId}', response_model=Envelope[JourneyDetail | None],
            summary='Read represented journey relationships')
def journey(journeyId: str, service: Annotated[JourneyService, Depends(get_service)],
            context: Annotated[QueryContext, Depends(get_context)]) -> Envelope[JourneyDetail | None]:
    """Resolve the exact opaque identifier, never a fallback journey."""
    return service.relationships(journeyId, context)
