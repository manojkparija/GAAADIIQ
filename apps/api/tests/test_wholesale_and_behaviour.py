"""
The wholesale forecaster and the behavioural profile.

Both produce numbers that somebody will act on with money, and both are built
on top of estimates rather than observed transactions. So what is tested is
mostly the honesty: that the trade discount is declared, that the projection
does not claim to know about seasonality, and that browsing history nudges a
recommendation without overriding what the buyer actually said they wanted.

Plain functions — `pyproject.toml` only collects `Test*Suite` / `Test*Case`
classes, and anything else silently collects nothing.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from models.car import Car
from models.listing import Listing
from models.listing_view import ListingView
from models.user import User, UserRole
from services import behaviour_profile as bp
from services.wholesale_forecast import (
    MAX_MEANINGFUL_AGE,
    TRADE_DISCOUNT,
    wholesale_forecast,
)

# ── Wholesale ────────────────────────────────────────────────────────────────


def test_trade_value_is_below_retail():
    # The whole reason a dealer needs a separate number: quoting the retail
    # curve at them overstates what they can actually get.
    f = wholesale_forecast(1_000_000)
    assert f["available"] is True
    assert f["wholesale_today"] < f["retail_price"]
    assert f["wholesale_today"] == pytest.approx(1_000_000 * (1 - TRADE_DISCOUNT), rel=0.01)


def test_value_falls_at_every_horizon():
    f = wholesale_forecast(1_000_000)
    values = [h["value"] for h in f["horizons"]]
    assert values == sorted(values, reverse=True)
    assert [h["days"] for h in f["horizons"]] == [30, 60, 90]


def test_it_states_what_waiting_costs():
    # The figure the decision actually turns on.
    f = wholesale_forecast(1_000_000)
    for h in f["horizons"]:
        assert h["cost_of_waiting"] == f["wholesale_today"] - h["value"]
    assert f["horizons"][-1]["cost_of_waiting"] > 0


def test_every_response_declares_it_is_a_convention_not_a_measurement():
    # This platform has no wholesale transactions. A dealer must be able to
    # tell that from a figure that looks exactly like a measured one.
    f = wholesale_forecast(800_000)
    basis = f["basis"].lower()
    assert "convention" in basis
    assert "not a figure measured" in basis


def test_it_does_not_claim_to_know_about_seasons_or_facelifts():
    f = wholesale_forecast(800_000)
    assert "seasonal" in f["basis"].lower()


def test_a_very_old_car_gets_no_projection_at_all():
    # Priced by condition and service history, not by any curve.
    f = wholesale_forecast(200_000, age_years=MAX_MEANINGFUL_AGE + 5)
    assert f["available"] is False
    assert f["horizons"] == []
    assert "condition" in f["reason"].lower()


def test_a_missing_price_produces_nothing_rather_than_zero():
    f = wholesale_forecast(0)
    assert f["available"] is False


# ── Behaviour profile ────────────────────────────────────────────────────────


async def _user(db) -> User:
    u = User(
        email=f"b-{uuid.uuid4().hex[:8]}@example.com",
        full_name="Buyer",
        hashed_password="x",
        role=UserRole.buyer,
    )
    db.add(u)
    await db.flush()
    return u


async def _viewed(db, user, *, make, body=None, fuel=None, price=800000, days_ago=1):
    car = Car(make=make, model="M", year=2021, body_type=body, fuel_type=fuel)
    db.add(car)
    await db.flush()
    lst = Listing(car_id=car.id, seller_id=user.id, listing_type="used", price=price)
    db.add(lst)
    await db.flush()
    db.add(ListingView(
        listing_id=lst.id,
        user_id=user.id,
        viewed_at=datetime.now(timezone.utc) - timedelta(days=days_ago),
    ))
    await db.flush()

    # Returned with the car loaded, as both callers of behaviour_boost select
    # it — touching the relationship lazily raises MissingGreenlet under
    # asyncio, and a test that skipped this would be testing a path production
    # never takes.
    return (await db.execute(
        select(Listing).options(selectinload(Listing.car)).where(Listing.id == lst.id)
    )).scalar_one()


@pytest.mark.asyncio
async def test_a_signed_out_visitor_gets_no_profile(db_session):
    # Counting distinct viewers on one listing is one thing; following an
    # anonymous browser across the catalogue to build a taste profile is
    # another, and not one to do without an account.
    p = await bp.build_profile(db_session, None)
    assert p.has_enough_data is False


@pytest.mark.asyncio
async def test_three_views_are_not_a_preference(db_session):
    user = await _user(db_session)
    for _ in range(3):
        await _viewed(db_session, user, make="Tata")

    p = await bp.build_profile(db_session, user.id)
    assert p.has_enough_data is False
    assert p.top_make() is None


@pytest.mark.asyncio
async def test_a_real_history_becomes_a_profile(db_session):
    user = await _user(db_session)
    for _ in range(bp.MIN_VIEWS + 2):
        await _viewed(db_session, user, make="Hyundai", price=900000)

    p = await bp.build_profile(db_session, user.id)
    assert p.has_enough_data is True
    assert p.top_make() == "Hyundai"
    assert p.typical_price_min > 0


@pytest.mark.asyncio
async def test_old_browsing_is_ignored(db_session):
    # A car someone looked at eight months ago says little about what they want
    # now — they have very likely already bought one.
    user = await _user(db_session)
    for _ in range(bp.MIN_VIEWS + 3):
        await _viewed(db_session, user, make="Tata", days_ago=bp.WINDOW_DAYS + 30)

    p = await bp.build_profile(db_session, user.id)
    assert p.has_enough_data is False


@pytest.mark.asyncio
async def test_the_boost_is_bounded(db_session):
    # Explicit answers are what the buyer said; this is what they did. When the
    # two disagree the stated budget has to win, so the nudge stays small — a
    # large one turns a recommender into a filter bubble.
    user = await _user(db_session)
    for _ in range(bp.MIN_VIEWS + 5):
        await _viewed(db_session, user, make="Kia", price=1000000)

    p = await bp.build_profile(db_session, user.id)
    lst = await _viewed(db_session, user, make="Kia", price=1000000)
    points, reasons = bp.behaviour_boost(lst, p)

    assert points <= bp.MAX_BOOST
    assert reasons, "a boost with no stated reason reads as the site pushing stock"


@pytest.mark.asyncio
async def test_no_profile_means_no_change_to_the_score(db_session):
    user = await _user(db_session)
    lst = await _viewed(db_session, user, make="Kia")

    empty = bp.BehaviourProfile()
    points, reasons = bp.behaviour_boost(lst, empty)
    assert points == 0
    assert reasons == []


@pytest.mark.asyncio
async def test_the_reason_tells_the_buyer_where_it_came_from(db_session):
    user = await _user(db_session)
    for _ in range(bp.MIN_VIEWS + 1):
        await _viewed(db_session, user, make="Mahindra", price=1500000)

    p = await bp.build_profile(db_session, user.id)
    lst = await _viewed(db_session, user, make="Mahindra", price=1500000)
    _, reasons = bp.behaviour_boost(lst, p)

    assert any("you have been looking" in r.lower() for r in reasons)
