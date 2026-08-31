"""
The migration chain must build the schema the models declare.

CI already checks that the migrations apply cleanly to an empty Postgres. That
catches a broken chain, but not a chain that succeeds and produces the wrong
shape — a model column nobody wrote a migration for applies perfectly and then
500s in production the first time a query names it.

This is the other half. It runs the real chain against a real Postgres and
compares the result to Base.metadata, so the mismatch is a red PR instead of an
error in a log.

WHAT THIS WOULD AND WOULD NOT HAVE CAUGHT

Not the dealers outage. There, migration 0001 declared city/state/gst_number/
rating and the models agreed — the two halves this test compares were in
perfect agreement. Production was simply not built from the migrations: it came
from schema_setup_batch1_enums_and_core.sql, which disagrees with both, and no
CI job can see that from here. Only the startup drift report can, which is why
that report now prints repair SQL.

What it does catch is the direction that CI *can* see: a model that has moved
ahead of the migrations. That is the same class of fault and the cheaper half
to prevent, since it is caught before merge rather than after deploy.

Skipped unless a Postgres URL is configured, so the SQLite suite stays green
locally without a server.
"""
import os
import subprocess
import uuid

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine


def _postgres_url() -> str:
    """
    Whichever Postgres URL this environment provides.

    Both names are checked because CI uses both: the migration step sets
    DATABASE_URL and the test step sets TEST_DATABASE_URL. Reading only one
    would make this skip silently in the other, and a guard that skips without
    saying so is indistinguishable from a guard that passes.
    """
    for name in ("DATABASE_URL", "TEST_DATABASE_URL"):
        value = os.getenv(name) or ""
        if "postgresql" in value:
            return value
    return ""


pytestmark = pytest.mark.skipif(
    not _postgres_url(),
    reason="needs a Postgres URL; the migration chain is Postgres-shaped",
)


def _async_url(url: str) -> str:
    """This project speaks asyncpg; psycopg2 is not installed."""
    return url.replace("postgresql://", "postgresql+asyncpg://")


@pytest.fixture
async def migrated_database():
    """A throwaway database with the whole migration chain applied."""
    base = _async_url(_postgres_url())
    admin_url, _, _ = base.rpartition("/")
    name = f"gaadiiq_chain_{uuid.uuid4().hex[:10]}"

    # CREATE DATABASE cannot run inside a transaction block.
    admin = create_async_engine(f"{admin_url}/postgres", isolation_level="AUTOCOMMIT")
    async with admin.connect() as conn:
        await conn.execute(text(f'CREATE DATABASE "{name}"'))

    url = f"{admin_url}/{name}"
    env = {
        **os.environ,
        "DATABASE_URL": url,
        "ASYNC_DATABASE_URL": url,
        "ENVIRONMENT": "development",
    }
    result = subprocess.run(
        ["alembic", "upgrade", "head"],
        env=env, capture_output=True, text=True,
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    )
    assert result.returncode == 0, f"alembic upgrade head failed:\n{result.stderr}"

    engine = create_async_engine(url)
    try:
        yield engine
    finally:
        await engine.dispose()
        async with admin.connect() as conn:
            await conn.execute(
                text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = :n AND pid <> pg_backend_pid()"
                ),
                {"n": name},
            )
            await conn.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
        await admin.dispose()


