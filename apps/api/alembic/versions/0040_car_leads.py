"""car_leads: new-car enquiries routed to dealers by city

Revision ID: 0040
Revises: 0039
Create Date: 2026-08-22

Why a new table rather than columns on car_enquiries: that table's RLS grants
reads through car_listings.seller_id -> sellers, which is meaningless for a
catalogue model. A lead captured against a Fronx would be visible to no dealer
at all. See models/car_lead.py.

ON THE ENUM TYPES — this bit was got wrong once and the failure is worth
recording. Creating them up front with checkfirst is not sufficient on its own:
`create_table` also emits CREATE TYPE for each enum column, so the chain died
on a fresh database with

    DuplicateObjectError: type "lead_source" already exists

The columns must therefore be told not to create the type (`create_type=False`,
a postgresql-dialect option), leaving exactly one place that does. SQLite has
no enum types and ignores all of this, so the SQLite suite is green either way
— this is only reachable by running the chain against Postgres, which is what
CI's "Test on Postgres" job does and what caught it here.
"""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None


SOURCE_VALUES = ("offers_cta", "car_detail", "variants")
STATUS_VALUES = ("new", "contacted", "qualified", "won", "lost")


def _enum(values, name, *, create_type: bool):
    """Postgres gets a real enum type; anything else gets a plain Enum."""
    if op.get_bind().dialect.name == "postgresql":
        return postgresql.ENUM(*values, name=name, create_type=create_type)
    return sa.Enum(*values, name=name)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # The single place the types are created.
        _enum(SOURCE_VALUES, "lead_source", create_type=True).create(bind, checkfirst=True)
        _enum(STATUS_VALUES, "lead_status", create_type=True).create(bind, checkfirst=True)

    lead_source = _enum(SOURCE_VALUES, "lead_source", create_type=False)
    lead_status = _enum(STATUS_VALUES, "lead_status", create_type=False)

    op.create_table(
        "car_leads",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        # SET NULL, not CASCADE: a model can be delisted while its leads are
        # still being worked, and deleting the buyer's request along with the
        # catalogue row would be the wrong side of that trade.
        sa.Column(
            "car_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("cars.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("make", sa.String(80), nullable=False),
        sa.Column("model", sa.String(120), nullable=False),
        sa.Column("variant", sa.String(120)),
        sa.Column("city", sa.String(100), nullable=False),
        sa.Column("locality", sa.String(160)),
        sa.Column("pincode", sa.String(10)),
        sa.Column("phone", sa.String(16), nullable=False),
        sa.Column(
            "phone_verified", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("name", sa.String(160)),
        sa.Column("email", sa.String(255)),
        sa.Column("consented_at", sa.DateTime(timezone=True)),
        sa.Column("source", lead_source, nullable=False, server_default="offers_cta"),
        sa.Column("status", lead_status, nullable=False, server_default="new"),
        sa.Column(
            "assigned_dealer_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("dealers.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("notes", sa.Text()),
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
    )

    # "My city, newest first" is the dealer inbox query.
    op.create_index("ix_car_leads_city_created", "car_leads", ["city", "created_at"])
    op.create_index("ix_car_leads_make_model", "car_leads", ["make", "model"])


def downgrade() -> None:
    op.drop_index("ix_car_leads_make_model", table_name="car_leads")
    op.drop_index("ix_car_leads_city_created", table_name="car_leads")
    op.drop_table("car_leads")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        _enum(STATUS_VALUES, "lead_status", create_type=True).drop(bind, checkfirst=True)
        _enum(SOURCE_VALUES, "lead_source", create_type=True).drop(bind, checkfirst=True)
