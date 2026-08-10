"""Car loan applications, the offers they generate, and the credit checks behind them.

Three tables, and the split matters:

`loan_applications` is what the buyer filled in. `loan_offers` is what each
lender's card produced for it — a *snapshot*, not a view. Rate cards change
weekly, so an offer recomputed on read would silently differ from the one the
buyer was shown and acted on. `credit_checks` is the audit trail of every
attempt to establish a score, kept separate because consent is the thing being
recorded and it has to survive the application being updated or withdrawn.

Distinct from `loan_inquiries`, which is a lead handed to a used-car seller. An
inquiry says "this buyer might need finance". An application carries the
applicant's PAN, an income declaration, a consent record and a lender choice.
Merging them would put PAN and consent on rows that never needed either.
"""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base, TimestampMixin, UUIDMixin
from models.lending_partner import CreditBand, EmploymentType

if TYPE_CHECKING:
    from .car import Car
    from .lending_partner import LendingPartner
    from .listing import Listing
    from .user import User


class LoanApplicationStatus(str, enum.Enum):
    """Lifecycle.

    `offers_ready` is its own state rather than being inferred from the offers
    table: an application with no eligible lender has offers computed and none
    to show, and that is a different thing from offers never having been run.
    """

    draft = "draft"
    submitted = "submitted"
    offers_ready = "offers_ready"
    partner_selected = "partner_selected"
    forwarded = "forwarded"          # handed to the lender
    approved = "approved"
    rejected = "rejected"
    withdrawn = "withdrawn"
    disbursed = "disbursed"


class VehicleCondition(str, enum.Enum):
    new = "new"
    used = "used"


class CreditSource(str, enum.Enum):
    """Where the credit band came from.

    Recorded on the application because it changes what the offers mean. A
    self-declared band produces an *estimate*; a bureau-sourced one produces an
    indicative quote. Showing both the same way would let a buyer treat their
    own guess as a lender's assessment.
    """

    self_declared = "self_declared"
    bureau = "bureau"
    unavailable = "unavailable"


class LoanApplication(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "loan_applications"
    __table_args__ = (
        Index("ix_loan_applications_user_status", "user_id", "status"),
    )

    #: Human-facing reference quoted in email and to support ("LN-4C1F09").
    reference: Mapped[str] = mapped_column(String(20), nullable=False, unique=True, index=True)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # --- What is being financed ---------------------------------------------
    # Both nullable and both kept: a new car is a catalogue row, a used one is a
    # seller's listing, and an applicant may be financing a vehicle found
    # elsewhere entirely. The price is copied rather than read through the
    # relationship because it is what the loan was sized against — a later
    # catalogue price change must not silently restate an existing application.
    car_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cars.id", ondelete="SET NULL"), nullable=True, index=True
    )
    listing_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("listings.id", ondelete="SET NULL"), nullable=True, index=True
    )
    vehicle_condition: Mapped[VehicleCondition] = mapped_column(
        Enum(VehicleCondition, name="loan_vehicle_condition"),
        default=VehicleCondition.new,
        nullable=False,
    )
    vehicle_description: Mapped[str | None] = mapped_column(String(200))
    vehicle_year: Mapped[int | None] = mapped_column(SmallInteger)
    vehicle_price: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)

    # --- Applicant ----------------------------------------------------------
    applicant_name: Mapped[str] = mapped_column(String(150), nullable=False)
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    mobile: Mapped[str] = mapped_column(String(15), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255))
    city: Mapped[str | None] = mapped_column(String(100))
    pincode: Mapped[str | None] = mapped_column(String(10))

    # PAN is stored, unlike the Aadhaar on `mechanics`, because it has to be
    # passed to the lender to be of any use — a digest cannot be forwarded. It
    # is therefore never returned by the API in full: see `pan_masked`. The
    # digest exists so an application can be found by PAN without a table scan
    # over the number itself.
    pan_number: Mapped[str] = mapped_column(String(10), nullable=False)
    pan_digest: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    # --- Income -------------------------------------------------------------
    employment_type: Mapped[EmploymentType] = mapped_column(
        Enum(EmploymentType, name="loan_employment_type"), nullable=False
    )
    employer_name: Mapped[str | None] = mapped_column(String(150))
    monthly_income: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    #: Existing monthly obligations. Subtracted before FOIR, because a lender
    #: cares what is left over, not what is earned.
    existing_emi: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)

    # --- The ask ------------------------------------------------------------
    down_payment: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    loan_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    tenure_months: Mapped[int] = mapped_column(SmallInteger, nullable=False)

    # --- Credit -------------------------------------------------------------
    credit_score: Mapped[int | None] = mapped_column(SmallInteger)
    credit_band: Mapped[CreditBand] = mapped_column(
        Enum(CreditBand, name="credit_band"), default=CreditBand.unknown, nullable=False
    )
    credit_source: Mapped[CreditSource] = mapped_column(
        Enum(CreditSource, name="loan_credit_source"),
        default=CreditSource.unavailable,
        nullable=False,
    )
    credit_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Consent is a legal artefact, not a checkbox. Under the Credit Information
    # Companies (Regulation) Act a bureau may only be queried with the
    # borrower's explicit consent, and the timestamp and source address are the
    # evidence that it was given. No bureau call may run without these set.
    credit_consent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    credit_consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    credit_consent_ip: Mapped[str | None] = mapped_column(String(45))

    status: Mapped[LoanApplicationStatus] = mapped_column(
        Enum(LoanApplicationStatus, name="loan_application_status"),
        default=LoanApplicationStatus.submitted,
        nullable=False,
        index=True,
    )
    #: The offer the applicant chose. Deliberately a plain column and not a
    #: foreign key: offers are regenerated when the application changes, and an
    #: FK would either block that or cascade the selection away.
    selected_offer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    decision_note: Mapped[str | None] = mapped_column(Text)

    offers: Mapped[list["LoanOffer"]] = relationship(
        back_populates="application", cascade="all, delete-orphan", lazy="selectin"
    )
    credit_checks: Mapped[list["CreditCheck"]] = relationship(
        back_populates="application", cascade="all, delete-orphan"
    )
    user: Mapped["User"] = relationship()
    car: Mapped["Car | None"] = relationship()
    listing: Mapped["Listing | None"] = relationship()

    @property
    def pan_masked(self) -> str:
        """`ABCDE1234F` -> `ABCDE****F`. What every API response carries."""
        pan = self.pan_number or ""
        return f"{pan[:5]}****{pan[9:]}" if len(pan) == 10 else "****"

    def __repr__(self) -> str:
        return f"<LoanApplication {self.reference} {self.status}>"


