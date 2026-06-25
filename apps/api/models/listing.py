import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Enum, ForeignKey, Index, Integer, Numeric, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from .car import Car
    from .dealer import Dealer
    from .loan_inquiry import LoanInquiry
    from .test_drive_booking import TestDriveBooking
    from .user import User


class ListingType(str, enum.Enum):
    new = "new"
    used = "used"


class ListingCondition(str, enum.Enum):
    excellent = "excellent"
    good = "good"
    fair = "fair"
    poor = "poor"


class Listing(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "listings"
    __table_args__ = (
        Index("ix_listings_city_type", "city", "listing_type"),
        Index("ix_listings_car_id", "car_id"),
        Index("ix_listings_seller_id", "seller_id"),
        Index("ix_listings_active_featured", "is_active", "is_featured"),
        Index("ix_listings_price", "price"),
        Index("ix_listings_created_at", "created_at"),
    )

    car_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cars.id"), nullable=False
    )
    seller_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    dealer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("dealers.id")
    )
    listing_type: Mapped[ListingType] = mapped_column(
        Enum(ListingType, name="listing_type"), nullable=False
    )
    price: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    negotiable: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    km_driven: Mapped[int | None] = mapped_column(Integer)
    registration_year: Mapped[int | None] = mapped_column(SmallInteger)
    registration_state: Mapped[str | None] = mapped_column(String(10))
    owners_count: Mapped[int | None] = mapped_column(SmallInteger)
    condition: Mapped[ListingCondition | None] = mapped_column(
        Enum(ListingCondition, name="listing_condition")
    )
    city: Mapped[str | None] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    views_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    ai_valuation: Mapped[float | None] = mapped_column(Numeric(12, 2))
    ai_valuation_at: Mapped[datetime | None] = mapped_column()

    # Relationships
    car: Mapped["Car"] = relationship(back_populates="listings")
    seller: Mapped["User"] = relationship(back_populates="listings", foreign_keys=[seller_id])
    dealer: Mapped["Dealer | None"] = relationship(back_populates="listings")
    test_drive_bookings: Mapped[list["TestDriveBooking"]] = relationship(back_populates="listing")
    loan_inquiries: Mapped[list["LoanInquiry"]] = relationship(back_populates="listing")

    def __repr__(self) -> str:
        return f"<Listing id={self.id} type={self.listing_type} price={self.price}>"
