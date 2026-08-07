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
async def test_an_unreachable_database_does_not_stop_startup():
    """A diagnostic must never be the reason the service fails to start."""
    unreachable = create_async_engine("sqlite+aiosqlite:////nonexistent/dir/x.db")

    assert await report_schema_drift(unreachable) == []
