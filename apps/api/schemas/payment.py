import uuid
from datetime import datetime

from pydantic import BaseModel

from models.payment import PaymentPurpose, PaymentStatus
from models.subscription import SubscriptionTier


class FeatureListingRequest(BaseModel):
    listing_id: uuid.UUID
    duration_days: int = 30  # 7, 30, 90


class PaymentOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    listing_id: uuid.UUID | None
    amount_paise: int
    currency: str
    status: PaymentStatus
    purpose: PaymentPurpose
    razorpay_order_id: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class RazorpayOrderOut(BaseModel):
    payment_id: uuid.UUID
    razorpay_order_id: str | None
    amount_paise: int
    currency: str
    key_id: str | None
    dev_mode: bool
    listing_featured: bool


class SubscriptionOut(BaseModel):
    user_id: uuid.UUID
    tier: SubscriptionTier
    valid_until: datetime | None

    model_config = {"from_attributes": True}


class PaymentVerifyRequest(BaseModel):
    """
    The body the checkout actually sends.

    WHY THIS TYPE HAD TO EXIST

    /payments/verify declared these three as bare scalars. FastAPI reads a bare
    scalar as a QUERY parameter, so the endpoint expected a query string while
    pricing-plans.component.ts posted a JSON body:

        this.http.post(`${apiUrl}/payments/verify`, {
          payment_id, razorpay_payment_id, razorpay_signature })

    Every verification from the checkout flow returned 422, and the user was
    shown "Payment received but verification failed. Contact support." after
    Razorpay had taken their money. The webhook still activated the
    subscription, so this was a frightening experience rather than lost money —
    but only where the webhook is configured.

    This is the same trap CLAUDE.md records for `from __future__ import
    annotations` in a router — body params silently read as query params —
    arriving by the other route: no request model at all. A declared model is
    what makes the contract explicit in both directions.
    """

    payment_id: uuid.UUID
    razorpay_payment_id: str
    razorpay_signature: str


class SubscriptionUpgradeRequest(BaseModel):
    tier: SubscriptionTier
