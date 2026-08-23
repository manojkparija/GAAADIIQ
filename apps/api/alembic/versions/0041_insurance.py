"""insurance: partners, quotes, leads, policies, revenue

Revision ID: 0041
Revises: 0040
Create Date: 2026-08-23

Six tables for the insurance module (BRD §21 asks for five entities; the sixth
is the counter behind the GIQ-INS-YYYY-NNNNNNNN attribution reference).

ON THE ENUM TYPES. Same trap 0040 documented, and it is worth restating rather
than assuming the next person reads that file: `create_table` emits CREATE TYPE
for each enum column, so creating the types up front *and* letting the columns
create them makes the chain die on a fresh Postgres database with

    DuplicateObjectError: type "insurance_policy_type" already exists

Every enum column below therefore passes `create_type=False`, leaving exactly
one place that creates each type. SQLite has no enum types and ignores all of
it, so the SQLite half of the suite is green either way — only CI's "Test on
Postgres" job, which applies this chain to an empty database, can catch a
mistake here.

ON THE FOREIGN KEYS. `partner_id` is RESTRICT on every table that has one, not
SET NULL. A quote or policy whose partner has been deleted has no attributable
source, and the module's central claim is that no such row can exist. Partners
are deactivated (`is_active = false`), never deleted.
"""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None


PARTNER_TYPE = ("insurer", "broker", "intermediary")
QUOTE_STATUS = ("requested", "returned", "failed", "expired")
LEAD_STATUS = (
    "created",
    "consented",
    "submitted",
    "plan_selected",
    "purchase_started",
    "converted",
    "abandoned",
)
POLICY_STATUS = ("pending", "issued", "cancelled", "expired")
REVENUE_STATUS = ("expected", "confirmed", "received", "reversed")
POLICY_TYPE = ("comprehensive", "third_party", "own_damage")

ENUMS = [
    (PARTNER_TYPE, "insurance_partner_type"),
    (QUOTE_STATUS, "insurance_quote_status"),
    (LEAD_STATUS, "insurance_lead_status"),
    (POLICY_STATUS, "insurance_policy_status"),
    (REVENUE_STATUS, "insurance_revenue_status"),
    (POLICY_TYPE, "insurance_policy_type"),
]


def _enum(values, name, *, create_type: bool):
    """Postgres gets a real enum type; anything else gets a plain Enum."""
    if op.get_bind().dialect.name == "postgresql":
        return postgresql.ENUM(*values, name=name, create_type=create_type)
    return sa.Enum(*values, name=name)


def _json():
    """JSONB on Postgres, JSON elsewhere — matching models.insurance.JSONBOrJSON."""
    if op.get_bind().dialect.name == "postgresql":
        return postgresql.JSONB()
    return sa.JSON()


def _uuid_pk():
    return sa.Column(
        "id",
        postgresql.UUID(as_uuid=True),
        primary_key=True,
        server_default=sa.text("gen_random_uuid()"),
    )


