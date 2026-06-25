import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from .listing import Listing
    from .user import User


class Dealer(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "dealers"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    business_name: Mapped[str] = mapped_column(String(255), nullable=False)
    city: Mapped[str | None] = mapped_column(String(100))
    state: Mapped[str | None] = mapped_column(String(100))
    gst_number: Mapped[str | None] = mapped_column(String(20))
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    rating: Mapped[float | None] = mapped_column(Numeric(3, 2))

    # Relationships
    user: Mapped["User"] = relationship(back_populates="dealer_profile")
    listings: Mapped[list["Listing"]] = relationship(back_populates="dealer")

    def __repr__(self) -> str:
        return f"<Dealer id={self.id} name={self.business_name}>"
