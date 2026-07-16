import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_current_user
from db.session import get_db
from models.listing import Listing
from models.price_alert import PriceAlert
from models.user import User
from schemas.notification import PriceAlertOut

router = APIRouter(prefix="/price-alerts", tags=["price-alerts"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.post("", response_model=PriceAlertOut, status_code=status.HTTP_201_CREATED)
async def subscribe(listing_id: uuid.UUID, db: DbDep, current_user: CurrentUser):
    listing = await db.get(Listing, listing_id)
    if not listing or not listing.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found")

    existing = await db.execute(
        select(PriceAlert).where(
            PriceAlert.user_id == current_user.id,
            PriceAlert.listing_id == listing_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already subscribed")

    alert = PriceAlert(user_id=current_user.id, listing_id=listing_id)
    db.add(alert)
    await db.commit()
    await db.refresh(alert)
    return alert


@router.delete("/{alert_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unsubscribe(alert_id: uuid.UUID, db: DbDep, current_user: CurrentUser):
    result = await db.execute(
        select(PriceAlert).where(
            PriceAlert.id == alert_id,
            PriceAlert.user_id == current_user.id,
        )
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
    await db.delete(alert)
    await db.commit()


@router.get("", response_model=list[PriceAlertOut])
async def list_my_alerts(db: DbDep, current_user: CurrentUser):
    result = await db.execute(
        select(PriceAlert)
        .where(PriceAlert.user_id == current_user.id)
        .order_by(PriceAlert.created_at.desc())
    )
    return result.scalars().all()


@router.get("/listing/{listing_id}/subscribed")
async def is_subscribed(listing_id: uuid.UUID, db: DbDep, current_user: CurrentUser):
    result = await db.execute(
        select(PriceAlert).where(
            PriceAlert.user_id == current_user.id,
            PriceAlert.listing_id == listing_id,
        )
    )
    alert = result.scalar_one_or_none()
    return {"subscribed": alert is not None, "alert_id": str(alert.id) if alert else None}
