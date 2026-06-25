import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_admin_user
from db.session import get_db
from models.listing import Listing
from models.loan_inquiry import LoanInquiry
from models.review import Review
from models.test_drive_booking import TestDriveBooking
from models.user import User, UserRole
from schemas.user import UserOut

router = APIRouter(prefix="/admin", tags=["admin"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
AdminUser = Annotated[User, Depends(get_admin_user)]


class PlatformStats(BaseModel):
    total_users: int
    total_listings: int
    active_listings: int
    total_bookings: int
    total_loan_inquiries: int
    total_reviews: int


class UserUpdate(BaseModel):
    role: UserRole | None = None
    is_active: bool | None = None


@router.get("/stats", response_model=PlatformStats)
async def platform_stats(db: DbDep, _: AdminUser):
    async def count(model, *filters):
        q = select(func.count()).select_from(model)
        for f in filters:
            q = q.where(f)
        r = await db.execute(q)
        return r.scalar_one()

    return PlatformStats(
        total_users=await count(User),
        total_listings=await count(Listing),
        active_listings=await count(Listing, Listing.is_active == True),  # noqa: E712
        total_bookings=await count(TestDriveBooking),
        total_loan_inquiries=await count(LoanInquiry),
        total_reviews=await count(Review),
    )


@router.get("/users", response_model=list[UserOut])
async def list_users(
    db: DbDep,
    _: AdminUser,
    limit: int = Query(50, le=200),
    offset: int = 0,
    role: UserRole | None = None,
):
    q = select(User).order_by(User.created_at.desc()).limit(limit).offset(offset)
    if role:
        q = q.where(User.role == role)
    result = await db.execute(q)
    return result.scalars().all()


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(user_id: uuid.UUID, payload: UserUpdate, db: DbDep, _: AdminUser):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if payload.role is not None:
        user.role = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active
    await db.commit()
    await db.refresh(user)
    return user


@router.get("/listings", response_model=list)
async def list_all_listings(
    db: DbDep,
    _: AdminUser,
    limit: int = Query(50, le=200),
    offset: int = 0,
    is_active: bool | None = None,
):
    from schemas.listing import ListingListOut
    from sqlalchemy.orm import selectinload

    q = (
        select(Listing)
        .options(selectinload(Listing.car), selectinload(Listing.seller))
        .order_by(Listing.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if is_active is not None:
        q = q.where(Listing.is_active == is_active)  # noqa: E712
    result = await db.execute(q)
    return [ListingListOut.model_validate(l) for l in result.scalars().all()]


@router.patch("/listings/{listing_id}/deactivate", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_listing(listing_id: uuid.UUID, db: DbDep, _: AdminUser):
    listing = await db.get(Listing, listing_id)
    if not listing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found")
    listing.is_active = False
    await db.commit()
