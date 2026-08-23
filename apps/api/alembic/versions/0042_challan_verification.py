"""challan verification: verifications, details, rules, audit

Revision ID: 0042
Revises: 0041
Create Date: 2026-08-23

Four tables behind BRD §20. The rules table is the point of the exercise: the
blocking thresholds are rows an administrator edits, not constants in code
(BRD §9, §29).

ON THE ENUM TYPES. Same trap 0040 and 0041 document, restated because it keeps
catching people: `create_table` emits CREATE TYPE for each enum column, so
creating the types up front *and* letting the columns create them kills the
chain on a fresh Postgres with DuplicateObjectError. Every enum column below
passes create_type=False, leaving exactly one place that creates each type.
SQLite ignores all of it, so only CI's "Test on Postgres" job can catch a
mistake here.

NO SEED ROWS. It is tempting to insert the BRD's worked examples (₹5,000, two
challans, seven days) as starting rules. They are not inserted, because a
threshold that appeared without anyone choosing it is indistinguishable from
one that was agreed, and BRD §9 requires these be a business decision. The
engine falls back to those figures when no row exists and says so in
services/challan/rules.py; the fallback is visible in code review, whereas a
seeded row looks like policy.
"""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


VERIFICATION_STATUS = ("pending", "completed", "no_record_found", "failed")
RISK_CATEGORY = ("unknown", "clear", "low", "moderate", "high", "court_review")
LISTING_DECISION = ("verified", "manual_review", "blocked", "verification_pending")
RULE_TYPE = (
    "max_outstanding_amount",
    "max_outstanding_count",
    "serious_offence",
    "court_status",
    "verification_validity_days",
)
RULE_ACTION = ("block", "manual_review", "allow")

ENUMS = [
    (VERIFICATION_STATUS, "challan_verification_status"),
    (RISK_CATEGORY, "challan_risk_category"),
    (LISTING_DECISION, "challan_listing_decision"),
    (RULE_TYPE, "challan_rule_type"),
    (RULE_ACTION, "challan_rule_action"),
]


def _enum(values, name, *, create_type: bool):
    if op.get_bind().dialect.name == "postgresql":
        return postgresql.ENUM(*values, name=name, create_type=create_type)
    return sa.Enum(*values, name=name)


