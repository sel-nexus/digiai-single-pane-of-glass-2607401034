"""Expose dependency-free process liveness."""
from fastapi import APIRouter
from app.schemas.contracts import Health

router = APIRouter(prefix='/api', tags=['Health'])


@router.get('/health', response_model=Health, summary='Check process liveness')
def health() -> Health:
    """Return liveness without reading database or secrets."""
    return Health()
