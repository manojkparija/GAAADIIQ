"""Roadside dispatch: broadcast offers and an arrival OTP.

Adds the two pieces the Uber-shaped flow needs on top of the existing roadside
tables:

  service_request_offers   one row per (request, mechanic) that was broadcast to
  service_requests.*       the start OTP, and what the broadcast did

The offers table carries a UNIQUE index on (request_id, mechanic_id). That is
not tidiness — it is the thing that makes "first mechanic to accept wins" a
database guarantee rather than a hope about request timing. Acceptance is a
conditional UPDATE against status='open'; the unique index stops a re-dispatch
from ever creating the second offer row that would let one mechanic accept
twice.

The OTP columns hold a hash, never the code. `start_otp_attempts` defaults to 0
and is NOT NULL so the brute-force counter cannot begin life as NULL and make
`attempts >= limit` quietly false forever.

Revision ID: 0031
Revises: 0030
"""
import sqlalchemy as sa

from alembic import op

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "service_request_offers",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "request_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("service_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "mechanic_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("mechanics.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "offered", "accepted", "declined", "expired", "lost",
                name="service_offer_status",
            ),
            nullable=False,
            server_default="offered",
        ),
        sa.Column("distance_km", sa.Float(), nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True)),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
    )
    op.create_index("ix_service_request_offers_request_id", "service_request_offers", ["request_id"])
    op.create_index("ix_service_request_offers_mechanic_id", "service_request_offers", ["mechanic_id"])
    op.create_index("ix_service_request_offers_status", "service_request_offers", ["status"])
    op.create_index(
        "uq_service_offer_request_mechanic",
        "service_request_offers",
        ["request_id", "mechanic_id"],
        unique=True,
    )
    op.create_index(
        "ix_service_offers_mechanic_status", "service_request_offers", ["mechanic_id", "status"]
    )

    # Idempotent, matching 0028–0030: production has been built from hand-run
    # SQL before, so a column may already exist without alembic knowing.
    for ddl in (
        "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS start_otp_hash VARCHAR(64)",
        "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS start_otp_issued_at TIMESTAMPTZ",
        "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS start_otp_attempts INTEGER "
        "DEFAULT 0 NOT NULL",
        "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS start_otp_verified_at TIMESTAMPTZ",
        "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ",
        "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS dispatch_radius_km DOUBLE PRECISION",
        "ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS dispatch_offer_count INTEGER "
        "DEFAULT 0 NOT NULL",
    ):
        op.execute(ddl)


def downgrade() -> None:
    for column in (
        "dispatch_offer_count",
        "dispatch_radius_km",
        "dispatched_at",
        "start_otp_verified_at",
        "start_otp_attempts",
        "start_otp_issued_at",
        "start_otp_hash",
    ):
        op.execute(f"ALTER TABLE service_requests DROP COLUMN IF EXISTS {column}")

    op.drop_table("service_request_offers")
    op.execute("DROP TYPE IF EXISTS service_offer_status")
