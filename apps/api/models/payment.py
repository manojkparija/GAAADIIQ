import enum
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Enum, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from .user import User


class PaymentStatus(str, enum.Enum):
    pending = "pending"
    paid = "paid"
    failed = "failed"
    refunded = "refunded"


class PaymentPurpose(str, enum.Enum):
    featured_listing = "featured_listing"
    subscription_pro = "subscription_pro"
    # Built by interpolation in routers/payments.py as
    # PaymentPurpose(f"subscription_{tier.value}"), so this list must carry a
    # label for every purchasable SubscriptionTier or the checkout raises
    # ValueError inside the request.
    subscription_seller_basic = "subscription_seller_basic"
    subscription_dealer = "subscription_dealer"
    service_request = "service_request"


class Payment(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "payments"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    listing_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("listings.id"), nullable=True
    )
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="INR", nullable=False)
    status: Mapped[PaymentStatus] = mapped_column(
        Enum(PaymentStatus, name="payment_status"), default=PaymentStatus.pending, nullable=False
    )
    purpose: Mapped[PaymentPurpose] = mapped_column(
        Enum(PaymentPurpose, name="payment_purpose"), nullable=False
    )
    razorpay_order_id: Mapped[str | None] = mapped_column(String(100))
    razorpay_payment_id: Mapped[str | None] = mapped_column(String(100))

    # --- Marketplace settlement (purpose == service_request) -----------------
    # `amount_paise` above stays the gross the customer paid. The split is frozen
    # onto the row at capture time rather than recomputed on read: the commission
    # rate is a business setting that will change, and a receipt issued last year
    # must keep showing last year's numbers.
    service_request_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("service_requests.id", ondelete="SET NULL"), nullable=True, index=True
    )
    mechanic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("mechanics.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Basis points (700 = 7.00%) so the rate is exact and auditable — a float
    # percentage would not reproduce the paise split reliably.
    commission_rate_bps: Mapped[int | None] = mapped_column(Integer)
    commission_paise: Mapped[int | None] = mapped_column(Integer)
    mechanic_payout_paise: Mapped[int | None] = mapped_column(Integer)

    user: Mapped["User"] = relationship(back_populates="payments")

    def __repr__(self) -> str:
        return f"<Payment id={self.id} status={self.status} purpose={self.purpose}>"
