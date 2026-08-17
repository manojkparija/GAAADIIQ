"""
Read side of the demand instrumentation.

Every endpoint here can return "not enough data yet", and that is a success
response rather than an error — a new marketplace has no traffic, and the
client is expected to render the note instead of a number. See
services/demand_analytics.py for why the thresholds exist.

No `from __future__ import annotations` in this file: it breaks FastAPI's
signature introspection and body params start being read as query params.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_current_user
from core.limiter import limiter
from db.session import get_db
from models.listing import Listing
from models.user import User
from services import demand_analytics

router = APIRouter(prefix="/demand", tags=["demand"])


class ActivityOut(BaseModel):
    views_24h: int
    views_7d: int
    unique_viewers_7d: int
    days_on_market: int
    has_enough_data: bool
    note: str | None = None


class DaysTurnOut(BaseModel):
    median_days: int | None
    sample_size: int
    has_enough_data: bool
    note: str | None = None
    #: Stated on every response, because is_active=false also covers a listing
    #: the seller simply withdrew, which inflates the sample.
    basis: str = (
        "Median days between listing and closing, over listings that are no "
        "longer active. Withdrawn listings are counted as closed."
    )


class DemandCellOut(BaseModel):
    city: str
    searches: int
    empty_searches: int


class DemandMapOut(BaseModel):
    cells: list[DemandCellOut]
    window_days: int
    total_searches: int
    has_enough_data: bool
    note: str | None = None


class InventoryGapOut(BaseModel):
    make: str | None
    model: str | None
    searches: int
    empty_searches: int
    listings_available: int


class InventoryGapReportOut(BaseModel):
    gaps: list[InventoryGapOut]
    window_days: int
    has_enough_data: bool
    note: str | None = None


@router.get("/listings/{listing_id}/activity", response_model=ActivityOut)
@limiter.limit("60/minute")
async def listing_activity(
    request: Request,
    listing_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """How much interest a car is getting. Public — it is shown to buyers."""
    listing = (
        await db.execute(select(Listing).where(Listing.id == listing_id))
    ).scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found")

    a = await demand_analytics.listing_activity(db, listing)
    return ActivityOut(
        views_24h=a.views_24h,
        views_7d=a.views_7d,
        unique_viewers_7d=a.unique_viewers_7d,
        days_on_market=a.days_on_market,
        has_enough_data=a.has_enough_data,
        note=a.note,
    )


@router.get("/days-turn", response_model=DaysTurnOut)
@limiter.limit("30/minute")
async def days_turn(
    request: Request,
    mine: bool = Query(False, description="Restrict to the caller's own listings"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Typical time to sell. Signed in, because it is a seller's question."""
    result = await demand_analytics.days_turn(db, seller_id=user.id if mine else None)
    return DaysTurnOut(
        median_days=result.median_days,
        sample_size=result.sample_size,
        has_enough_data=result.has_enough_data,
        note=result.note,
    )


@router.get("/map", response_model=DemandMapOut)
@limiter.limit("30/minute")
async def demand_map(
    request: Request,
    city: str | None = Query(None, max_length=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Where buyers are searching, and where they are finding nothing."""
    m = await demand_analytics.demand_map(db, city=city)
    return DemandMapOut(
        cells=[
            DemandCellOut(city=c.city, searches=c.searches, empty_searches=c.empty_searches)
            for c in m.cells
        ],
        window_days=m.window_days,
        total_searches=m.total_searches,
        has_enough_data=m.has_enough_data,
        note=m.note,
    )


@router.get("/inventory-gaps", response_model=InventoryGapReportOut)
@limiter.limit("30/minute")
async def inventory_gaps(
    request: Request,
    city: str | None = Query(None, max_length=100),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """What buyers looked for near you and did not find."""
    r = await demand_analytics.inventory_gaps(db, city=city)
    return InventoryGapReportOut(
        gaps=[
            InventoryGapOut(
                make=g.make,
                model=g.model,
                searches=g.searches,
                empty_searches=g.empty_searches,
                listings_available=g.listings_available,
            )
            for g in r.gaps
        ],
        window_days=r.window_days,
        has_enough_data=r.has_enough_data,
        note=r.note,
    )
