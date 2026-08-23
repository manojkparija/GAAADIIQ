"""
Vehicle challan verification (BRD §20).

Three entities: a verification attempt, the individual challans it found, and
the configurable rules that turn those into a listing decision.

WHERE THE DATA COMES FROM, AND WHERE IT MUST NOT

Challan data reaches GAADIIQ from an authorised source — NIC/Parivahan API
access, or a licensed aggregator. It does not come from scripting
echallan.parivahan.gov.in. That page is CAPTCHA-protected, and a CAPTCHA is an
access control that says humans only; automating past it breaks the portal's
terms and rests every seller's listing on markup that changes without notice.
BRD §6 rules it out explicitly.

Until an authorised source is connected, verification returns
VERIFICATION_PENDING. It never returns "clear". The distinction is the whole
point of this module: "we asked and found nothing" and "we could not ask" look
identical to a caller who only checks for the absence of challans, and treating
the second as the first would publish unverified vehicles under a badge that
says they were checked.

NO_RECORD_FOUND IS NOT "NEVER HAD A CHALLAN"

BRD §23 makes this distinction and §16 forbids the stronger claim. A source can
only answer for what it holds at the moment it is asked: challans are entered
late, states differ, and a record can appear tomorrow for an offence last
month. The status is deliberately named for what was observed rather than for
what is true of the vehicle, and `verified_at` is stored alongside every result
so the claim is always "checked on this date", never "clean".

THE THRESHOLDS ARE ROWS, NOT CONSTANTS

BRD §9 requires the blocking logic be configurable and §29 repeats it. A
hardcoded 5000 would be a business rule buried in a deploy: changing it would
need an engineer, and nobody could answer "what was the threshold in March"
after it changed. ChallanVerificationRule carries `effective_from` and
`effective_to` so a decision made last month can still be explained by the rule
that was live when it was made.
"""
import uuid
from datetime import date, datetime
from enum import Enum as PyEnum

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import TypeDecorator

from db.base import Base, TimestampMixin, UUIDMixin


class JSONBOrJSON(TypeDecorator):
    """JSONB on Postgres, plain JSON elsewhere — the suite runs on both."""

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB())
        return dialect.type_descriptor(JSON())


# ── Enumerations ──────────────────────────────────────────────────────────────


class ChallanVerificationStatus(str, PyEnum):
    """Did the lookup happen, and what did it see?

    Separate from the risk category below on purpose. "The provider timed out"
    and "the provider answered and found ₹18,500 outstanding" are different
    facts, and collapsing them into one field is how an outage comes to look
    like a clean vehicle.
    """

    pending = "pending"
    #: The source answered and returned challan records.
    completed = "completed"
    #: The source answered and held nothing for this vehicle. NOT proof the
    #: vehicle has never had a challan — see the module docstring.
    no_record_found = "no_record_found"
    #: Timeout, bad response, provider down, or no provider configured.
    failed = "failed"


class ChallanRiskCategory(str, PyEnum):
    """BRD §8, normalised across providers.

    `unknown` exists because a verification that failed has no risk category —
    and defaulting it to `clear` would be the single most dangerous line in
    this module.
    """

    unknown = "unknown"
    clear = "clear"
    low = "low"
    moderate = "moderate"
    high = "high"
    court_review = "court_review"


class ListingDecision(str, PyEnum):
    """What the rule engine concluded (BRD §10)."""

    verified = "verified"
    manual_review = "manual_review"
    blocked = "blocked"
    verification_pending = "verification_pending"


class ChallanRuleType(str, PyEnum):
    """The four rule kinds in BRD §9."""

    max_outstanding_amount = "max_outstanding_amount"
    max_outstanding_count = "max_outstanding_count"
    serious_offence = "serious_offence"
    court_status = "court_status"
    #: Not a threshold: how long a PASS stays usable (BRD §14).
    verification_validity_days = "verification_validity_days"


class ChallanRuleAction(str, PyEnum):
    block = "block"
    manual_review = "manual_review"
    allow = "allow"


# ── Entities ──────────────────────────────────────────────────────────────────


