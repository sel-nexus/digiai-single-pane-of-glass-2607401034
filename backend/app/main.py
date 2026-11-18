"""Assemble the API and initialize file storage only during lifespan startup."""
from contextlib import asynccontextmanager
import logging
import sqlite3
from typing import AsyncIterator
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException
from starlette.concurrency import run_in_threadpool
from app.api.dashboard import router as dashboard_router
from app.api.domains import router as domains_router
from app.api.health import router as health_router
from app.api.journeys import router as journeys_router
from app.core.config import Settings
from app.domain.kpi_service import KpiService
from app.domain.entity_service import EntityService
from app.domain.journey_service import JourneyService
from app.storage.seed import seed_database
from app.storage.sqlite_repository import SqliteRepository

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create an independently configured app for runtime or file-backed tests."""
    config = settings or Settings()
    logging.basicConfig(level=config.log_level)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        """Migrate then seed off the event loop; fail startup on invalid history."""
        repository = SqliteRepository(config.database_path)
        await run_in_threadpool(repository.migrate)
        if config.seed_on_startup:
            await run_in_threadpool(seed_database, repository)
        application.state.repository = repository
        application.state.kpi_service = KpiService(repository)
        application.state.entity_service = EntityService(repository)
        application.state.journey_service = JourneyService(repository, application.state.entity_service)
        yield

    application = FastAPI(title='DigiAI Single Pane of Glass', version='1.0.0', description='Synthetic prototype evidence. Mock personas are not authentication.', lifespan=lifespan)
    application.add_middleware(CORSMiddleware, allow_origins=config.origins, allow_credentials=False, allow_methods=['GET'], allow_headers=['Content-Type'])
    application.include_router(health_router)
    application.include_router(dashboard_router)
    application.include_router(domains_router)
    application.include_router(journeys_router)

    @application.middleware('http')
    async def no_dynamic_cache(request: Request, call_next) -> object:
        """Prevent persona-dependent responses being reused by intermediaries."""
        response = await call_next(request)
        if request.url.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    @application.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError) -> JSONResponse:
        """Return actionable public validation issues in the common envelope."""
        issues = [{'location': list(item['loc']), 'message': item['msg']} for item in error.errors()]
        return JSONResponse(status_code=422, content={'error': {'code': 'INVALID_REQUEST', 'message': 'Check the supplied query parameters.', 'details': {'issues': issues}}})

    @application.exception_handler(LookupError)
    async def missing_resource(request: Request, error: LookupError) -> JSONResponse:
        """Report unknown represented configuration as not found."""
        return JSONResponse(status_code=404, content={'error': {'code': 'RESOURCE_NOT_FOUND', 'message': str(error), 'details': {}}})

    @application.exception_handler(HTTPException)
    async def http_error(request: Request, error: HTTPException) -> JSONResponse:
        """Keep unavailable routes and other HTTP errors envelope-compatible."""
        return JSONResponse(status_code=error.status_code, content={'error': {'code': 'HTTP_ERROR', 'message': str(error.detail), 'details': {}}})

    @application.exception_handler(sqlite3.Error)
    async def storage_error(request: Request, error: sqlite3.Error) -> JSONResponse:
        """Surface read storage failures without returning stale evidence."""
        logger.error('Prototype storage unavailable', exc_info=error)
        return JSONResponse(status_code=503, content={'error': {'code': 'STORAGE_UNAVAILABLE', 'message': 'Prototype storage is unavailable. Try the read again.', 'details': {}}})

    @application.exception_handler(Exception)
    async def internal_error(request: Request, error: Exception) -> JSONResponse:
        """Log unexpected failures and suppress implementation details."""
        logger.error('Unhandled API failure', exc_info=error)
        return JSONResponse(status_code=500, content={'error': {'code': 'INTERNAL_ERROR', 'message': 'Unable to read prototype evidence.', 'details': {}}})

    return application


app = create_app()

if __name__ == '__main__':
    import uvicorn
    runtime = Settings()
    uvicorn.run('app.main:app', host=runtime.bind_host, port=runtime.bind_port)