@pytest.mark.asyncio
async def test_every_model_table_and_column_exists_after_migrating(migrated_database):
    import models  # noqa: F401 — registers every model on Base.metadata
    from db.base import Base

    def _compare(sync_conn):
        inspector = inspect(sync_conn)
        existing = set(inspector.get_table_names())
        missing_tables = [
            t.name for t in Base.metadata.sorted_tables if t.name not in existing
        ]
        missing_columns = []
        for table in Base.metadata.sorted_tables:
            if table.name not in existing:
                continue
            present = {c["name"] for c in inspector.get_columns(table.name)}
            missing_columns.extend(
                f"{table.name}.{c.name}" for c in table.columns if c.name not in present
            )
        return missing_tables, missing_columns

    async with migrated_database.connect() as conn:
        missing_tables, missing_columns = await conn.run_sync(_compare)

    assert not missing_tables, (
        "The models declare tables no migration creates. A deploy would apply "
        "cleanly and then 500 on the first query naming one:\n  "
        + "\n  ".join(sorted(missing_tables))
    )
    assert not missing_columns, (
        "The models declare columns no migration creates. This is the dealers "
        "outage in miniature — it applies fine and fails on the first SELECT:\n  "
        + "\n  ".join(sorted(missing_columns))
    )


@pytest.mark.asyncio
async def test_every_model_enum_label_exists_after_migrating(migrated_database):
    """
    A member added to a Python enum and not to the Postgres type.

    Twice in production now, both in the same dispatch, both after the row had
    already been written so the customer saw a failure against a job that
    existed:

        UndefinedObjectError: type "notification_type" does not exist
        [parameters: (UUID(...), 'job_offer', 'New job 0.02 km away', ...)]

        InvalidTextRepresentationError: invalid input value for enum
        whatsapp_template: "job_offer"
        [parameters: ('9199...', 'job_offer', '{"reference": "SR-92A19C", ...}')]

    Migration 0036 fixed the first. Nothing checked the other enum in the same
    INSERT, so the flow moved one step further and stopped again on the same
    class of bug.

    The table-and-column comparison above cannot see this: the column exists
    and has the right type, and only the LABEL is missing. SQLite cannot see it
    either — it stores these columns as text and accepts anything — which is
    how a fully green run ships it.

    Extra labels in the database are not failures. A migration may add one
    ahead of the code, and removing a label from a PostgreSQL enum means
    recreating the type, so they legitimately outlive the member that needed
    them.
    """
    import models  # noqa: F401 — registers every model on Base.metadata
    from db.base import Base

    def _compare(sync_conn):
        inspector = inspect(sync_conn)
        # {type name: {labels}} as the migrated database actually has them.
        in_db = {e["name"]: set(e["labels"]) for e in inspector.get_enums()}

        missing = []
        for table in Base.metadata.sorted_tables:
            for column in table.columns:
                enum_type = getattr(column.type, "enums", None)
                name = getattr(column.type, "name", None)
                # Native enums only: a plain string column has no type name to
                # look up, and VARCHAR accepts every value anyway.
                if not enum_type or not name or name not in in_db:
                    continue
                for label in enum_type:
                    if label not in in_db[name]:
                        missing.append(f"{name}.{label} ({table.name}.{column.name})")
        return missing

    async with migrated_database.connect() as conn:
        missing = await conn.run_sync(_compare)

    assert not missing, (
        "The models can produce enum labels the migrated database does not "
        "have. The insert applies right up to the cast and then fails with "
        "InvalidTextRepresentation — after any row written earlier in the same "
        "flow:\n  " + "\n  ".join(sorted(missing))
    )


@pytest.mark.asyncio
async def test_the_enum_check_would_have_caught_job_offer(migrated_database):
    """
    The check above is only worth having if it fails on the real bug.

    Asserting the property directly: whatsapp_template must carry every member
    of the ORM's WhatsAppTemplate. Before migration 0049 this fails on
    'job_offer' — the production error — and the general test above fails with
    it.
    """
    from models.whatsapp_message import WhatsAppTemplate

    def _labels(sync_conn):
        return {
            e["name"]: set(e["labels"]) for e in inspect(sync_conn).get_enums()
        }.get("whatsapp_template", set())

    async with migrated_database.connect() as conn:
        labels = await conn.run_sync(_labels)

    assert "job_offer" in labels, "the dispatch broadcast cannot be recorded without it"
    assert {m.value for m in WhatsAppTemplate} <= labels
