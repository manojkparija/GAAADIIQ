"""
Motor insurance distribution: partners, quotes, leads, policies, revenue.

BRD §21 asks for five entities. They are in one module because they are one
lifecycle — a quote becomes a lead becomes a policy becomes a payout — and
splitting them across five files would hide the fact that the whole point of
the schema is the chain of foreign keys running down it.

WHAT GAADIIQ IS, AND WHAT THAT MEANS FOR THIS SCHEMA
====================================================

GAADIIQ is not an insurer, a broker or a web aggregator. It cannot price risk,
cannot underwrite and cannot issue a policy. Every number a user sees on an
insurance screen must therefore have arrived from a regulated partner and be
attributable to one. That is not a nicety — a premium is a representation about
a financial product, and one this platform invented would be indistinguishable
at the point of display from one an insurer stands behind.

So the schema records provenance, not just values:

  * `InsuranceQuote.partner_id` is NOT NULL. A quote with no partner behind it
    cannot exist as a row, which is the storage-layer half of the rule that
    services/insurance/registry.py enforces in code.
  * `raw_response` keeps what the partner actually sent. When a user disputes a
    premium months later, "what did we display and who told us to" has to be
    answerable from the database rather than from a log that has rotated away.
  * `InsurancePolicy` holds a partner reference, never a reconstructed policy
    document. GAADIIQ does not issue policies and must not appear to.

CONSENT IS A TIMESTAMP, NOT A BOOLEAN
=====================================

`InsuranceLead.consented_at` follows the same reasoning as CarLead: consent
that cannot be dated cannot be shown to have preceded the data sharing it
authorised. `consent_text` stores the exact wording shown, because the wording
is what was agreed to and it will change over time.

Personal data goes to a third party here, which `car_leads` does not do. Two
extra columns carry that: `shared_with_partner_at` records when it left, and
`partner_id` records who received it. A data-subject request asking "who has my
number" has to be answerable, and it cannot be answered from a request log.

REVENUE IS NOT A CONSEQUENCE OF A QUOTE
=======================================

BRD §11 is explicit that a quote is not revenue, and the schema refuses to let
the two be conflated: `InsuranceRevenue` hangs off `InsurancePolicy`, not off
the quote or the lead, so a payout row cannot exist for a policy that was never
issued. `expected_amount` and `confirmed_amount` are separate columns for the
same reason — the first is GAADIIQ's arithmetic, the second is the partner's,
and reporting them as one number is how a pipeline comes to be believed.

No commission percentage is hardcoded anywhere in this module. Payout terms
live in `InsurancePartner.payout_config` because they are contractual, they
differ per product and vehicle category, and they change on a date.
"""
import uuid
from datetime import date, datetime
from enum import Enum as PyEnum

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import TypeDecorator

from db.base import Base, TimestampMixin, UUIDMixin


class JSONBOrJSON(TypeDecorator):
    """JSONB on Postgres, plain JSON elsewhere.

    The suite runs on SQLite as well as Postgres (see ci-api.yml), and a bare
    JSONB column makes the SQLite half fail at DDL time rather than at the
    first query, which reads like a broken test rather than a wrong type.
    """

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB())
        return dialect.type_descriptor(JSON())


# ── Enumerations ──────────────────────────────────────────────────────────────


class InsurancePartnerType(str, PyEnum):
    """What the partner is registered as.

    This drives what GAADIIQ may display: an insurer can only quote its own
    products, whereas a broker may return several insurers' products in one
    response.

    Prefixed because models/lending_partner.py already exports a `PartnerType`
    for loan providers. Two enums of the same name reachable from `models` is
    how the wrong one gets imported — and both describe a financial
    counterparty, so the mistake would type-check and read plausibly at the
    call site.
    """

    insurer = "insurer"
    broker = "broker"
    intermediary = "intermediary"


class QuoteStatus(str, PyEnum):
    requested = "requested"
    returned = "returned"
    failed = "failed"
    expired = "expired"