class VehicleChallanVerification(UUIDMixin, TimestampMixin, Base):
    """One verification attempt against one registration number."""

    __tablename__ = "vehicle_challan_verifications"
    __table_args__ = (
        # "Has this vehicle been checked, and how recently" — the pre-publish
        # question from BRD §14.
        Index("ix_challan_verif_reg_created", "registration_number", "created_at"),
        Index("ix_challan_verif_decision", "listing_decision"),
        Index("ix_challan_verif_listing", "listing_id"),
    )

    # Nullable: BRD §5 runs verification during listing, but the Track Challan
    # page lets somebody check a vehicle they have not listed. A lookup with no
    # listing behind it is still a lookup worth recording, for rate limiting
    # and for the audit trail.
    listing_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("listings.id", ondelete="CASCADE")
    )
    seller_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    # Stored normalised (FR-02): WB02AB1234, never "WB 02 AB 1234". The raw
    # input is not kept — it carries no information the normalised form lacks,
    # and two spellings of one vehicle would defeat the lookup index.
    registration_number: Mapped[str] = mapped_column(String(20), nullable=False)

    # Provenance. `provider` is null when no provider was configured, which is
    # what distinguishes "nobody to ask" from "asked and it failed".
    provider: Mapped[str | None] = mapped_column(String(60))
    provider_reference_id: Mapped[str | None] = mapped_column(String(160))
    requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    verification_status: Mapped[ChallanVerificationStatus] = mapped_column(
        Enum(ChallanVerificationStatus, name="challan_verification_status"),
        default=ChallanVerificationStatus.pending,
        nullable=False,
    )
    risk_category: Mapped[ChallanRiskCategory] = mapped_column(
        Enum(ChallanRiskCategory, name="challan_risk_category"),
        default=ChallanRiskCategory.unknown,
        nullable=False,
    )
    listing_decision: Mapped[ListingDecision] = mapped_column(
        Enum(ListingDecision, name="challan_listing_decision"),
        default=ListingDecision.verification_pending,
        nullable=False,
    )

    total_challan_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    outstanding_challan_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Numeric, not Float: money that is compared against a threshold must not
    # drift, or a vehicle sits on the wrong side of the line by a rounding error.
    total_outstanding_amount: Mapped[float] = mapped_column(
        Numeric(12, 2), default=0, nullable=False
    )

    # When the answer was obtained, and when it stops counting (BRD §14). Both
    # nullable: a failed attempt verified nothing and expires nothing.
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verification_expiry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    failure_reason: Mapped[str | None] = mapped_column(Text)
    # Which rule produced the decision, so it can be explained later even after
    # the rule has been edited.
    decision_reason: Mapped[str | None] = mapped_column(Text)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return (
            f"<VehicleChallanVerification {self.registration_number} "
            f"{self.verification_status} {self.listing_decision}>"
        )


class ChallanDetail(UUIDMixin, TimestampMixin, Base):
    """One challan as the source described it (BRD §7).

    Kept per-challan rather than only as a total because the seller has to know
    which challan to pay, and because a total alone cannot be re-checked
    against the source later.
    """

    __tablename__ = "challan_details"
    __table_args__ = (Index("ix_challan_details_verification", "verification_id"),)

    verification_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("vehicle_challan_verifications.id", ondelete="CASCADE"), nullable=False
    )

    challan_number: Mapped[str | None] = mapped_column(String(80))
    challan_date: Mapped[date | None] = mapped_column(Date)
    amount: Mapped[float | None] = mapped_column(Numeric(12, 2))
    # Distinct from `amount`: a partly-paid challan has both, and the rules in
    # BRD §9 are about what is still owed.
    outstanding_amount: Mapped[float | None] = mapped_column(Numeric(12, 2))

    state: Mapped[str | None] = mapped_column(String(10))
    department: Mapped[str | None] = mapped_column(String(120))
    # Free text as the source sends it. Not parsed into an enum GAADIIQ
    # invents: states word these differently and a forced mapping would lose
    # the distinction that mattered.
    challan_status: Mapped[str | None] = mapped_column(String(80))
    court_status: Mapped[str | None] = mapped_column(String(80))
    #: True when this record triggered the court/legal rule (BRD §8.5).
    is_court_case: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<ChallanDetail {self.challan_number} {self.outstanding_amount}>"


class ChallanVerificationRule(UUIDMixin, TimestampMixin, Base):
    """A configurable eligibility rule (BRD §9, §18, §29).

    `effective_from` / `effective_to` rather than editing in place: a listing
    blocked in March was blocked by March's threshold, and overwriting the row
    would make that decision unexplainable. Superseding a rule means closing
    the old row and inserting a new one.
    """

    __tablename__ = "challan_verification_rules"
    __table_args__ = (Index("ix_challan_rules_active_priority", "is_active", "priority"),)

    rule_name: Mapped[str] = mapped_column(String(120), nullable=False)
    rule_type: Mapped[ChallanRuleType] = mapped_column(
        Enum(ChallanRuleType, name="challan_rule_type"), nullable=False
    )
    # String rather than Numeric: a count, a rupee amount and a day count all
    # live here, and one column that means different things per rule_type is
    # honest about that rather than pretending they share a scale.
    configured_value: Mapped[str] = mapped_column(String(80), nullable=False)
    action: Mapped[ChallanRuleAction] = mapped_column(
        Enum(ChallanRuleAction, name="challan_rule_action"), nullable=False
    )
    # Lower runs first. The engine takes the first rule that fires, so priority
    # decides whether a vehicle that is both over the amount and in court is
    # reported as blocked or as needing review.
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    effective_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    effective_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<ChallanVerificationRule {self.rule_type}={self.configured_value} {self.action}>"


class ChallanAuditEvent(UUIDMixin, TimestampMixin, Base):
    """Who did what (BRD §19 FR-09).

    Separate from the verification row because an audit trail that lives in
    mutable columns on the thing being audited is not an audit trail. Admin
    decisions, re-verification attempts and configuration changes all land
    here, append-only.
    """

    __tablename__ = "challan_audit_events"
    __table_args__ = (Index("ix_challan_audit_verification", "verification_id", "created_at"),)

    verification_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("vehicle_challan_verifications.id", ondelete="SET NULL")
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    #: verification_requested | admin_approved | admin_rejected | rule_changed …
    event: Mapped[str] = mapped_column(String(60), nullable=False)
    detail: Mapped[dict | None] = mapped_column(JSONBOrJSON)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<ChallanAuditEvent {self.event}>"