class LoanOffer(UUIDMixin, TimestampMixin, Base):
    """One lender's quote for one application, frozen at the moment it was made.

    Every figure is stored rather than derived. The rate card behind it will
    change, and an offer that silently re-prices itself between the buyer
    reading it and acting on it is the one bug this table exists to prevent.
    """

    __tablename__ = "loan_offers"
    __table_args__ = (
        UniqueConstraint("application_id", "partner_id", name="uq_loan_offer_application_partner"),
    )

    application_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("loan_applications.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    partner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("lending_partners.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    is_eligible: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    #: Why not, in words meant for the applicant. An ineligible lender is shown
    #: with its reason rather than hidden — "why isn't SBI here?" is a worse
    #: experience than "SBI needs ₹25,000 a month".
    ineligible_reason: Mapped[str | None] = mapped_column(String(200))

    annual_rate_pct: Mapped[float | None] = mapped_column(Numeric(5, 2))
    #: May be below the amount asked for, when LTV or FOIR caps bite.
    approved_amount: Mapped[float | None] = mapped_column(Numeric(12, 2))
    tenure_months: Mapped[int | None] = mapped_column(SmallInteger)
    monthly_emi: Mapped[float | None] = mapped_column(Numeric(12, 2))
    total_interest: Mapped[float | None] = mapped_column(Numeric(12, 2))
    processing_fee: Mapped[float | None] = mapped_column(Numeric(10, 2))
    #: Interest plus fees. What the loan actually costs, and what the ranking
    #: sorts on — the lowest headline rate is not always the cheapest loan.
    total_cost: Mapped[float | None] = mapped_column(Numeric(12, 2))

    rank: Mapped[int | None] = mapped_column(Integer)
    is_recommended: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    application: Mapped["LoanApplication"] = relationship(back_populates="offers")
    partner: Mapped["LendingPartner"] = relationship(back_populates="offers", lazy="selectin")

    def __repr__(self) -> str:
        return f"<LoanOffer {self.partner_id} rank={self.rank}>"


class CreditCheck(UUIDMixin, TimestampMixin, Base):
    """A record of one attempt to establish an applicant's credit standing.

    Kept even when it fails, and kept when the application is later edited. The
    question this table answers is "on what basis, and with whose permission,
    did we quote this person" — and that has to remain answerable afterwards.
    """

    __tablename__ = "credit_checks"

    application_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("loan_applications.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: The PAN queried, as a digest. The number itself lives on the application;
    #: repeating it here would multiply the copies without adding anything.
    pan_digest: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    source: Mapped[CreditSource] = mapped_column(
        Enum(CreditSource, name="loan_credit_source"), nullable=False
    )
    #: Which bureau answered, when one did ("cibil", "experian").
    bureau: Mapped[str | None] = mapped_column(String(40))
    score: Mapped[int | None] = mapped_column(SmallInteger)
    band: Mapped[CreditBand] = mapped_column(
        Enum(CreditBand, name="credit_band"), default=CreditBand.unknown, nullable=False
    )
    succeeded: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    error: Mapped[str | None] = mapped_column(String(300))
    #: The bureau's own reference for the enquiry, for dispute resolution.
    consent_reference: Mapped[str | None] = mapped_column(String(100))

    application: Mapped["LoanApplication"] = relationship(back_populates="credit_checks")

    def __repr__(self) -> str:
        return f"<CreditCheck {self.source} band={self.band}>"
