"""
The demand analytics, and the thresholds that stop them lying.

The whole point of this module is that it refuses to answer questions it does
not have the data for. A marketplace with three views cannot tell a seller what
their traffic is doing, and a number produced anyway is worse than silence
because it will be priced against. So most of what is tested here is the
refusal, not the arithmetic.

Plain functions, not a class — `pyproject.toml` only collects classes named
`Test*Suite` or `Test*Case`, so a class named anything else silently collects
zero tests and passes.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from models.car import Car
from models.listing import Listing
from models.listing_view import ListingView
from models.search_event import SearchEvent
from models.user import User, UserRole
from services import demand_analytics as da


async def _seller(db) -> User:
    u = User(
        email=f"s-{uuid.uuid4().hex[:8]}@example.com",
        full_name="Seller",
        hashed_password="x",
        role=UserRole.seller,
    )
    db.add(u)
    await db.flush()
    return u


async def _listing(db, *, make="Maruti Suzuki", model="Swift", price=550000,
                   city="Kolkata", active=True, created_days_ago=0) -> Listing:
    car = Car(make=make, model=model, year=2020)
    db.add(car)
    await db.flush()

    seller = await _seller(db)
    lst = Listing(
        car_id=car.id,
        seller_id=seller.id,
        listing_type="used",
        price=price,
        city=city,
        is_active=active,
    )
    db.add(lst)
    await db.flush()

    if created_days_ago:
        lst.created_at = datetime.now(timezone.utc) - timedelta(days=created_days_ago)
        await db.flush()
    return lst


async def _views(db, listing, n, *, days_ago=0, visitor="v"):
    when = datetime.now(timezone.utc) - timedelta(days=days_ago)
    for i in range(n):
        db.add(ListingView(
            listing_id=listing.id,
            visitor_key=f"{visitor}{i}",
            viewed_at=when,
        ))
    await db.flush()


# ── Recording ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_view_is_recorded_with_its_time(db_session):
    lst = await _listing(db_session)
    await da.record_listing_view(db_session, lst.id, None, "visitor-1")

    row = (await db_session.execute(select(ListingView))).scalar_one()
    assert row.listing_id == lst.id
    assert row.visitor_key == "visitor-1"
    # The column the bare counter could never have.
    assert row.viewed_at is not None


@pytest.mark.asyncio
async def test_recording_a_view_never_raises_into_the_request(db_session):
    # A buyer came to look at a car, not to be instrumented. If the analytics
    # write fails the page must still render — and, because the write happens
    # in a savepoint, the caller's own transaction must survive it.
    await da.record_listing_view(db_session, uuid.uuid4(), uuid.uuid4(), "v")

    # The session is still usable: a bad write did not poison the transaction.
    lst = await _listing(db_session)
    assert lst.id is not None


@pytest.mark.asyncio
async def test_a_search_that_found_nothing_is_recorded_as_such(db_session):
    # The most valuable row in the table: demand with no supply behind it.
    await da.record_search(
        db_session, make="Toyota", model="Fortuner", city="Kolkata", result_count=0
    )
    row = (await db_session.execute(select(SearchEvent))).scalar_one()
    assert row.result_count == 0
    assert row.model == "Fortuner"


# ── Activity ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_activity_refuses_to_report_on_a_handful_of_views(db_session):
    lst = await _listing(db_session)
    await _views(db_session, lst, 3)

    a = await da.listing_activity(db_session, lst)
    assert a.has_enough_data is False
    assert a.note, "a refusal with no explanation is just a blank space"


@pytest.mark.asyncio
async def test_activity_reports_once_there_is_enough(db_session):
    lst = await _listing(db_session)
    await _views(db_session, lst, da.MIN_VIEWS_FOR_ACTIVITY + 2)

    a = await da.listing_activity(db_session, lst)
    assert a.has_enough_data is True
    assert a.views_24h == da.MIN_VIEWS_FOR_ACTIVITY + 2


@pytest.mark.asyncio
async def test_the_24_hour_window_excludes_older_views(db_session):
    lst = await _listing(db_session)
    await _views(db_session, lst, 12, days_ago=0, visitor="new")
    await _views(db_session, lst, 30, days_ago=20, visitor="old")

    a = await da.listing_activity(db_session, lst)
    assert a.views_24h == 12, "old traffic is being counted as today's interest"
    assert a.views_7d == 12


@pytest.mark.asyncio
async def test_one_person_refreshing_is_not_twelve_people(db_session):
    lst = await _listing(db_session)
    for _ in range(12):
        db_session.add(ListingView(listing_id=lst.id, visitor_key="same-person"))
    await db_session.flush()

    a = await da.listing_activity(db_session, lst)
    assert a.views_7d == 12
    assert a.unique_viewers_7d == 1


@pytest.mark.asyncio
async def test_days_on_market_counts_from_when_it_was_listed(db_session):
    lst = await _listing(db_session, created_days_ago=45)
    a = await da.listing_activity(db_session, lst)
    assert 44 <= a.days_on_market <= 46


# ── Days-turn ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_days_turn_says_nothing_from_a_few_sales(db_session):
    for _ in range(3):
        await _listing(db_session, active=False, created_days_ago=30)

    t = await da.days_turn(db_session)
    assert t.has_enough_data is False
    assert t.median_days is None, "a median of three sales is a guess with a decimal point"
    assert str(da.MIN_SALES_FOR_DAYS_TURN) in (t.note or "")


@pytest.mark.asyncio
async def test_days_turn_reports_a_median_once_enough_have_closed(db_session):
    for _ in range(da.MIN_SALES_FOR_DAYS_TURN + 1):
        await _listing(db_session, active=False, created_days_ago=30)

    t = await da.days_turn(db_session)
    assert t.has_enough_data is True
    assert t.median_days is not None
    assert t.sample_size >= da.MIN_SALES_FOR_DAYS_TURN


# ── Demand and gaps ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_demand_map_refuses_on_thin_traffic(db_session):
    for _ in range(4):
        await da.record_search(db_session, city="Kolkata", make="Tata", result_count=2)

    m = await da.demand_map(db_session)
    assert m.has_enough_data is False
    assert m.cells == []


@pytest.mark.asyncio
async def test_demand_map_counts_searches_that_found_nothing(db_session):
    for _ in range(da.MIN_SEARCHES_FOR_DEMAND):
        await da.record_search(db_session, city="Kolkata", make="Tata", result_count=0)
    for _ in range(5):
        await da.record_search(db_session, city="Kolkata", make="Tata", result_count=3)

    m = await da.demand_map(db_session)
    assert m.has_enough_data is True
    cell = next(c for c in m.cells if c.city == "Kolkata")
    assert cell.searches == da.MIN_SEARCHES_FOR_DEMAND + 5
    # Unmet demand is the half that tells a dealer what to buy.
    assert cell.empty_searches == da.MIN_SEARCHES_FOR_DEMAND


@pytest.mark.asyncio
async def test_a_gap_is_ranked_by_what_was_not_found(db_session):
    # A model with plenty of searches and plenty of stock is not a gap.
    await _listing(db_session, make="Hyundai", model="Creta", city="Kolkata")
    for _ in range(da.MIN_SEARCHES_FOR_DEMAND):
        await da.record_search(
            db_session, make="Hyundai", model="Creta", city="Kolkata", result_count=1
        )
    for _ in range(da.MIN_SEARCHES_FOR_DEMAND):
        await da.record_search(
            db_session, make="Toyota", model="Fortuner", city="Kolkata", result_count=0
        )

    r = await da.inventory_gaps(db_session, city="Kolkata")
    assert r.has_enough_data is True
    assert r.gaps[0].model == "Fortuner", "the gap is the car nobody could find"
    assert r.gaps[0].empty_searches == da.MIN_SEARCHES_FOR_DEMAND


@pytest.mark.asyncio
async def test_availability_is_counted_per_model_not_across_the_lot(db_session):
    # An earlier version counted every active listing for every row, so each
    # gap reported the same availability regardless of the car it named.
    await _listing(db_session, make="Hyundai", model="Creta", city="Kolkata")
    await _listing(db_session, make="Hyundai", model="Creta", city="Kolkata")
    await _listing(db_session, make="Tata", model="Nexon", city="Kolkata")

    for _ in range(da.MIN_SEARCHES_FOR_DEMAND):
        await da.record_search(
            db_session, make="Hyundai", model="Creta", city="Kolkata", result_count=0
        )

    r = await da.inventory_gaps(db_session, city="Kolkata")
    creta = next(g for g in r.gaps if g.model == "Creta")
    assert creta.listings_available == 2
