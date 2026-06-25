import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
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
async def listing_reviews(listing_id: uuid.UUID, db: DbDep):
    result = await db.execute(
        select(Review)
        .where(Review.listing_id == listing_id)
        .options(selectinload(Review.reviewer))
        .order_by(Review.created_at.desc())
    )
    return [_review_out(r) for r in result.scalars().all()]


# ── Seller reviews + rating summary ──────────────────────────────────────────

@router.get("/seller/{seller_id}/summary", response_model=SellerRatingSummary)
async def seller_rating_summary(seller_id: uuid.UUID, db: DbDep):
    result = await db.execute(
        select(Review).where(Review.seller_id == seller_id)
    )
    reviews = result.scalars().all()

    if not reviews:
        return SellerRatingSummary(
            seller_id=seller_id,
            average_rating=None,
            review_count=0,
            rating_distribution={1: 0, 2: 0, 3: 0, 4: 0, 5: 0},
        )

    total = sum(r.rating for r in reviews)
    dist = {i: 0 for i in range(1, 6)}
    for r in reviews:
        dist[r.rating] = dist.get(r.rating, 0) + 1

    return SellerRatingSummary(
        seller_id=seller_id,
        average_rating=round(total / len(reviews), 2),
        review_count=len(reviews),
        rating_distribution=dist,
    )


@router.get("/seller/{seller_id}", response_model=list[ReviewOut])
async def seller_reviews(seller_id: uuid.UUID, db: DbDep):
    result = await db.execute(
        select(Review)
        .where(Review.seller_id == seller_id)
        .options(selectinload(Review.reviewer))
        .order_by(Review.created_at.desc())
    )
    return [_review_out(r) for r in result.scalars().all()]
