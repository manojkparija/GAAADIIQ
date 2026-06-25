import enum
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Enum, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from .dealer import Dealer
    from .listing import Listing
    from .loan_inquiry import LoanInquiry
    from .notification import Notification
    from .payment import Payment
    from .price_alert import PriceAlert
    from .review import Review
    from .subscription import Subscription
    from .test_drive_booking import TestDriveBooking


class UserRole(str, enum.Enum):
    buyer = "buyer"
    seller = "seller"
    dealer = "dealer"
    admin = "admin"


class User(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str | None] = mapped_column(String(255))
    full_name: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(20))
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role"), default=UserRole.buyer, nullable=False
    )
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Relationships
    dealer_profile: Mapped["Dealer | None"] = relationship(back_populates="user", uselist=False)
    listings: Mapped[list["Listing"]] = relationship(
        back_populates="seller", foreign_keys="Listing.seller_id"
    )
    test_drive_bookings: Mapped[list["TestDriveBooking"]] = relationship(back_populates="user")
    loan_inquiries: Mapped[list["LoanInquiry"]] = relationship(back_populates="user")
    notifications: Mapped[list["Notification"]] = relationship(back_populates="user")
    price_alerts: Mapped[list["PriceAlert"]] = relationship(back_populates="user")
    reviews_given: Mapped[list["Review"]] = relationship(
        foreign_keys="Review.reviewer_id", back_populates="reviewer"
    )
    reviews_received: Mapped[list["Review"]] = relationship(
        foreign_keys="Review.seller_id", back_populates="seller"
    )
    payments: Mapped[list["Payment"]] = relationship(back_populates="user")
    subscription: Mapped["Subscription | None"] = relationship(
        back_populates="user", uselist=False
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email}>"
