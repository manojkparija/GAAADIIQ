"""
Report where the database disagrees with the models, all at once.

This deployment has spent a working day discovering missing columns one at a
time: listings.price, then cars.fuel_type, then cars.updated_at. Each cost a
deploy, an upload attempt, a 500, and a read of the traceback — and each
revealed exactly one column, because a SELECT fails on the first one Postgres
cannot resolve and says nothing about the rest.

Comparing the models against the live schema answers the whole question in one
pass, at startup, before anyone tries to use the thing. What made the gaps
expensive was never their number; it was learning about them one per attempt.

This reports; it does not repair. A migration is where a schema change belongs,
where it is reviewed and recorded. Silently patching the database from the
model at startup would leave no trace of what ran against production, which is
how the schema drifted this far apart in the first place.
"""
from __future__ import annotations

import logging

from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import AsyncEngine

_log = logging.getLogger("gaadiiq.schema")


async def report_schema_drift(engine: AsyncEngine) -> list[str]:
    """
    Log every table the models declare that the database lacks, and every
    column missing from the tables it does have.

    Returns the problems as a list, mainly so tests can assert on them.
    Non-fatal by design: a database that cannot be inspected must not stop the
    service from starting, and a drift report is a diagnostic, not a gate.
    """
    # Imported here rather than at module scope: importing the models pulls in
    # most of the application, and this module is imported during startup.
    import models  # noqa: F401 — registers every model on Base.metadata
    from db.base import Base

    problems: list[str] = []

    def _inspect(sync_conn) -> list[str]:
        # SQLAlchemy's inspector rather than information_schema: the same code
        # then answers for the SQLite databases the tests and local development
        # use, so this is exercised rather than merely deployed.
        inspector = inspect(sync_conn)
        existing_tables = set(inspector.get_table_names())
        found: list[str] = []

        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                found.append(f"table {table.name} is missing entirely")
                continue

            present = {c["name"] for c in inspector.get_columns(table.name)}
            missing = [c.name for c in table.columns if c.name not in present]
            if missing:
                found.append(f"{table.name} is missing: {', '.join(sorted(missing))}")

        return found

    try:
        async with engine.connect() as conn:
            problems = await conn.run_sync(_inspect)
    except Exception as exc:  # noqa: BLE001 — a diagnostic must not break startup
        _log.warning("Could not compare the schema against the models: %s", exc)
        return []

    if problems:
        # Error level, and every problem in one message: this is the difference
        # between one deploy and one deploy per column.
        _log.error(
            "Schema does not match the models — queries touching these will "
            "fail:\n  %s",
            "\n  ".join(problems),
        )
    else:
        _log.info("Schema matches the models")

    return problems
