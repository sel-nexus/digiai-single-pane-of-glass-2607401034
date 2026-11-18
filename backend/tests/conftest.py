"""Provide isolated real SQLite files and lifespan-initialized HTTP clients."""
from pathlib import Path
from typing import AsyncIterator
import httpx
import pytest
from app.core.config import Settings
from app.main import create_app
from app.storage.seed import seed_database
from app.storage.sqlite_repository import SqliteRepository


@pytest.fixture
def repository(tmp_path: Path) -> SqliteRepository:
    """Migrate and seed a fresh file for each service test."""
    store = SqliteRepository(str(tmp_path / 'sample.db'))
    store.migrate()
    seed_database(store)
    return store


@pytest.fixture
async def client(tmp_path: Path) -> AsyncIterator[httpx.AsyncClient]:
    """Exercise real routes and storage with no network or database mocks."""
    application = create_app(Settings(database_path=str(tmp_path / 'api.db')))
    async with application.router.lifespan_context(application):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url='http://test') as session:
            yield session