class InsuranceLeadStatus(str, PyEnum):
    """BRD §11's lifecycle, minus the stages that belong to revenue.

    Named with the `Insurance` prefix because models/car_lead.py already
    exports a `LeadStatus`; two enums of the same name in one metadata is how
    the wrong one gets imported.

    `submitted` means the personal data has left GAADIIQ. It is a separate
    stage from `consented` on purpose — the gap between them is exactly the
    window in which a user can still withdraw before anything is shared.
    """

    created = "created"
    consented = "consented"
    submitted = "submitted"
    plan_selected = "plan_selected"
    purchase_started = "purchase_started"
    converted = "converted"
    abandoned = "abandoned"


class PolicyStatus(str, PyEnum):
    pending = "pending"
    issued = "issued"
    cancelled = "cancelled"
    expired = "expired"


class RevenueStatus(str, PyEnum):
    """`expected` is GAADIIQ's own arithmetic and must never be reported as
    earnings. Only `confirmed` onward has the partner behind it."""

    expected = "expected"
    confirmed = "confirmed"
    received = "received"
    reversed = "reversed"


class PolicyType(str, PyEnum):
    comprehensive = "comprehensive"
    third_party = "third_party"
    own_damage = "own_damage"


# ── Entities ──────────────────────────────────────────────────────────────────


class InsurancePartner(UUIDMixin, TimestampMixin, Base):
    """A regulated entity GAADIIQ has an agreement with.

    Credentials are deliberately absent. `credentials_ref` names an environment
    variable or secret-manager key; the secret itself never enters the database,
    so a database dump is not a set of live partner credentials.
    """

    __tablename__ = "insurance_partners"

    name: Mapped[str] = mapped_column(String(160), nullable=False, unique=True)
    partner_type: Mapped[InsurancePartnerType] = mapped_column(
        Enum(InsurancePartnerType, name="insurance_partner_type"), nullable=False
    )
    # The partner's own regulatory registration, shown to users alongside any
    # product it supplies. BRD §22 requires the responsible party be identified.
    registration_no: Mapped[str | None] = mapped_column(String(80))
    adapter_key: Mapped[str] = mapped_column(String(60), nullable=False, unique=True)
    api_base_url: Mapped[str | None] = mapped_column(String(500))
    credentials_ref: Mapped[str | None] = mapped_column(String(160))
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supported_products: Mapped[list | None] = mapped_column(JSONBOrJSON)
    # Contractual payout terms, per product / category / effective date. Read by
    # the revenue module; never hardcoded there.
    payout_config: Mapped[dict | None] = mapped_column(JSONBOrJSON)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<InsurancePartner {self.name} {self.partner_type} active={self.is_active}>"


class InsuranceQuote(UUIDMixin, TimestampMixin, Base):
    """One quote request and what came back for it.

    `reference` is the GAADIIQ attribution ID (GIQ-INS-YYYY-NNNNNNNN) passed to
    the partner. Without it a policy issued on the partner's side cannot be tied
    back to the journey that produced it, which is the revenue leakage BRD §12
    is about.
    """

    __tablename__ = "insurance_quotes"
    __table_args__ = (
        Index("ix_insurance_quotes_user_created", "user_id", "created_at"),
        Index("ix_insurance_quotes_partner_status", "partner_id", "quote_status"),
    )

    reference: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)

    # Null for a guest: the landing page can be used without an account, and
    # refusing to record that journey would lose the attribution as well.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    # RESTRICT, not SET NULL: a quote whose partner has been deleted has no
    # attributable source, and this schema's central claim is that no such row
    # exists. Deactivate a partner instead of deleting one.
    partner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("insurance_partners.id", ondelete="RESTRICT"), nullable=False
    )
    partner_quote_id: Mapped[str | None] = mapped_column(String(120))

    # The vehicle, denormalised for the same reason car_leads denormalises it:
    # it must survive the catalogue row being edited underneath the quote.
    car_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cars.id", ondelete="SET NULL")
    )
    make: Mapped[str] = mapped_column(String(80), nullable=False)
    model: Mapped[str] = mapped_column(String(120), nullable=False)
    variant: Mapped[str | None] = mapped_column(String(120))
    fuel_type: Mapped[str | None] = mapped_column(String(30))
    manufacturing_year: Mapped[int | None] = mapped_column(Integer)
    # A registration number identifies a specific vehicle and, through the RTO
    # record, a specific person. Stored only when the user typed one.
    registration_no: Mapped[str | None] = mapped_column(String(20))

    policy_type: Mapped[PolicyType] = mapped_column(
        Enum(PolicyType, name="insurance_policy_type"), nullable=False
    )
    quote_status: Mapped[QuoteStatus] = mapped_column(
        Enum(QuoteStatus, name="insurance_quote_status"),
        default=QuoteStatus.requested,
        nullable=False,
    )
    # What the partner sent, kept verbatim. See the module docstring.
    raw_response: Mapped[dict | None] = mapped_column(JSONBOrJSON)
    failure_reason: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<InsuranceQuote {self.reference} {self.quote_status}>"


