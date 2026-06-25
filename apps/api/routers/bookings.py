import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.dependencies import get_current_user
from db.session import get_db
from models.listing import Listing
from models.test_drive_booking import BookingStatus, TestDriveBooking
from models.user import User
from schemas.booking import BookingCreate, BookingOut, BookingStatusUpdate

router = APIRouter(prefix="/bookings", tags=["bookings"])


@router.post("", response_model=BookingOut, status_code=status.HTTP_201_CREATED)
async def create_booking(
    payload: BookingCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    listing_result = await db.execute(
        select(Listing).where(Listing.id == payload.listing_id, Listing.is_active == True)  # noqa: E712
    )
    if not listing_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found")

    booking = TestDriveBooking(user_id=current_user.id, **payload.model_dump())
    db.add(booking)
    await db.commit()
    await db.refresh(booking)
    return BookingOut.model_validate(booking)


@router.get("", response_model=list[BookingOut])
async def list_my_bookings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Bookings I made (as a buyer)."""
    result = await db.execute(
        select(TestDriveBooking)
        .where(TestDriveBooking.user_id == current_user.id)
        .order_by(TestDriveBooking.created_at.desc())
    )
    return [BookingOut.model_validate(b) for b in result.scalars().all()]


@router.get("/received", response_model=list[BookingOut])
async def list_received_bookings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Bookings received on my listings (seller/dealer view)."""
    result = await db.execute(
        select(TestDriveBooking)
        .join(Listing, TestDriveBooking.listing_id == Listing.id)
        .where(Listing.seller_id == current_user.id)
        .order_by(TestDriveBooking.created_at.desc())
    )
    return [BookingOut.model_validate(b) for b in result.scalars().all()]


@router.patch("/{booking_id}/status", response_model=BookingOut)
async def update_booking_status(
    booking_id: uuid.UUID,
    payload: BookingStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Seller confirms / cancels / completes a booking."""
    result = await db.execute(
        select(TestDriveBooking)
        .join(Listing, TestDriveBooking.listing_id == Listing.id)
        .where(
            TestDriveBooking.id == booking_id,
            Listing.seller_id == current_user.id,
        )
    )
    booking = result.scalar_one_or_none()
    if not booking:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Booking not found or you don't own this listing",
        )

    booking.status = payload.status
    await db.commit()
    await db.refresh(booking)
    return BookingOut.model_validate(booking)
