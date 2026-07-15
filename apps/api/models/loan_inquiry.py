import enum
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Enum, ForeignKey, Numeric, SmallInteger, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from .listing import Listing
    from .user import User


class EmploymentType(str, enum.Enum):
    salaried = "salaried"
    self_employed = "self_employed"
    business = "business"


class LoanStatus(str, enum.Enum):
    submitted = "submitted"
    processing = "processing"
    approved = "approved"
    rejected = "rejected"


class LoanInquiry(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "loan_inquiries"

    listing_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("listings.id"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    loan_amount: Mapped[float | None] = mapped_column(Numeric(12, 2))
    tenure_months: Mapped[int | None] = mapped_column(SmallInteger)
    employment_type: Mapped[EmploymentType | None] = mapped_column(
        Enum(EmploymentType, name="employment_type")
    )
    annual_income: Mapped[float | None] = mapped_column(Numeric(12, 2))
    status: Mapped[LoanStatus] = mapped_column(
        Enum(LoanStatus, name="loan_status"),
        default=LoanStatus.submitted,
        nullable=False,
    )
    partner_ref: Mapped[str | None] = mapped_column(String(100))

    # Relationships
    listing: Mapped["Listing"] = relationship(back_populates="loan_inquiries")
    user: Mapped["User"] = relationship(back_populates="loan_inquiries")

    def __repr__(self) -> str:
        return f"<LoanInquiry id={self.id} status={self.status}>"
