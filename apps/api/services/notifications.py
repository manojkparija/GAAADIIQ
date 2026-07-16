"""
Notification creation helpers used by routers as FastAPI BackgroundTasks.
"""
import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from models.notification import Notification, NotificationType
from models.user import User
from services.email import send_email

logger = logging.getLogger(__name__)


async def create_notification(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    type: NotificationType,
    title: str,
    body: str | None = None,
    listing_id: uuid.UUID | None = None,
) -> Notification:
    n = Notification(
        user_id=user_id,
        type=type,
        title=title,
        body=body,
        listing_id=listing_id,
    )
    db.add(n)
    await db.commit()
    await db.refresh(n)
    return n


async def notify_booking_received(
    db: AsyncSession,
    seller: User,
    buyer_name: str | None,
    listing_title: str,
    listing_id: uuid.UUID,
) -> None:
    title = f"New test drive request for {listing_title}"
    body = f"{buyer_name or 'A buyer'} wants to test drive your car."
    await create_notification(
        db,
        user_id=seller.id,
        type=NotificationType.booking_received,
        title=title,
        body=body,
        listing_id=listing_id,
    )
    await send_email(
        to=seller.email,
        subject=title,
        html=f"<p>{body}</p><p>Log in to GAADIIQ to confirm or reject the request.</p>",
    )


async def notify_loan_inquiry_received(
    db: AsyncSession,
    seller: User,
    listing_title: str,
    listing_id: uuid.UUID,
    loan_amount: float | None,
) -> None:
    amt = f"₹{loan_amount:,.0f}" if loan_amount else "an unspecified amount"
    title = f"New loan inquiry for {listing_title}"
    body = f"A buyer has requested a loan of {amt} for your listing."
    await create_notification(
        db,
        user_id=seller.id,
        type=NotificationType.loan_inquiry_received,
        title=title,
        body=body,
        listing_id=listing_id,
    )
    await send_email(
        to=seller.email,
        subject=title,
        html=f"<p>{body}</p><p>Log in to GAADIIQ to view the inquiry details.</p>",
    )


async def notify_price_drop(
    db: AsyncSession,
    subscriber: User,
    listing_title: str,
    listing_id: uuid.UUID,
    old_price: float,
    new_price: float,
) -> None:
    drop_pct = round((old_price - new_price) / old_price * 100, 1)
    title = f"Price drop alert: {listing_title}"
    body = f"Price dropped by {drop_pct}% — now ₹{new_price:,.0f} (was ₹{old_price:,.0f})."
    await create_notification(
        db,
        user_id=subscriber.id,
        type=NotificationType.price_drop,
        title=title,
        body=body,
        listing_id=listing_id,
    )
    await send_email(
        to=subscriber.email,
        subject=title,
        html=f"<p>{body}</p><p>View the listing on GAADIIQ before it's gone.</p>",
    )
