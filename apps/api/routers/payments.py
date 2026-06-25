"""
Payment router — Razorpay integration stub.

When RAZORPAY_KEY_ID is set:  creates a real Razorpay order and returns the order id for
                                the frontend to open the Razorpay checkout.
When unset (dev/test mode):   auto-approves instantly — marks listing.is_featured=True and
                               sets payment.status=paid — so the full flow can be tested
                               without real credentials.
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.dependencies import get_current_user
from db.session import get_db
from models.listing import Listing
from models.payment import Payment, PaymentPurpose, PaymentStatus
from models.subscription import Subscription, SubscriptionTier
from models.user import User
from schemas.payment import (
    FeatureListingRequest,
    PaymentOut,
    RazorpayOrderOut,
    SubscriptionOut,
    SubscriptionUpgradeRequest,
)

router = APIRouter(prefix="/payments", tags=["payments"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]

# Featured listing pricing in paise (₹)
FEATURED_PRICES: dict[int, int] = {
    7: 49900,    # ₹499
    30: 149900,  # ₹1,499
    90: 349900,  # ₹3,499
}

SUBSCRIPTION_PRICES: dict[SubscriptionTier, int] = {
    SubscriptionTier.pro: 99900,     # ₹999/mo
    SubscriptionTier.dealer: 299900, # ₹2,999/mo
}


@router.post("/feature-listing", response_model=RazorpayOrderOut)
async def feature_listing(
    payload: FeatureListingRequest,
    db: DbDep,
    current_user: CurrentUser,
):
    if payload.duration_days not in FEATURED_PRICES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Valid durations: {list(FEATURED_PRICES.keys())} days",
        )

    listing_result = await db.execute(
        select(Listing).where(Listing.id == payload.listing_id, Listing.seller_id == current_user.id)
    )
    listing = listing_result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found")

    amount_paise = FEATURED_PRICES[payload.duration_days]
    dev_mode = not settings.RAZORPAY_KEY_ID

    payment = Payment(
        user_id=current_user.id,
        listing_id=listing.id,
        amount_paise=amount_paise,
        currency="INR",
        purpose=PaymentPurpose.featured_listing,
        status=PaymentStatus.paid if dev_mode else PaymentStatus.pending,
    )

    if dev_mode:
        # Auto-approve in dev — mark listing featured
        listing.is_featured = True
        payment.razorpay_order_id = f"dev_order_{uuid.uuid4().hex[:12]}"
        payment.razorpay_payment_id = f"dev_pay_{uuid.uuid4().hex[:12]}"
    else:
        import razorpay  # type: ignore[import]
        client = razorpay.Client(auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET))
        order = client.order.create({
            "amount": amount_paise,
            "currency": "INR",
            "receipt": str(uuid.uuid4()),
            "notes": {"listing_id": str(listing.id), "purpose": "featured_listing"},
        })
        payment.razorpay_order_id = order["id"]

    db.add(payment)
    await db.commit()
    await db.refresh(payment)

    return RazorpayOrderOut(
        payment_id=payment.id,
        razorpay_order_id=payment.razorpay_order_id,
        amount_paise=amount_paise,
        currency="INR",
        key_id=settings.RAZORPAY_KEY_ID or None,
        dev_mode=dev_mode,
        listing_featured=listing.is_featured,
    )


@router.post("/verify", status_code=status.HTTP_200_OK)
async def verify_payment(
    payment_id: uuid.UUID,
    razorpay_payment_id: str,
    razorpay_signature: str,
    db: DbDep,
    current_user: CurrentUser,
):
    """Verify Razorpay payment signature and mark listing as featured."""
    payment = await db.get(Payment, payment_id)
    if not payment or payment.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found")
    if payment.status == PaymentStatus.paid:
        return {"status": "already_paid"}

    if settings.RAZORPAY_KEY_ID:
        import razorpay
        import razorpay.errors
        client = razorpay.Client(auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET))
        try:
            client.utility.verify_payment_signature({
                "razorpay_order_id": payment.razorpay_order_id,
                "razorpay_payment_id": razorpay_payment_id,
                "razorpay_signature": razorpay_signature,
            })
        except razorpay.errors.SignatureVerificationError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid signature")

    payment.status = PaymentStatus.paid
    payment.razorpay_payment_id = razorpay_payment_id

    if payment.listing_id and payment.purpose == PaymentPurpose.featured_listing:
        listing = await db.get(Listing, payment.listing_id)
        if listing:
            listing.is_featured = True

    await db.commit()
    return {"status": "paid"}


@router.get("/my", response_model=list[PaymentOut])
async def my_payments(db: DbDep, current_user: CurrentUser):
    result = await db.execute(
        select(Payment)
        .where(Payment.user_id == current_user.id)
        .order_by(Payment.created_at.desc())
    )
    return result.scalars().all()


# ── Subscriptions ─────────────────────────────────────────────────────────────

subs_router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])


@subs_router.get("/me", response_model=SubscriptionOut)
async def my_subscription(db: DbDep, current_user: CurrentUser):
    result = await db.execute(
        select(Subscription).where(Subscription.user_id == current_user.id)
    )
    sub = result.scalar_one_or_none()
    if not sub:
        return SubscriptionOut(user_id=current_user.id, tier=SubscriptionTier.free, valid_until=None)
    return sub


@subs_router.post("/upgrade", response_model=RazorpayOrderOut)
async def upgrade_subscription(
    payload: SubscriptionUpgradeRequest,
    db: DbDep,
    current_user: CurrentUser,
):
    if payload.tier == SubscriptionTier.free:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot upgrade to free")

    amount_paise = SUBSCRIPTION_PRICES.get(payload.tier, 0)
    dev_mode = not settings.RAZORPAY_KEY_ID

    payment = Payment(
        user_id=current_user.id,
        amount_paise=amount_paise,
        currency="INR",
        purpose=PaymentPurpose(f"subscription_{payload.tier.value}"),
        status=PaymentStatus.paid if dev_mode else PaymentStatus.pending,
    )

    if dev_mode:
        payment.razorpay_order_id = f"dev_order_{uuid.uuid4().hex[:12]}"
        payment.razorpay_payment_id = f"dev_pay_{uuid.uuid4().hex[:12]}"
        # Create or update subscription
        result = await db.execute(
            select(Subscription).where(Subscription.user_id == current_user.id)
        )
        sub = result.scalar_one_or_none()
        if sub:
            sub.tier = payload.tier
            sub.valid_until = datetime.now(timezone.utc) + timedelta(days=30)
        else:
            sub = Subscription(
                user_id=current_user.id,
                tier=payload.tier,
                valid_until=datetime.now(timezone.utc) + timedelta(days=30),
            )
            db.add(sub)

    db.add(payment)
    await db.commit()
    await db.refresh(payment)

    return RazorpayOrderOut(
        payment_id=payment.id,
        razorpay_order_id=payment.razorpay_order_id,
        amount_paise=amount_paise,
        currency="INR",
        key_id=settings.RAZORPAY_KEY_ID or None,
        dev_mode=dev_mode,
        listing_featured=False,
    )
