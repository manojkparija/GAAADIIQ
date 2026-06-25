"""
Full-text search and autocomplete for GAADIIQ.

Primary path: PostgreSQL tsvector / tsquery with ts_rank ordering.
Fallback: ILIKE-based search (used automatically in tests via SQLite).
"""
import re
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import String, cast, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.session import get_db
from models.car import Car
from models.listing import Listing
from schemas.listing import ListingListOut, ListingOut

router = APIRouter(prefix="/search", tags=["search"])

_LOAD = [selectinload(Listing.car), selectinload(Listing.seller)]

# Dialect name is checked once and cached after first call
_dialect_cache: str | None = None


async def _get_dialect(db: AsyncSession) -> str:
    global _dialect_cache
    if _dialect_cache is None:
        _dialect_cache = db.bind.dialect.name if db.bind else "postgresql"  # type: ignore[union-attr]
    return _dialect_cache


def _safe_tsquery(q: str) -> str:
    """Convert free-text query to a safe plainto_tsquery-compatible string."""
    return re.sub(r"[^\w\s]", " ", q).strip()


@router.get("", response_model=ListingListOut)
async def full_text_search(
    q: str = Query(..., min_length=1, max_length=200),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> Any:
    dialect = await _get_dialect(db)
    offset = (page - 1) * page_size

    base_q = (
        select(Listing)
        .join(Car, Listing.car_id == Car.id)
        .options(*_LOAD)
        .where(Listing.is_active == True)  # noqa: E712
    )

    if dialect == "postgresql":
        # Build a tsvector from relevant text columns
        ts_vec = func.to_tsvector(
            "english",
            func.coalesce(Car.make, "")
            .op("||")(" ")
            .op("||")(func.coalesce(Car.model, ""))
            .op("||")(" ")
            .op("||")(func.coalesce(Car.variant, ""))
            .op("||")(" ")
            .op("||")(func.coalesce(Listing.city, ""))
            .op("||")(" ")
            .op("||")(func.coalesce(Listing.description, "")),
        )
        ts_q = func.plainto_tsquery("english", _safe_tsquery(q))
        rank = func.ts_rank(ts_vec, ts_q)

        query = base_q.where(ts_vec.op("@@")(ts_q)).order_by(rank.desc())
        count_q = (
            select(func.count())
            .select_from(Listing)
            .join(Car, Listing.car_id == Car.id)
            .where(Listing.is_active == True, ts_vec.op("@@")(ts_q))  # noqa: E712
        )
    else:
        # SQLite fallback — ILIKE-style LIKE (case-insensitive via LOWER)
        term = f"%{q.lower()}%"
        like_filter = or_(
            func.lower(cast(Car.make, String)).like(term),
            func.lower(cast(Car.model, String)).like(term),
            func.lower(cast(Car.variant, String)).like(term),
            func.lower(cast(Listing.city, String)).like(term),
            func.lower(cast(Listing.description, String)).like(term),
        )
        query = base_q.where(like_filter).order_by(Listing.created_at.desc())
        count_q = (
            select(func.count())
            .select_from(Listing)
            .join(Car, Listing.car_id == Car.id)
            .where(Listing.is_active == True, like_filter)  # noqa: E712
        )

    total_result = await db.execute(count_q)
    total = total_result.scalar_one()

    result = await db.execute(query.offset(offset).limit(page_size))
    items = result.scalars().all()

    return ListingListOut(
        items=[ListingOut.model_validate(l) for l in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/autocomplete")
async def autocomplete(
    q: str = Query(..., min_length=1, max_length=100),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return distinct make + 'make model' suggestions matching the query prefix."""
    term = f"{q.lower()}%"

    # Makes
    makes_q = (
        select(Car.make)
        .distinct()
        .where(func.lower(Car.make).like(term))
        .limit(5)
    )
    makes_result = await db.execute(makes_q)
    makes = [row[0] for row in makes_result.all()]

    # "Make Model" combos
    combos_q = (
        select(Car.make, Car.model)
        .distinct()
        .where(
            or_(
                func.lower(Car.make).like(term),
                func.lower(Car.model).like(term),
                func.lower(func.coalesce(Car.make, "").op("||")(" ").op("||")(func.coalesce(Car.model, ""))).like(term),
            )
        )
        .limit(8)
    )
    combos_result = await db.execute(combos_q)
    combos = [f"{row[0]} {row[1]}" for row in combos_result.all()]

    suggestions = list(dict.fromkeys(makes + combos))[:8]
    return {"suggestions": suggestions}
