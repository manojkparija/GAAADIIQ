"""Shared pytest fixtures and configuration."""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from db.base import Base
from db.session import get_db
from main import app


@pytest_asyncio.fixture
async def db_engine(tmp_path):
    """Per-test file-based SQLite engine.

    Using a real file on disk instead of in-memory SQLite avoids a Python
    3.12 GC bug where aiosqlite connections held by StaticPool get collected
    mid-test, dropping all tables and causing spurious 'no such table' errors.
    """
    db_path = tmp_path / "test.db"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{db_path}",
        echo=False,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine):
    """Async SQLAlchemy session for tests."""
    async with AsyncSession(db_engine, expire_on_commit=False) as session:
        yield session
        await session.rollback()


@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    """Ensure app.dependency_overrides is always clean between tests.

    If a test fixture crashes before its cleanup runs, stale overrides would
    cause subsequent tests to use a dropped in-memory DB and fail with
    'no such table' errors.
    """
    yield
    app.dependency_overrides.pop(get_db, None)
