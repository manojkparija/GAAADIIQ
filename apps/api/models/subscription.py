import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from .user import User


class SubscriptionTier(str, enum.Enum):
    """
    The plans that can be held.

    `pro` is Buyer Pro and `dealer` is Dealer Pro on the pricing page; the names
    differ because these predate the page. `seller_basic` was added in migration
    0045 — the page had offered it with a price since before there was any tier
    to sell, so its call to action navigated instead of charging.

    Adding a member here needs THREE other things in step, or the failure is at
    runtime rather than at import:
      * a price in routers/payments.SUBSCRIPTION_PRICES (a missing one is a
        zero-rupee order, not an error)
      * a matching PaymentPurpose label, because the purpose is built by string
        interpolation from tier.value
      * an ALTER TYPE migration, since this is a native enum on Postgres
    test_pricing_plans_e2e.py asserts the first two.
    """

    free = "free"
    pro = "pro"
    seller_basic = "seller_basic"
    dealer = "dealer"


class Subscription(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "subscriptions"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_subscription_user"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    tier: Mapped[SubscriptionTier] = mapped_column(
        Enum(SubscriptionTier, name="subscription_tier"),
        default=SubscriptionTier.free,
        nullable=False,
    )
    valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped["User"] = relationship(back_populates="subscription")

    def __repr__(self) -> str:
        return f"<Subscription user={self.user_id} tier={self.tier}>"
