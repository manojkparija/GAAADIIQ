import enum
import uuid
from datetime import date, time
from typing import TYPE_CHECKING

from sqlalchemy import Date, Enum, ForeignKey, Text, Time
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from .listing import Listing
    from .user import User


class BookingStatus(str, enum.Enum):
    pending = "pending"
    confirmed = "confirmed"
    cancelled = "cancelled"
    completed = "completed"


class TestDriveBooking(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "test_drive_bookings"

    listing_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("listings.id"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    preferred_date: Mapped[date | None] = mapped_column(Date)
    preferred_time: Mapped[time | None] = mapped_column(Time)
    status: Mapped[BookingStatus] = mapped_column(
        Enum(BookingStatus, name="booking_status"),
        default=BookingStatus.pending,
        nullable=False,
    )
    notes: Mapped[str | None] = mapped_column(Text)

    # Relationships
    listing: Mapped["Listing"] = relationship(back_populates="test_drive_bookings")
    user: Mapped["User"] = relationship(back_populates="test_drive_bookings")

    def __repr__(self) -> str:
        return f"<TestDriveBooking id={self.id} status={self.status}>"