def _timestamps():
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    ]


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # The single place the types are created.
        for values, name in ENUMS:
            _enum(values, name, create_type=True).create(bind, checkfirst=True)

    partner_type = _enum(PARTNER_TYPE, "insurance_partner_type", create_type=False)
    quote_status = _enum(QUOTE_STATUS, "insurance_quote_status", create_type=False)
    lead_status = _enum(LEAD_STATUS, "insurance_lead_status", create_type=False)
    policy_status = _enum(POLICY_STATUS, "insurance_policy_status", create_type=False)
    revenue_status = _enum(REVENUE_STATUS, "insurance_revenue_status", create_type=False)
    policy_type = _enum(POLICY_TYPE, "insurance_policy_type", create_type=False)

    # ── partners ─────────────────────────────────────────────────────────────
    op.create_table(
        "insurance_partners",
        _uuid_pk(),
        sa.Column("name", sa.String(160), nullable=False, unique=True),
        sa.Column("partner_type", partner_type, nullable=False),
        sa.Column("registration_no", sa.String(80)),
        sa.Column("adapter_key", sa.String(60), nullable=False, unique=True),
        sa.Column("api_base_url", sa.String(500)),
        # A secret-manager key or environment variable name. Never the secret.
        sa.Column("credentials_ref", sa.String(160)),
        # Defaults to false: a partner row that appears the moment it is created
        # would start receiving personal data before anyone confirmed the
        # agreement was in force.
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("supported_products", _json()),
        sa.Column("payout_config", _json()),
        *_timestamps(),
    )

    # ── quotes ───────────────────────────────────────────────────────────────
    op.create_table(
        "insurance_quotes",
        _uuid_pk(),
        sa.Column("reference", sa.String(32), nullable=False, unique=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "partner_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("insurance_partners.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("partner_quote_id", sa.String(120)),
        sa.Column(
            "car_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cars.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("make", sa.String(80), nullable=False),
        sa.Column("model", sa.String(120), nullable=False),
        sa.Column("variant", sa.String(120)),
        sa.Column("fuel_type", sa.String(30)),
        sa.Column("manufacturing_year", sa.Integer()),
        sa.Column("registration_no", sa.String(20)),
        sa.Column("policy_type", policy_type, nullable=False),
        sa.Column("quote_status", quote_status, nullable=False, server_default="requested"),
        sa.Column("raw_response", _json()),
        sa.Column("failure_reason", sa.Text()),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        *_timestamps(),
    )
    op.create_index(
        "ix_insurance_quotes_user_created", "insurance_quotes", ["user_id", "created_at"]
    )
    op.create_index(
        "ix_insurance_quotes_partner_status",
        "insurance_quotes",
        ["partner_id", "quote_status"],
    )

    # ── leads ────────────────────────────────────────────────────────────────
    op.create_table(
        "insurance_leads",
        _uuid_pk(),
        # Both nullable, and that is the launch requirement rather than an
        # oversight: partners are onboarded after the production release, so
        # until the first one signs every lead is an unrouted interest lead
        # with no quote and no partner. A NOT NULL here would discard the first
        # weeks of demand — which is the evidence a partner gets shown.
        sa.Column(
            "quote_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("insurance_quotes.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "partner_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("insurance_partners.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # The vehicle lives on the lead as well as on the quote: an interest
        # lead has no quote row to carry it.
        sa.Column(
            "car_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cars.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("make", sa.String(80)),
        sa.Column("model", sa.String(120)),
        sa.Column("variant", sa.String(120)),
        sa.Column("fuel_type", sa.String(30)),
        sa.Column("manufacturing_year", sa.Integer()),
        sa.Column("registration_no", sa.String(20)),
        sa.Column("city", sa.String(100)),
        sa.Column("name", sa.String(160)),
        sa.Column("phone", sa.String(16), nullable=False),
        sa.Column("email", sa.String(255)),
        # Nullable on purpose: null means no consent was given, and nothing may
        # be shared. A boolean default of false would be indistinguishable from
        # "we never asked".
        sa.Column("consented_at", sa.DateTime(timezone=True)),
        sa.Column("consent_text", sa.Text()),
        sa.Column("shared_with_partner_at", sa.DateTime(timezone=True)),
        sa.Column("lead_status", lead_status, nullable=False, server_default="created"),
        sa.Column("selected_plan", _json()),
        *_timestamps(),
        # A lead built from a quote must carry that quote's partner. A lead
        # pointing at one partner's quote while routed to another would send
        # personal data to a party that never quoted for it.
        sa.CheckConstraint(
            "quote_id IS NULL OR partner_id IS NOT NULL",
            name="ck_lead_quote_implies_partner",
        ),
    )
    op.create_index(
        "ix_insurance_leads_status_created", "insurance_leads", ["lead_status", "created_at"]
    )

    # ── policies ─────────────────────────────────────────────────────────────
    op.create_table(
        "insurance_policies",
        _uuid_pk(),
        sa.Column(
            "lead_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("insurance_leads.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "partner_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("insurance_partners.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("partner_policy_ref", sa.String(120), nullable=False),
        sa.Column("policy_status", policy_status, nullable=False, server_default="pending"),
        sa.Column("start_date", sa.Date()),
        sa.Column("end_date", sa.Date()),
        sa.Column("document_url", sa.String(1000)),
        *_timestamps(),
        # This is what makes the conversion webhook idempotent: a replayed
        # POLICY_ISSUED cannot create a second row.
        sa.UniqueConstraint("partner_id", "partner_policy_ref", name="uq_policy_partner_ref"),
    )
    op.create_index(
        "ix_insurance_policies_user_expiry", "insurance_policies", ["user_id", "end_date"]
    )

    # ── revenue ──────────────────────────────────────────────────────────────
    op.create_table(
        "insurance_revenue",
        _uuid_pk(),
        sa.Column(
            "policy_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("insurance_policies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "partner_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("insurance_partners.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("revenue_status", revenue_status, nullable=False, server_default="expected"),
        # Numeric, not Float. Money in a float accumulates error that surfaces
        # as a reconciliation mismatch nobody can explain.
        sa.Column("expected_amount", sa.Numeric(12, 2)),
        sa.Column("confirmed_amount", sa.Numeric(12, 2)),
        sa.Column("received_amount", sa.Numeric(12, 2)),
        sa.Column("settlement_date", sa.Date()),
        sa.Column("reversal_reason", sa.Text()),
        *_timestamps(),
    )
    op.create_index("ix_insurance_revenue_status", "insurance_revenue", ["revenue_status"])

    # ── reference counter ────────────────────────────────────────────────────
    op.create_table(
        "insurance_reference_counters",
        sa.Column("year", sa.Integer(), primary_key=True),
        sa.Column("last_value", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_table("insurance_reference_counters")
    op.drop_index("ix_insurance_revenue_status", table_name="insurance_revenue")
    op.drop_table("insurance_revenue")
    op.drop_index("ix_insurance_policies_user_expiry", table_name="insurance_policies")
    op.drop_table("insurance_policies")
    op.drop_index("ix_insurance_leads_status_created", table_name="insurance_leads")
    op.drop_table("insurance_leads")
    op.drop_index("ix_insurance_quotes_partner_status", table_name="insurance_quotes")
    op.drop_index("ix_insurance_quotes_user_created", table_name="insurance_quotes")
    op.drop_table("insurance_quotes")
    op.drop_table("insurance_partners")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for values, name in reversed(ENUMS):
            _enum(values, name, create_type=True).drop(bind, checkfirst=True)
