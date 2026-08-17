"""
Everything read off listing_views and search_events.

THE RULE THIS MODULE EXISTS TO ENFORCE

Every function here can be asked a question it does not yet have the data to
answer, and every one of them says so rather than answering anyway. A brand-new
marketplace has no traffic; "0 people viewed this in 24 hours" on every car is
not a useful truth, and "3 people viewed this" computed from two bots and a
crawler is worse than useless — it is a number a seller will price against.

So each result carries `has_enough_data`, and the callers render the honest
empty state when it is false. The thresholds below are deliberately visible and
deliberately conservative. They are the difference between analytics and
decoration.

None of these numbers are forecasts. Days-turn is the observed median of cars
that actually sold, not a prediction dressed as one; when too few have sold, it
returns nothing at all instead of extrapolating from three sales.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import String, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.car import Car
from models.listing import Listing
from models.listing_view import ListingView
from models.search_event import SearchEvent

logger = logging.getLogger("gaadiiq.demand")

# ── Thresholds ───────────────────────────────────────────────────────────────
#
# Below these, the answer is "not enough data" rather than a number.

#: Views a listing needs before its activity is worth showing a buyer. Under
#: this, one curious person moves the figure by a third.
MIN_VIEWS_FOR_ACTIVITY = 10

#: Sold listings needed before a median days-to-sell means anything.
MIN_SALES_FOR_DAYS_TURN = 8

#: Searches in a place before it is called demand rather than coincidence.
MIN_SEARCHES_FOR_DEMAND = 20

#: How far back the "recent" window looks for demand questions.
DEMAND_WINDOW_DAYS = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Recording ────────────────────────────────────────────────────────────────


async def record_listing_view(
    db: AsyncSession,
    listing_id: uuid.UUID,
    user_id: uuid.UUID | None,
    visitor_key: str | None,
) -> None:
    """
    Append a view. Never raises into the request.

    A page must render whether or not the analytics write succeeded — the
    buyer came to see a car, not to be instrumented. Failures are logged and
    swallowed, in a savepoint so a failure here cannot roll back whatever the
    caller was doing.
    """
    try:
        async with db.begin_nested():
            db.add(
                ListingView(
                    listing_id=listing_id,
                    user_id=user_id,
                    visitor_key=(visitor_key or None),
                )
            )
            await db.flush()
    except Exception:
        logger.exception("failed to record view for listing=%s", listing_id)


async def record_search(db: AsyncSession, **fields) -> None:
    """Append a search. Same contract as record_listing_view: never raises."""
    try:
        async with db.begin_nested():
            db.add(SearchEvent(**fields))
            await db.flush()
    except Exception:
        logger.exception("failed to record search")


# ── Activity on one listing ──────────────────────────────────────────────────


@dataclass
class ListingActivity:
    views_24h: int
    views_7d: int
    days_on_market: int
    #: Distinct people, not page loads — one person refreshing is not interest.
    unique_viewers_7d: int
    has_enough_data: bool
    #: Rendered verbatim when has_enough_data is false.
    note: str | None = None


async def listing_activity(db: AsyncSession, listing: Listing) -> ListingActivity:
    now = _now()
    created = listing.created_at
    if created is not None and created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    days_on_market = max(0, (now - created).days) if created else 0

    day_ago = now - timedelta(days=1)
    week_ago = now - timedelta(days=7)

    views_24h = await db.scalar(
        select(func.count())
        .select_from(ListingView)
        .where(ListingView.listing_id == listing.id, ListingView.viewed_at >= day_ago)
    ) or 0

    views_7d = await db.scalar(
        select(func.count())
        .select_from(ListingView)
        .where(ListingView.listing_id == listing.id, ListingView.viewed_at >= week_ago)
    ) or 0

    # A viewer is a signed-in user or an anonymous browser key; COALESCE keeps
    # the two in one count without treating every signed-out view as the same
    # person.
    unique_7d = await db.scalar(
        select(func.count(func.distinct(
            func.coalesce(func.cast(ListingView.user_id, String), ListingView.visitor_key)
        )))
        .select_from(ListingView)
        .where(ListingView.listing_id == listing.id, ListingView.viewed_at >= week_ago)
    ) or 0

    enough = views_7d >= MIN_VIEWS_FOR_ACTIVITY
    return ListingActivity(
        views_24h=views_24h,
        views_7d=views_7d,
        days_on_market=days_on_market,
        unique_viewers_7d=unique_7d,
        has_enough_data=enough,
        note=None if enough else "Too few views so far to report activity for this car.",
    )


# ── Days-turn ────────────────────────────────────────────────────────────────


@dataclass
class DaysTurn:
    median_days: int | None
    sample_size: int
    has_enough_data: bool
    note: str | None = None


async def days_turn(db: AsyncSession, seller_id: uuid.UUID | None = None) -> DaysTurn:
    """
    Median days between listing and sale, over cars that actually sold.

    Observed, not predicted. A dealer asking "how long will this sit" is owed
    either a number grounded in completed sales or an honest nothing — a curve
    fitted to five sales would be a guess wearing a statistic's clothes.

    `is_active = false` is the only signal this schema has for "gone", and it
    also covers a listing the seller simply withdrew. That overstates sales,
    so it is stated wherever the number is shown.
    """
    q = select(Listing.created_at, Listing.updated_at).where(Listing.is_active.is_(False))
    if seller_id is not None:
        q = q.where(Listing.seller_id == seller_id)

    rows = (await db.execute(q)).all()
    spans: list[int] = []
    for created, updated in rows:
        if not created or not updated:
            continue
        days = (updated - created).days
        if days >= 0:
            spans.append(days)

    if len(spans) < MIN_SALES_FOR_DAYS_TURN:
        return DaysTurn(
            median_days=None,
            sample_size=len(spans),
            has_enough_data=False,
            note=(
                f"Only {len(spans)} closed listings so far — at least "
                f"{MIN_SALES_FOR_DAYS_TURN} are needed before a typical "
                "time-to-sell means anything."
            ),
        )

    spans.sort()
    mid = len(spans) // 2
    median = spans[mid] if len(spans) % 2 else (spans[mid - 1] + spans[mid]) // 2
    return DaysTurn(median_days=median, sample_size=len(spans), has_enough_data=True)


# ── Demand ───────────────────────────────────────────────────────────────────


@dataclass
class DemandCell:
    city: str
    searches: int
    #: Searches that returned nothing — unmet demand, the useful half.
    empty_searches: int
    top_models: list[str] = field(default_factory=list)


@dataclass
class DemandMap:
    cells: list[DemandCell]
    window_days: int
    total_searches: int
    has_enough_data: bool
    note: str | None = None


async def demand_map(db: AsyncSession, city: str | None = None) -> DemandMap:
    since = _now() - timedelta(days=DEMAND_WINDOW_DAYS)

    q = (
        select(
            SearchEvent.city,
            func.count().label("searches"),
            func.sum(case((SearchEvent.result_count == 0, 1), else_=0)).label("empty"),
        )
        .where(SearchEvent.searched_at >= since, SearchEvent.city.isnot(None))
        .group_by(SearchEvent.city)
        .order_by(func.count().desc())
    )
    if city:
        q = q.where(SearchEvent.city == city)

    rows = (await db.execute(q)).all()
    total = sum(r.searches for r in rows)

    if total < MIN_SEARCHES_FOR_DEMAND:
        return DemandMap(
            cells=[],
            window_days=DEMAND_WINDOW_DAYS,
            total_searches=total,
            has_enough_data=False,
            note=(
                f"{total} searches recorded in the last {DEMAND_WINDOW_DAYS} days. "
                f"At least {MIN_SEARCHES_FOR_DEMAND} are needed before this shows "
                "where demand is."
            ),
        )

    cells = [
        DemandCell(city=r.city, searches=r.searches, empty_searches=int(r.empty or 0))
        for r in rows
    ]
    return DemandMap(
        cells=cells,
        window_days=DEMAND_WINDOW_DAYS,
        total_searches=total,
        has_enough_data=True,
    )


@dataclass
class InventoryGap:
    make: str | None
    model: str | None
    searches: int
    empty_searches: int
    listings_available: int


@dataclass
class InventoryGapReport:
    gaps: list[InventoryGap]
    window_days: int
    has_enough_data: bool
    note: str | None = None


async def inventory_gaps(db: AsyncSession, city: str | None = None) -> InventoryGapReport:
    """
    What buyers looked for near you and did not find.

    Ranked by searches that returned nothing, because a model with 200 searches
    and 40 cars on the lot is not a gap — a model with 30 searches and none is.
    """
    since = _now() - timedelta(days=DEMAND_WINDOW_DAYS)

    q = (
        select(
            SearchEvent.make,
            SearchEvent.model,
            func.count().label("searches"),
            func.sum(case((SearchEvent.result_count == 0, 1), else_=0)).label("empty"),
        )
        .where(
            SearchEvent.searched_at >= since,
            SearchEvent.model.isnot(None),
        )
        .group_by(SearchEvent.make, SearchEvent.model)
        .order_by(func.sum(case((SearchEvent.result_count == 0, 1), else_=0)).desc())
        .limit(10)
    )
    if city:
        q = q.where(SearchEvent.city == city)

    rows = (await db.execute(q)).all()
    total = sum(r.searches for r in rows)
    if total < MIN_SEARCHES_FOR_DEMAND:
        return InventoryGapReport(
            gaps=[],
            window_days=DEMAND_WINDOW_DAYS,
            has_enough_data=False,
            note=(
                f"{total} model-specific searches in the last {DEMAND_WINDOW_DAYS} "
                f"days. At least {MIN_SEARCHES_FOR_DEMAND} are needed before a gap "
                "is a gap rather than a coincidence."
            ),
        )

    gaps: list[InventoryGap] = []
    for r in rows:
        # Count what is actually on the platform for *this* model — the
        # comparison is the whole point, and a count of every active listing
        # would report the same number against every gap.
        avail_q = (
            select(func.count())
            .select_from(Listing)
            .join(Car, Listing.car_id == Car.id)
            .where(Listing.is_active.is_(True), Car.model == r.model)
        )
        if r.make:
            avail_q = avail_q.where(Car.make == r.make)
        if city:
            avail_q = avail_q.where(Listing.city == city)
        available = await db.scalar(avail_q) or 0
        gaps.append(
            InventoryGap(
                make=r.make,
                model=r.model,
                searches=r.searches,
                empty_searches=int(r.empty or 0),
                listings_available=available,
            )
        )

    return InventoryGapReport(gaps=gaps, window_days=DEMAND_WINDOW_DAYS, has_enough_data=True)
