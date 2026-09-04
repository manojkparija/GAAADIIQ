import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.dependencies import get_current_user
from db.session import get_db
from models.listing import Listing
from models.review import Review
from models.test_drive_booking import BookingStatus, TestDriveBooking
from models.user import User
from schemas.review import ReviewCreate, ReviewOut, SellerRatingSummary

router = APIRouter(prefix="/reviews", tags=["reviews"])

#: How many reviews a list endpoint returns when the caller does not say.
#:
#: These two endpoints returned every matching row, with no bound of any kind:
#: a seller with ten thousand reviews meant ten thousand rows serialised on
#: every view of their profile. Nothing in the product needs that — the page
#: shows a scrolling list and the true count comes from the summary endpoint,
#: which no longer reads the rows at all.
#:
#: 50 is above anything the current data reaches, so this changes no response
#: today; it is a ceiling for later, not a paging scheme. If a screen ever needs
#: to walk the whole history, add an offset rather than raising this.
REVIEW_PAGE_LIMIT = 50
#: The most a caller may ask for in one request.
REVIEW_MAX_LIMIT = 200

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


def _review_out(review: Review) -> ReviewOut:
    return ReviewOut(
        id=review.id,
        reviewer_id=review.reviewer_id,
        seller_id=review.seller_id,
        listing_id=review.listing_id,
        booking_id=review.booking_id,
        rating=review.rating,
        title=review.title,
        body=review.body,
        is_verified=review.is_verified,
        reviewer_name=review.reviewer.full_name if review.reviewer else None,
        created_at=review.created_at,
    )


@router.post("", response_model=ReviewOut, status_code=status.HTTP_201_CREATED)
async def create_review(
    payload: ReviewCreate,
    db: DbDep,
    current_user: CurrentUser,
):
    # Listing must exist
    listing_result = await db.execute(
        select(Listing).where(Listing.id == payload.listing_id)
    )
    listing = listing_result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found")

    # Cannot review own listing
    if listing.seller_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot review your own listing")

    # One review per listing per reviewer
    existing = await db.execute(
        select(Review).where(
            Review.reviewer_id == current_user.id,
            Review.listing_id == payload.listing_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You already reviewed this listing")

    # Check if buyer has a completed booking — mark is_verified
    booking_result = await db.execute(
        select(TestDriveBooking).where(
            TestDriveBooking.listing_id == payload.listing_id,
            TestDriveBooking.user_id == current_user.id,
            TestDriveBooking.status == BookingStatus.completed,
        )
    )
    completed_booking = booking_result.scalar_one_or_none()

    review = Review(
        reviewer_id=current_user.id,
        seller_id=listing.seller_id,
        listing_id=payload.listing_id,
        booking_id=completed_booking.id if completed_booking else None,
        rating=payload.rating,
        title=payload.title,
        body=payload.body,
        is_verified=completed_booking is not None,
    )
    db.add(review)
    await db.commit()
    await db.refresh(review, ["reviewer"])
    return _review_out(review)


@router.get("/my", response_model=list[ReviewOut])
async def my_reviews(db: DbDep, current_user: CurrentUser):
    result = await db.execute(
        select(Review)
        .where(Review.reviewer_id == current_user.id)
        .options(selectinload(Review.reviewer))
        .order_by(Review.created_at.desc())
    )
    return [_review_out(r) for r in result.scalars().all()]


@router.delete("/{review_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_review(review_id: uuid.UUID, db: DbDep, current_user: CurrentUser):
    result = await db.execute(
        select(Review).where(Review.id == review_id, Review.reviewer_id == current_user.id)
    )
    review = result.scalar_one_or_none()
    if not review:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found")
    await db.delete(review)
    await db.commit()


# ── Listing reviews ───────────────────────────────────────────────────────────

@router.get("/listing/{listing_id}", response_model=list[ReviewOut])
async def listing_reviews(
    listing_id: uuid.UUID,
    db: DbDep,
    limit: int = Query(default=REVIEW_PAGE_LIMIT, ge=1, le=REVIEW_MAX_LIMIT),
):
    """Newest first, bounded. See REVIEW_PAGE_LIMIT for why the cap exists."""
    result = await db.execute(
        select(Review)
        .where(Review.listing_id == listing_id)
        .options(selectinload(Review.reviewer))
        .order_by(Review.created_at.desc())
        .limit(limit)
    )
    return [_review_out(r) for r in result.scalars().all()]


# ── Seller reviews + rating summary ──────────────────────────────────────────

@router.get("/seller/{seller_id}/summary", response_model=SellerRatingSummary)
async def seller_rating_summary(seller_id: uuid.UUID, db: DbDep):
    """A seller's rating, as seven numbers the database computes.

    This used to `SELECT *` every review the seller had ever received, hydrate
    each one into a Review object, and then count them in Python — transferring
    and instantiating N rows to produce a count, a mean and five buckets. The
    cost grew with the seller's review history on every page view of their
    profile, and none of that data was ever returned to the caller.
    """
    counts = (
        await db.execute(
            select(Review.rating, func.count())
            .where(Review.seller_id == seller_id)
            .group_by(Review.rating)
        )
    ).all()

    dist = {i: 0 for i in range(1, 6)}
    total_rating = 0
    total_count = 0
    for rating, count in counts:
        # Defensive against a rating outside 1–5: it stays out of the
        # distribution the schema promises, but must still count toward the
        # average, or the mean would disagree with the number beside it.
        if rating in dist:
            dist[rating] = count
        total_rating += rating * count
        total_count += count

    if total_count == 0:
        return SellerRatingSummary(
            seller_id=seller_id,
            average_rating=None,
            review_count=0,
            rating_distribution=dist,
        )

    # Averaged here rather than with SQL AVG(): AVG returns a float whose
    # rounding differs subtly between SQLite and Postgres, and this figure is
    # rendered to two decimal places on a seller's profile. Summing integer
    # counts keeps the arithmetic exact and identical on both.
    return SellerRatingSummary(
        seller_id=seller_id,
        average_rating=round(total_rating / total_count, 2),
        review_count=total_count,
        rating_distribution=dist,
    )


@router.get("/seller/{seller_id}", response_model=list[ReviewOut])
async def seller_reviews(
    seller_id: uuid.UUID,
    db: DbDep,
    limit: int = Query(default=REVIEW_PAGE_LIMIT, ge=1, le=REVIEW_MAX_LIMIT),
):
    """Newest first, bounded. The summary endpoint above carries the true count,
    so a caller that needs "how many" never has to fetch the rows to find out."""
    result = await db.execute(
        select(Review)
        .where(Review.seller_id == seller_id)
        .options(selectinload(Review.reviewer))
        .order_by(Review.created_at.desc())
        .limit(limit)
    )
    return [_review_out(r) for r in result.scalars().all()]
