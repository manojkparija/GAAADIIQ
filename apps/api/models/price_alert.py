import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from .listing import Listing
    from .user import User


class PriceAlert(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "price_alerts"
    __table_args__ = (
        UniqueConstraint("user_id", "listing_id", name="uq_price_alert_user_listing"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    listing_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("listings.id"), nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="price_alerts")
    listing: Mapped["Listing"] = relationship(back_populates="price_alerts")

    def __repr__(self) -> str:
        return f"<PriceAlert user={self.user_id} listing={self.listing_id}>"
