"""Shared pytest fixtures and configuration."""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import StaticPool

from db.base import Base
from db.session import get_db
from main import app

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture
async def db_engine():
    """Per-test in-memory SQLite engine.

    Holds an explicit connection reference for the entire fixture lifetime so
    the aiosqlite connection is not garbage-collected between requests on
    Python 3.12+ (which would wipe the in-memory DB and cause 'no such table'
    errors mid-test).
    """
    engine = create_async_engine(
        TEST_DB_URL,
        echo=False,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    conn = await engine.connect()
    await conn.run_sync(Base.metadata.create_all)
    yield engine
    await conn.run_sync(Base.metadata.drop_all)
    await conn.close()
    await engine.dispose()


@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    """Ensure app.dependency_overrides is always clean between tests.

    If a test fixture crashes before its cleanup runs, stale overrides would
    cause subsequent tests to use a dropped in-memory DB and fail with
    'no such table' errors.
    """
    yield
    app.dependency_overrides.pop(get_db, None)