def _json():
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
            "created_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text("now()"),
        ),
    ]


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for values, name in ENUMS:
            _enum(values, name, create_type=True).create(bind, checkfirst=True)

    v_status = _enum(VERIFICATION_STATUS, "challan_verification_status", create_type=False)
    risk = _enum(RISK_CATEGORY, "challan_risk_category", create_type=False)
    decision = _enum(LISTING_DECISION, "challan_listing_decision", create_type=False)
    rule_type = _enum(RULE_TYPE, "challan_rule_type", create_type=False)
    rule_action = _enum(RULE_ACTION, "challan_rule_action", create_type=False)

    # ── verifications ────────────────────────────────────────────────────────
    op.create_table(
        "vehicle_challan_verifications",
        _uuid_pk(),
        # Nullable: the Track Challan page lets somebody check a vehicle they
        # have not listed, and that lookup is still worth recording.
        sa.Column(
            "listing_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("listings.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "seller_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # Normalised form only (FR-02): WB02AB1234, never "WB 02 AB 1234".
        sa.Column("registration_number", sa.String(20), nullable=False),
        sa.Column("provider", sa.String(60)),
        sa.Column("provider_reference_id", sa.String(160)),
        sa.Column("requested_at", sa.DateTime(timezone=True)),
        sa.Column("responded_at", sa.DateTime(timezone=True)),
        sa.Column("verification_status", v_status, nullable=False, server_default="pending"),
        sa.Column("risk_category", risk, nullable=False, server_default="unknown"),
        sa.Column(
            "listing_decision", decision, nullable=False, server_default="verification_pending"
        ),
        sa.Column("total_challan_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("outstanding_challan_count", sa.Integer(), nullable=False, server_default="0"),
        # Numeric, not Float: this figure is compared against a threshold and
        # must not drift a vehicle onto the wrong side of the line.
        sa.Column(
            "total_outstanding_amount", sa.Numeric(12, 2), nullable=False, server_default="0"
        ),
        sa.Column("verified_at", sa.DateTime(timezone=True)),
        sa.Column("verification_expiry_at", sa.DateTime(timezone=True)),
        sa.Column("failure_reason", sa.Text()),
        sa.Column("decision_reason", sa.Text()),
        *_timestamps(),
    )
    op.create_index(
        "ix_challan_verif_reg_created",
        "vehicle_challan_verifications",
        ["registration_number", "created_at"],
    )
    op.create_index(
        "ix_challan_verif_decision", "vehicle_challan_verifications", ["listing_decision"]
    )
    op.create_index("ix_challan_verif_listing", "vehicle_challan_verifications", ["listing_id"])

    # ── details ──────────────────────────────────────────────────────────────
    op.create_table(
        "challan_details",
        _uuid_pk(),
        sa.Column(
            "verification_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vehicle_challan_verifications.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("challan_number", sa.String(80)),
        sa.Column("challan_date", sa.Date()),
        sa.Column("amount", sa.Numeric(12, 2)),
        sa.Column("outstanding_amount", sa.Numeric(12, 2)),
        sa.Column("state", sa.String(10)),
        sa.Column("department", sa.String(120)),
        # Free text as the source sends it — states word these differently and
        # a forced enum would lose the distinction that mattered.
        sa.Column("challan_status", sa.String(80)),
        sa.Column("court_status", sa.String(80)),
        sa.Column("is_court_case", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        *_timestamps(),
    )
    op.create_index("ix_challan_details_verification", "challan_details", ["verification_id"])

    # ── rules ────────────────────────────────────────────────────────────────
    op.create_table(
        "challan_verification_rules",
        _uuid_pk(),
        sa.Column("rule_name", sa.String(120), nullable=False),
        sa.Column("rule_type", rule_type, nullable=False),
        # String because a count, a rupee amount and a day count share this
        # column and do not share a scale.
        sa.Column("configured_value", sa.String(80), nullable=False),
        sa.Column("action", rule_action, nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        # A decision made in March must stay explainable after the threshold
        # changes in April, so rules are superseded rather than edited.
        sa.Column("effective_from", sa.DateTime(timezone=True)),
        sa.Column("effective_to", sa.DateTime(timezone=True)),
        sa.Column("notes", sa.Text()),
        *_timestamps(),
    )
    op.create_index(
        "ix_challan_rules_active_priority",
        "challan_verification_rules",
        ["is_active", "priority"],
    )

    # ── audit ────────────────────────────────────────────────────────────────
    op.create_table(
        "challan_audit_events",
        _uuid_pk(),
        sa.Column(
            "verification_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vehicle_challan_verifications.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "actor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("event", sa.String(60), nullable=False),
        sa.Column("detail", _json()),
        *_timestamps(),
    )
    op.create_index(
        "ix_challan_audit_verification", "challan_audit_events", ["verification_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_challan_audit_verification", table_name="challan_audit_events")
    op.drop_table("challan_audit_events")
    op.drop_index("ix_challan_rules_active_priority", table_name="challan_verification_rules")
    op.drop_table("challan_verification_rules")
    op.drop_index("ix_challan_details_verification", table_name="challan_details")
    op.drop_table("challan_details")
    op.drop_index("ix_challan_verif_listing", table_name="vehicle_challan_verifications")
    op.drop_index("ix_challan_verif_decision", table_name="vehicle_challan_verifications")
    op.drop_index("ix_challan_verif_reg_created", table_name="vehicle_challan_verifications")
    op.drop_table("vehicle_challan_verifications")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for values, name in reversed(ENUMS):
            _enum(values, name, create_type=True).drop(bind, checkfirst=True)
