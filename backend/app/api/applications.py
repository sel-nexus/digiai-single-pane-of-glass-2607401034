"""Expose thin synchronous Application 360 reads via dependency injection."""
from typing import Annotated
from fastapi import APIRouter, Depends, Request
from app.api.dashboard import get_context
from app.domain.application_service import ApplicationService
from app.schemas.contracts import ApplicationProfile, Envelope, QueryContext

router = APIRouter(prefix='/api/v1', tags=['Applications'])


def get_service(request: Request) -> ApplicationService:
    """Resolve the lifespan-owned service with dependency override support."""
    return request.app.state.application_service


@router.get('/applications/{applicationId}', response_model=Envelope[ApplicationProfile | None],
            summary='Read exact source-associated Application 360')
def application(applicationId: str, service: Annotated[ApplicationService, Depends(get_service)],
                context: Annotated[QueryContext, Depends(get_context)]) -> Envelope[ApplicationProfile | None]:
    """Delegate the opaque identity and selected scope without fallback."""
    return service.profile(applicationId, context)
