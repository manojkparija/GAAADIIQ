"""
Payment router — Razorpay integration.

Dev mode (environment != production AND Razorpay keys absent):
  Payments auto-approve instantly so the full flow can be tested without credentials.

Production mode (environment == production):
  Razorpay keys MUST be present (enforced at startup via validate_production_config).
  HMAC signature verification is ALWAYS performed on /verify; no bypass is possible.
"""
import hashlib
import hmac
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
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


def _dev_mode() -> bool:
    """True only in non-production environments when Razorpay keys are absent."""
    return not settings.is_production and not settings.payments_enabled


def _require_payments_available() -> None:
    """Raise 503 if payments cannot be processed (production without keys is blocked at boot)."""
    if settings.is_production and not settings.payments_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Payment processing is not configured",
        )


def _verify_razorpay_signature(order_id: str, payment_id: str, signature: str) -> None:
    """Constant-time HMAC-SHA256 verification against Razorpay key secret."""
    body = f"{order_id}|{payment_id}"
    expected = hmac.new(
        settings.RAZORPAY_KEY_SECRET.encode(),
        body.encode(),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid payment signature")


@router.post("/feature-listing", response_model=RazorpayOrderOut)
async def feature_listing(
    payload: FeatureListingRequest,
    db: DbDep,
    current_user: CurrentUser,
):
    _require_payments_available()

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
    dev = _dev_mode()

    payment = Payment(
        user_id=current_user.id,
        listing_id=listing.id,
        amount_paise=amount_paise,
        currency="INR",
        purpose=PaymentPurpose.featured_listing,
        status=PaymentStatus.paid if dev else PaymentStatus.pending,
    )

    if dev:
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
        dev_mode=dev,
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
    """Verify Razorpay HMAC signature and mark payment as paid."""
    payment = await db.get(Payment, payment_id)
    if not payment or payment.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found")
    if payment.status == PaymentStatus.paid:
        return {"status": "already_paid"}

    if _dev_mode():
        # Dev auto-approve — only reachable when not in production
        if not payment.razorpay_order_id or not payment.razorpay_order_id.startswith("dev_"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not a dev payment")
    else:
        # Production path — ALWAYS verify signature; no bypass
        _verify_razorpay_signature(
            payment.razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
        )

    payment.status = PaymentStatus.paid
    payment.razorpay_payment_id = razorpay_payment_id

    if payment.listing_id and payment.purpose == PaymentPurpose.featured_listing:
        listing = await db.get(Listing, payment.listing_id)
        if listing:
            listing.is_featured = True

    await db.commit()
    return {"status": "paid"}


@router.post("/webhook", status_code=status.HTTP_200_OK)
async def razorpay_webhook(
    request: Request,
    db: DbDep,
):
    """Razorpay server-to-server webhook — more reliable than client /verify."""
    raw_body = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")

    if settings.payments_enabled:
        expected = hmac.new(
            settings.RAZORPAY_KEY_SECRET.encode(),
            raw_body,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected, signature):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid webhook signature")

    try:
        event = json.loads(raw_body)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON")

    if event.get("event") != "payment.captured":
        return {"status": "ignored"}

    payload_data = event.get("payload", {}).get("payment", {}).get("entity", {})
    razorpay_order_id = payload_data.get("order_id")
    razorpay_payment_id = payload_data.get("id")

    if not razorpay_order_id:
        return {"status": "ignored"}

    result = await db.execute(
        select(Payment).where(Payment.razorpay_order_id == razorpay_order_id)
    )
    payment = result.scalar_one_or_none()
    if not payment or payment.status == PaymentStatus.paid:
        return {"status": "already_handled"}

    payment.status = PaymentStatus.paid
    payment.razorpay_payment_id = razorpay_payment_id

    if payment.listing_id and payment.purpose == PaymentPurpose.featured_listing:
        listing = await db.get(Listing, payment.listing_id)
        if listing:
            listing.is_featured = True

    if payment.purpose in (PaymentPurpose.subscription_pro, PaymentPurpose.subscription_dealer):
        tier_map = {
            PaymentPurpose.subscription_pro: SubscriptionTier.pro,
            PaymentPurpose.subscription_dealer: SubscriptionTier.dealer,
        }
        tier = tier_map[payment.purpose]
        sub_result = await db.execute(
            select(Subscription).where(Subscription.user_id == payment.user_id)
        )
        sub = sub_result.scalar_one_or_none()
        if sub:
            sub.tier = tier
            sub.valid_until = datetime.now(timezone.utc) + timedelta(days=30)
        else:
            db.add(Subscription(
                user_id=payment.user_id,
                tier=tier,
                valid_until=datetime.now(timezone.utc) + timedelta(days=30),
            ))

    await db.commit()
    return {"status": "ok"}


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
    _require_payments_available()

    if payload.tier == SubscriptionTier.free:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot upgrade to free")

    amount_paise = SUBSCRIPTION_PRICES.get(payload.tier, 0)
    dev = _dev_mode()

    payment = Payment(
        user_id=current_user.id,
        amount_paise=amount_paise,
        currency="INR",
        purpose=PaymentPurpose(f"subscription_{payload.tier.value}"),
        status=PaymentStatus.paid if dev else PaymentStatus.pending,
    )

    if dev:
        payment.razorpay_order_id = f"dev_order_{uuid.uuid4().hex[:12]}"
        payment.razorpay_payment_id = f"dev_pay_{uuid.uuid4().hex[:12]}"
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
    else:
        import razorpay  # type: ignore[import]
        client = razorpay.Client(auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET))
        order = client.order.create({
            "amount": amount_paise,
            "currency": "INR",
            "receipt": str(uuid.uuid4()),
            "notes": {"purpose": f"subscription_{payload.tier.value}"},
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
        dev_mode=dev,
        listing_featured=False,
    )
