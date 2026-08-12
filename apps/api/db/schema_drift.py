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

It does, however, print the SQL it would take. The dealers outage went like
this: the report named the missing columns in a log nobody had reason to read
closely, and the next person to see them was a dealer getting a 500. Writing
out the exact ALTER statements turns "something is wrong" into something an
operator can paste into a migration and review in a minute, which is the
difference between a drift being fixed and a drift being noted.
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
    repairs: list[str] = []

    def _inspect(sync_conn) -> tuple[list[str], list[str]]:
        # SQLAlchemy's inspector rather than information_schema: the same code
        # then answers for the SQLite databases the tests and local development
        # use, so this is exercised rather than merely deployed.
        inspector = inspect(sync_conn)
        existing_tables = set(inspector.get_table_names())
        found: list[str] = []
        sql: list[str] = []

        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                found.append(f"table {table.name} is missing entirely")
                # No CREATE TABLE is offered. A whole missing table means the
                # migration that creates it never ran, and the fix is to find
                # out why — not to conjure the table from the model and leave
                # the migration history still wrong.
                continue

            present = {c["name"] for c in inspector.get_columns(table.name)}
            missing = [c for c in table.columns if c.name not in present]
            if missing:
                found.append(
                    f"{table.name} is missing: "
                    f"{', '.join(sorted(c.name for c in missing))}"
                )
                sql.extend(_add_column_sql(table.name, c, sync_conn) for c in missing)

        return found, sql

    try:
        async with engine.connect() as conn:
            problems, repairs = await conn.run_sync(_inspect)
    except Exception as exc:  # noqa: BLE001 — a diagnostic must not break startup
        _log.warning("Could not compare the schema against the models: %s", exc)
        return []

    if problems:
        # Error level, and every problem in one message: this is the difference
        # between one deploy and one deploy per column.
        message = (
            "Schema does not match the models — queries touching these will "
            "fail:\n  " + "\n  ".join(problems)
        )
        if repairs:
            message += (
                "\n\nThe missing columns would be added by the following. Put "
                "this in a migration rather than running it by hand — running "
                "it by hand is how this drift started:\n  "
                + "\n  ".join(repairs)
            )
        _log.error(message)
    else:
        _log.info("Schema matches the models")

    return problems


def _add_column_sql(table_name: str, column, sync_conn) -> str:
    """
    The ALTER that would add one missing column, in this database's dialect.

    NULL regardless of what the model says. A NOT NULL column cannot be added
    to a table that already has rows without a default, and guessing a default
    for someone else's data is not a diagnostic's job — an operator tightening
    it afterwards is a decision they can make with the rows in front of them.
    """
    try:
        type_sql = column.type.compile(dialect=sync_conn.dialect)
    except Exception:  # noqa: BLE001 — a type we cannot render must not break the report
        type_sql = "/* unrenderable type — see the model */"
    return f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {column.name} {type_sql} NULL;"