class InsuranceLead(UUIDMixin, TimestampMixin, Base):
    """A user who asked to be taken forward, and the consent that permits it.

    QUOTE AND PARTNER ARE BOTH NULLABLE, WHICH IS THE WHOLE POINT AT LAUNCH.

    Partners are onboarded after the production release, so on day one there
    are no partner rows at all. A lead that required one could not be written,
    and the first weeks of demand — the evidence a partner is actually shown
    when negotiating — would be discarded at the point of capture.

    So a lead has two shapes:

      * an *interest* lead: no quote, no partner. Somebody asked about
        insurance for a specific vehicle before GAADIIQ could do anything about
        it. This is the only shape that exists until the first partner signs.
      * a *routed* lead: quote and partner both set, created from a real quote
        the partner returned.

    A lead with a quote must have that quote's partner — a lead pointing at one
    partner's quote while routed to another would send personal data to a party
    that never quoted for it. `ck_lead_quote_implies_partner` enforces it in the
    database rather than in whichever endpoint happens to write the row.

    The consent wording differs between the two shapes and that difference
    matters: an interest lead cannot consent to sharing with a named partner,
    because there is no partner to name. `consent_text` records what was
    actually agreed to, and `shared_with_partner_at` stays null until data
    genuinely leaves — which for every interest lead is never.
    """

    __tablename__ = "insurance_leads"
    __table_args__ = (
        Index("ix_insurance_leads_status_created", "lead_status", "created_at"),
        CheckConstraint(
            "quote_id IS NULL OR partner_id IS NOT NULL",
            name="ck_lead_quote_implies_partner",
        ),
    )

    quote_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("insurance_quotes.id", ondelete="CASCADE")
    )
    partner_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("insurance_partners.id", ondelete="RESTRICT")
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    # The vehicle, on the lead rather than only on the quote. An interest lead
    # has no quote row to carry it, and a lead that cannot say which car it is
    # about is not a lead — it is a phone number.
    car_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cars.id", ondelete="SET NULL")
    )
    make: Mapped[str | None] = mapped_column(String(80))
    model: Mapped[str | None] = mapped_column(String(120))
    variant: Mapped[str | None] = mapped_column(String(120))
    fuel_type: Mapped[str | None] = mapped_column(String(30))
    manufacturing_year: Mapped[int | None] = mapped_column(Integer)
    registration_no: Mapped[str | None] = mapped_column(String(20))
    # Where the user is. Insurance premiums are zone-rated in India, so this is
    # a real underwriting input rather than a nicety, and it is what a partner
    # will ask for first when assessing whether this demand is worth serving.
    city: Mapped[str | None] = mapped_column(String(100))

    # Contact details, stored in the clear because they are the point of the
    # record. Same reasoning as models/car_lead.py.
    name: Mapped[str | None] = mapped_column(String(160))
    phone: Mapped[str] = mapped_column(String(16), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255))

    # Null means no consent was given, and nothing may be shared.
    consented_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The exact wording agreed to. It changes over time; the row must keep the
    # version that was actually shown.
    consent_text: Mapped[str | None] = mapped_column(Text)
    # When the personal data actually left GAADIIQ, for data-subject requests.
    shared_with_partner_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    lead_status: Mapped[InsuranceLeadStatus] = mapped_column(
        Enum(InsuranceLeadStatus, name="insurance_lead_status"),
        default=InsuranceLeadStatus.created,
        nullable=False,
    )
    selected_plan: Mapped[dict | None] = mapped_column(JSONBOrJSON)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<InsuranceLead {self.id} {self.lead_status}>"


