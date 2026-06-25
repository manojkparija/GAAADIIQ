from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_current_user
from db.session import get_db
from models.dealer import Dealer
from models.user import User, UserRole
from schemas.dealer import DealerOut, DealerRegister, DealerUpdate

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
    from sqlalchemy import func
    from models.listing import Listing

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
