from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_current_user
from db.session import get_db
from models.dealer import Dealer
from models.listing import Listing
from models.loan_inquiry import LoanInquiry
from models.review import Review
from models.test_drive_booking import TestDriveBooking
from models.user import User, UserRole
from schemas.dealer import DealerOut, DealerRegister, DealerUpdate


class ListingAnalytics(BaseModel):
    listing_id: str
    title: str
    price: float
    views: int
    bookings: int
    loan_inquiries: int
    reviews: int
    avg_rating: float | None
    is_active: bool


class SellerAnalytics(BaseModel):
    total_listings: int
    active_listings: int
    total_views: int
    total_bookings: int
    total_loan_inquiries: int
    total_reviews: int
    overall_avg_rating: float | None
    listings: list[ListingAnalytics]

router = APIRouter(prefix="/dealers", tags=["dealers"])


@router.post("/register", response_model=DealerOut, status_code=status.HTTP_201_CREATED)
async def register_dealer(
    payload: DealerRegister,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing = await db.execute(select(Dealer).where(Dealer.user_id == current_user.id))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You already have a dealer profile",
        )

    dealer = Dealer(user_id=current_user.id, **payload.model_dump())
    db.add(dealer)

    # Upgrade user role to dealer
    current_user.role = UserRole.dealer
    await db.commit()
    await db.refresh(dealer)
    return DealerOut.model_validate(dealer)


@router.get("/me", response_model=DealerOut)
async def get_my_dealer_profile(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Dealer).where(Dealer.user_id == current_user.id))
    dealer = result.scalar_one_or_none()
    if not dealer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No dealer profile found. Register as a dealer first.",
        )
    return DealerOut.model_validate(dealer)


@router.patch("/me", response_model=DealerOut)
async def update_my_dealer_profile(
    payload: DealerUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Dealer).where(Dealer.user_id == current_user.id))
    dealer = result.scalar_one_or_none()
    if not dealer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dealer profile not found")

    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(dealer, field, value)

    await db.commit()
    await db.refresh(dealer)
    return DealerOut.model_validate(dealer)


@router.get("/my-listings-summary")
async def my_listings_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Stats for dashboard overview card."""
    result = await db.execute(
        select(
            func.count(Listing.id).label("total"),
            func.sum(Listing.views_count).label("total_views"),
            func.count(Listing.id).filter(Listing.is_active == True).label("active"),  # noqa: E712
        ).where(Listing.seller_id == current_user.id)
    )
    row = result.one()
    return {
        "total_listings": row.total or 0,
        "active_listings": row.active or 0,
        "total_views": int(row.total_views or 0),
    }


@router.get("/me/analytics", response_model=SellerAnalytics)
async def seller_analytics(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Per-listing breakdown of views, bookings, inquiries, and reviews."""
    from sqlalchemy.orm import selectinload

    listings_result = await db.execute(
        select(Listing)
        .where(Listing.seller_id == current_user.id)
        .options(selectinload(Listing.car))
        .order_by(Listing.created_at.desc())
    )
    listings = listings_result.scalars().all()
    listing_ids = [lst.id for lst in listings]

    # Aggregate bookings per listing
    booking_counts: dict = {}
    if listing_ids:
        bq = await db.execute(
            select(TestDriveBooking.listing_id, func.count().label("cnt"))
            .where(TestDriveBooking.listing_id.in_(listing_ids))
            .group_by(TestDriveBooking.listing_id)
        )
        booking_counts = {row.listing_id: row.cnt for row in bq}

    # Aggregate loan inquiries per listing
    inq_counts: dict = {}
    if listing_ids:
        iq = await db.execute(
            select(LoanInquiry.listing_id, func.count().label("cnt"))
            .where(LoanInquiry.listing_id.in_(listing_ids))
            .group_by(LoanInquiry.listing_id)
        )
        inq_counts = {row.listing_id: row.cnt for row in iq}

    # Aggregate reviews per listing
    rev_counts: dict = {}
    rev_avg: dict = {}
    if listing_ids:
        rq = await db.execute(
            select(
                Review.listing_id,
                func.count().label("cnt"),
                func.avg(Review.rating).label("avg"),
            )
            .where(Review.listing_id.in_(listing_ids))
            .group_by(Review.listing_id)
        )
        for row in rq:
            rev_counts[row.listing_id] = row.cnt
            rev_avg[row.listing_id] = round(float(row.avg), 2) if row.avg else None

    listing_analytics = []
    for lst in listings:
        car = lst.car
        title = f"{car.year} {car.make} {car.model}" if car else str(lst.id)
        listing_analytics.append(ListingAnalytics(
            listing_id=str(lst.id),
            title=title,
            price=float(lst.price),
            views=int(lst.views_count or 0),
            bookings=booking_counts.get(lst.id, 0),
            loan_inquiries=inq_counts.get(lst.id, 0),
            reviews=rev_counts.get(lst.id, 0),
            avg_rating=rev_avg.get(lst.id),
            is_active=lst.is_active,
        ))

    total_views = sum(a.views for a in listing_analytics)
    total_bookings = sum(a.bookings for a in listing_analytics)
    total_inqs = sum(a.loan_inquiries for a in listing_analytics)
    total_reviews = sum(a.reviews for a in listing_analytics)
    rated = [a.avg_rating for a in listing_analytics if a.avg_rating is not None]
    overall_avg = round(sum(rated) / len(rated), 2) if rated else None

    return SellerAnalytics(
        total_listings=len(listings),
        active_listings=sum(1 for lst in listings if lst.is_active),
        total_views=total_views,
        total_bookings=total_bookings,
        total_loan_inquiries=total_inqs,
        total_reviews=total_reviews,
        overall_avg_rating=overall_avg,
        listings=listing_analytics,
    )


# ── Public Dealer Directory (MOB-027) ─────────────────────────────────────────

@router.get("/directory")
async def dealer_directory(
    city: str | None = None,
    query: str | None = None,
    limit: int = 20,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """
    Public dealer directory — searchable by city/name/brand.
    No auth required; used by the dealer directory page and service-centre finder.
    """
    from sqlalchemy import or_
    stmt = select(Dealer).where(Dealer.is_active == True)  # noqa: E712

    if city:
        stmt = stmt.where(func.lower(Dealer.city) == city.strip().lower())
    if query:
        pattern = f"%{query.strip()}%"
        stmt = stmt.where(
            or_(
                Dealer.name.ilike(pattern),
                Dealer.brand.ilike(pattern),
                Dealer.city.ilike(pattern),
            )
        )

    total_result = await db.execute(select(func.count()).select_from(stmt.subquery()))
    total = total_result.scalar_one()

    stmt = stmt.order_by(Dealer.name).offset(offset).limit(min(limit, 50))
    result = await db.execute(stmt)
    dealers = result.scalars().all()

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "dealers": [DealerOut.model_validate(d) for d in dealers],
    }
