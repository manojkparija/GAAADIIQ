"""Shared pytest fixtures and configuration.

The suite runs on SQLite by default, and on Postgres when `TEST_DATABASE_URL`
is set. Both matter, and for different reasons.

SQLite keeps the local loop fast — no server to start, a fresh database per
test, and it is what a developer gets by just running `pytest`. But production
is Postgres, and the two disagree about things this codebase relies on: native
enums, `NOT NULL` semantics, casting. A green SQLite run says nothing about any
of them, and that gap has already produced a wrong diagnosis of a live outage.
So CI runs the suite a second time against a real Postgres.
"""
import os

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from db.base import Base
from db.session import get_db
from main import app

#: Set by CI to a Postgres DSN. Absent locally, where SQLite is the default.
TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "").strip()

#: True when the suite is running against Postgres. Prefer writing tests that
#: pass on both over branching on this.
ON_POSTGRES = TEST_DATABASE_URL.startswith(("postgresql", "postgres"))


def _postgres_url() -> str:
    """Normalise to the async driver the app uses."""
    url = TEST_DATABASE_URL
    if url.startswith("postgresql+asyncpg://"):
        return url
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return url.replace("postgresql://", "postgresql+asyncpg://", 1)


async def _reset(conn) -> None:
    """Empty every table.

    Two details, both learned the hard way:

    `TRUNCATE` needs an ACCESS EXCLUSIVE lock, and at least one test leaves a
    session open with an uncommitted transaction. Against a shared database
    that is a deadlock — the cleanup waits forever on a connection that is
    never coming back, and the whole suite hangs with no output. `lock_timeout`
    turns that into an error instead of a hang, and any backend still holding
    the table is terminated before retrying. Brutal, and correct for a database
    whose entire purpose is to be thrown away between tests.

    RESTART IDENTITY so sequences do not carry values across tests; CASCADE so
    the foreign-key order does not have to be worked out here.
    """
    tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    if not tables:
        return

    await conn.exec_driver_sql("SET lock_timeout = '5s'")
    try:
        await conn.exec_driver_sql(f"TRUNCATE {tables} RESTART IDENTITY CASCADE")
        return
    except Exception:
        pass

    await conn.exec_driver_sql(
        """
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND state = 'idle in transaction'
        """
    )
    await conn.exec_driver_sql(f"TRUNCATE {tables} RESTART IDENTITY CASCADE")


#: Whether the Postgres schema has been built yet this session.
#:
#: A module flag rather than a session-scoped fixture: pytest-asyncio runs each
#: async fixture on the test's own event loop, so a session-scoped async fixture
#: is destroyed the moment the first test's loop closes. Building the schema is
#: the expensive part and only needs doing once; the engine itself is cheap.
_SCHEMA_READY = False


@pytest_asyncio.fixture
async def db_engine(tmp_path):
    """A clean database for each test.

    On SQLite that is a fresh file. On Postgres the schema is built once and
    the tables are emptied around each test — the same isolation for far less
    work, since truncating empty tables costs almost nothing and creating
    sixty-odd of them per test put the suite on course for the better part of
    an hour.
    """
    global _SCHEMA_READY

    if ON_POSTGRES:
        engine = create_async_engine(_postgres_url(), echo=False)
        async with engine.begin() as conn:
            if not _SCHEMA_READY:
                await conn.run_sync(Base.metadata.drop_all)
                await conn.run_sync(Base.metadata.create_all)
                _SCHEMA_READY = True
            else:
                await _reset(conn)
        try:
            yield engine
        finally:
            # Deliberately no truncate here. pytest-asyncio can run an async
            # fixture's teardown late — after the next test has already started
            # — and a stray TRUNCATE landing mid-test deletes the user whose
            # token that test is holding. It surfaced as a 401 from an endpoint
            # that had just authenticated successfully, which is a miserable
            # thing to debug. Emptying the tables on the way *in* is enough:
            # every test still starts from nothing.
            await engine.dispose()
        return

    # A real file rather than in-memory SQLite: a Python 3.12 GC bug collects
    # aiosqlite connections held by StaticPool mid-test, dropping every table
    # and producing spurious 'no such table' errors.
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
