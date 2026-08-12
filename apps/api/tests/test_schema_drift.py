"""
The schema report must name every gap, not the first one.

Finding missing columns through failing queries costs a deploy per column,
because a SELECT stops at the first name Postgres cannot resolve. That is how
this deployment spent a day on listings.price, then cars.fuel_type, then
cars.updated_at — three separate discoveries of the same class of fault.
"""
import logging

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from db.schema_drift import report_schema_drift


@pytest.mark.asyncio
async def test_a_matching_schema_reports_nothing(db_engine):
    # db_engine is built from the models themselves, so it matches by
    # construction — the case that must stay quiet.
    assert await report_schema_drift(db_engine) == []


@pytest.mark.asyncio
async def test_every_missing_column_is_named_in_one_pass(db_engine):
    """
    Two columns dropped from two tables must produce four names, not one.
    Reporting only the first would reproduce exactly the deploy-per-column
    loop this exists to end.
    """
    async with db_engine.begin() as conn:
        # SQLite refuses to drop a column an index still names.
        await conn.execute(text("DROP INDEX ix_cars_fuel_type"))
        await conn.execute(text("DROP INDEX ix_listings_price"))
        await conn.execute(text("ALTER TABLE cars DROP COLUMN fuel_type"))
        await conn.execute(text("ALTER TABLE cars DROP COLUMN updated_at"))
        await conn.execute(text("ALTER TABLE listings DROP COLUMN price"))

    problems = await report_schema_drift(db_engine)

    report = "\n".join(problems)
    assert "fuel_type" in report
    assert "updated_at" in report
    assert "price" in report


@pytest.mark.asyncio
async def test_the_report_is_logged_where_someone_will_see_it(db_engine, caplog):
    async with db_engine.begin() as conn:
        await conn.execute(text("DROP INDEX ix_cars_fuel_type"))
        await conn.execute(text("ALTER TABLE cars DROP COLUMN fuel_type"))

    with caplog.at_level(logging.ERROR):
        await report_schema_drift(db_engine)

    assert "fuel_type" in caplog.text


@pytest.mark.asyncio
async def test_the_report_prints_the_sql_that_would_fix_it(db_engine, caplog):
    """
    Naming the gap is not the same as closing it.

    The dealers outage happened with the report working perfectly: it named the
    four missing columns in a log nobody read closely, and the next person to
    notice was a dealer getting a 500. An operator should be able to paste the
    fix into a migration without first working out how to spell the type.
    """
    async with db_engine.begin() as conn:
        await conn.execute(text("DROP INDEX ix_cars_fuel_type"))
        await conn.execute(text("ALTER TABLE cars DROP COLUMN fuel_type"))

    with caplog.at_level(logging.ERROR):
        await report_schema_drift(db_engine)

    assert "ALTER TABLE cars ADD COLUMN IF NOT EXISTS fuel_type" in caplog.text
    # Nullable regardless of the model: a NOT NULL column cannot be added to a
    # table with rows in it, and inventing a default for real data is not a
    # diagnostic's call to make.
    assert "NULL;" in caplog.text
    # And it must still say to route it through a migration — running SQL by
    # hand against production is what produced this drift in the first place.
    assert "migration" in caplog.text


@pytest.mark.asyncio
async def test_a_wholly_missing_table_gets_no_invented_create(db_engine, caplog):
    """
    A missing table means a migration never ran; the fix is finding out why.

    Offering a CREATE TABLE built from the model would paper over that and
    leave the migration history still wrong.
    """
    async with db_engine.begin() as conn:
        await conn.execute(text("DROP TABLE listings"))

    with caplog.at_level(logging.ERROR):
        problems = await report_schema_drift(db_engine)

    assert any("listings is missing entirely" in p for p in problems)
    assert "CREATE TABLE" not in caplog.text


@pytest.mark.asyncio
async def test_an_unreachable_database_does_not_stop_startup():
    """A diagnostic must never be the reason the service fails to start."""
    unreachable = create_async_engine("sqlite+aiosqlite:////nonexistent/dir/x.db")

    assert await report_schema_drift(unreachable) == []