class InsurancePolicy(UUIDMixin, TimestampMixin, Base):
    """A policy the partner issued. GAADIIQ stores a reference to it, not it."""

    __tablename__ = "insurance_policies"
    __table_args__ = (
        # The partner's identifier is unique per partner, not globally: two
        # insurers may legitimately use the same policy number format. This
        # constraint is also what makes the conversion webhook idempotent — a
        # replayed POLICY_ISSUED cannot create a second row.
        UniqueConstraint("partner_id", "partner_policy_ref", name="uq_policy_partner_ref"),
        # The renewal reminder job's query: whose policy expires soon.
        Index("ix_insurance_policies_user_expiry", "user_id", "end_date"),
    )

    lead_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("insurance_leads.id", ondelete="SET NULL")
    )
    partner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("insurance_partners.id", ondelete="RESTRICT"), nullable=False
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    partner_policy_ref: Mapped[str] = mapped_column(String(120), nullable=False)
    policy_status: Mapped[PolicyStatus] = mapped_column(
        Enum(PolicyStatus, name="insurance_policy_status"),
        default=PolicyStatus.pending,
        nullable=False,
    )
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    # Where the user can obtain the document from the partner. GAADIIQ does not
    # host policy PDFs; it links to whoever issued them.
    document_url: Mapped[str | None] = mapped_column(String(1000))

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<InsurancePolicy {self.partner_policy_ref} {self.policy_status}>"


class InsuranceRevenue(UUIDMixin, TimestampMixin, Base):
    """Payout against an issued policy.

    Amounts are Numeric, not Float. Money in a float accumulates error that
    surfaces later as a reconciliation mismatch nobody can explain.
    """

    __tablename__ = "insurance_revenue"
    __table_args__ = (Index("ix_insurance_revenue_status", "revenue_status"),)

    policy_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("insurance_policies.id", ondelete="CASCADE"), nullable=False
    )
    partner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("insurance_partners.id", ondelete="RESTRICT"), nullable=False
    )
    revenue_status: Mapped[RevenueStatus] = mapped_column(
        Enum(RevenueStatus, name="insurance_revenue_status"),
        default=RevenueStatus.expected,
        nullable=False,
    )
    # GAADIIQ's arithmetic from payout_config. Never reported as earnings.
    expected_amount: Mapped[float | None] = mapped_column(Numeric(12, 2))
    # The partner's figure. Only this one is real.
    confirmed_amount: Mapped[float | None] = mapped_column(Numeric(12, 2))
    received_amount: Mapped[float | None] = mapped_column(Numeric(12, 2))
    settlement_date: Mapped[date | None] = mapped_column(Date)
    reversal_reason: Mapped[str | None] = mapped_column(Text)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<InsuranceRevenue {self.policy_id} {self.revenue_status}>"


class InsuranceReferenceCounter(Base):
    """Per-year counter behind GIQ-INS-YYYY-NNNNNNNN.

    A UUID would be easier and is not what BRD §12 asks for: a human reads
    these off a reconciliation spreadsheet and a support agent reads one over
    the phone. The counter is taken under a row lock, so two concurrent
    journeys cannot be issued the same reference.

    The sequence is not gapless. A transaction that takes a number and then
    rolls back leaves a hole, and closing that hole would mean holding the lock
    across the partner call. A gap is cheaper than a lock held over a network
    round trip; reconciliation matches on the reference, not on its density.
    """

    __tablename__ = "insurance_reference_counters"

    year: Mapped[int] = mapped_column(Integer, primary_key=True)
    last_value: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<InsuranceReferenceCounter {self.year}={self.last_value}>"
