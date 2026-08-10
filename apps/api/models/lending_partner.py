"""Lenders and the rates they publish.

Two tables rather than a rate column on the partner, because an auto-loan rate
is never one number: it moves with the applicant's credit band and, for most
lenders, with whether they are salaried or self-employed. A single
`interest_rate` would force us to quote one figure to everybody, which is the
thing that makes a comparison page useless — every bank looks identical and the
buyer learns nothing.

Nothing here is a commitment. These are the indicative rates a lender publishes
for marketing; the binding offer comes from the lender after their own
underwriting. Every surface that shows these figures has to say so.
"""

from __future__ import annotations

import enum
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from .loan_application import LoanOffer


class PartnerType(str, enum.Enum):
    bank = "bank"
    nbfc = "nbfc"
    captive = "captive"  # manufacturer's own finance arm (Maruti Suzuki Finance)


class CreditBand(str, enum.Enum):
    """CIBIL score grouped the way lenders actually price it.

    Bands rather than raw scores because that is the granularity a rate card is
    written at, and because it lets an applicant who has not consented to a
    bureau pull still be quoted from a self-declared band.

    `unknown` is a real state, not a default to be avoided: it means we have no
    basis for a score, and the honest response is the lender's worst published
    rate plus a note, never an invented number.
    """

    excellent = "excellent"   # 750+
    good = "good"             # 700-749
    fair = "fair"             # 650-699
    poor = "poor"             # below 650
    unknown = "unknown"


class EmploymentType(str, enum.Enum):
    """Mirrors models.loan_inquiry.EmploymentType.

    Duplicated deliberately: that enum belongs to the old seller-lead flow and
    this one is written into a rate card. Sharing it would mean a change made
    for one feature silently repricing the other.
    """

    salaried = "salaried"
    self_employed = "self_employed"
    business = "business"


class LendingPartner(UUIDMixin, TimestampMixin, Base):
    """A bank or NBFC a buyer can be matched to."""

    __tablename__ = "lending_partners"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(60), nullable=False, unique=True, index=True)
    partner_type: Mapped[PartnerType] = mapped_column(
        Enum(PartnerType, name="lending_partner_type"),
        default=PartnerType.bank,
        nullable=False,
    )
    logo_url: Mapped[str | None] = mapped_column(String(500))

    # --- Eligibility gates --------------------------------------------------
    # An applicant failing any of these is shown the lender as ineligible with
    # the reason, rather than the lender being hidden. "Why isn't SBI here?" is
    # a worse experience than "SBI needs ₹25,000/month".
    min_loan_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=100000, nullable=False)
    max_loan_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=5000000, nullable=False)
    min_tenure_months: Mapped[int] = mapped_column(SmallInteger, default=12, nullable=False)
    max_tenure_months: Mapped[int] = mapped_column(SmallInteger, default=84, nullable=False)
    min_monthly_income: Mapped[float] = mapped_column(Numeric(12, 2), default=15000, nullable=False)
    min_credit_score: Mapped[int] = mapped_column(SmallInteger, default=650, nullable=False)

    #: Share of the vehicle price a lender will fund. The rest is the buyer's
    #: down payment, and it is the number most buyers are surprised by.
    max_ltv_pct: Mapped[float] = mapped_column(Numeric(5, 2), default=85, nullable=False)

    #: Ceiling on monthly obligations (this EMI plus existing ones) as a share of
    #: income. The standard underwriting cut, and the reason a high earner with
    #: three running loans is declined.
    max_foir_pct: Mapped[float] = mapped_column(Numeric(5, 2), default=50, nullable=False)

    finances_used_cars: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    #: Used cars only: most lenders will not fund a vehicle that will be beyond
    #: this age at the end of the loan.
    max_vehicle_age_years: Mapped[int] = mapped_column(SmallInteger, default=10, nullable=False)

    # --- Charges ------------------------------------------------------------
    processing_fee_pct: Mapped[float] = mapped_column(Numeric(5, 3), default=0.5, nullable=False)
    processing_fee_min: Mapped[float] = mapped_column(Numeric(10, 2), default=1000, nullable=False)
    processing_fee_max: Mapped[float] = mapped_column(Numeric(10, 2), default=10000, nullable=False)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    rate_slabs: Mapped[list["LenderRateSlab"]] = relationship(
        back_populates="partner", cascade="all, delete-orphan", lazy="selectin"
    )
    offers: Mapped[list["LoanOffer"]] = relationship(back_populates="partner")

    def __repr__(self) -> str:
        return f"<LendingPartner {self.slug}>"


class LenderRateSlab(UUIDMixin, TimestampMixin, Base):
    """One cell of a lender's rate card.

    `employment_type` NULL means "any" — most lenders publish a single card and
    only some differentiate, so a NULL row is the common case and a typed row is
    the exception that overrides it.
    """

    __tablename__ = "lender_rate_slabs"
    __table_args__ = (
        UniqueConstraint(
            "partner_id", "credit_band", "employment_type", name="uq_rate_slab_partner_band_employment"
        ),
    )

    partner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("lending_partners.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    credit_band: Mapped[CreditBand] = mapped_column(
        Enum(CreditBand, name="credit_band"), nullable=False
    )
    employment_type: Mapped[EmploymentType | None] = mapped_column(
        Enum(EmploymentType, name="loan_employment_type"), nullable=True
    )
    annual_rate_pct: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    #: Overrides the partner's LTV for this band — a thin file is funded less.
    max_ltv_pct: Mapped[float | None] = mapped_column(Numeric(5, 2))

    partner: Mapped["LendingPartner"] = relationship(back_populates="rate_slabs")

    def __repr__(self) -> str:
        return f"<LenderRateSlab {self.credit_band} {self.annual_rate_pct}%>"
