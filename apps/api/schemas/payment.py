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


class SubscriptionUpgradeRequest(BaseModel):
    tier: SubscriptionTier
