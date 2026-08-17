"""listing_views and search_events

Instrumentation for the demand-side features: activity metrics, days-turn,
demand heatmaps and inventory-gap analysis. All four are questions about time
and about searches that found nothing, and neither can be recovered from
`listings.views_count`, which is a bare integer with no history.

Written to be safe on a database that already drifted from the migration
chain — everything is IF NOT EXISTS, because the marketplace tables were
created by hand-run SQL files rather than by Alembic and the two are not in
step. See docs/ENGINEERING_BACKLOG.md.

Revision ID: 0037
Revises: 0036
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    # UUID on Postgres, CHAR(36) on SQLite — CI runs on SQLite, which has no
    # native UUID and would otherwise accept the column and then compare it as
    # text at query time.
    uuid_type = postgresql.UUID(as_uuid=True) if is_pg else sa.String(36)

    inspector = sa.inspect(bind)
    existing = set(inspector.get_table_names())

    if "listing_views" not in existing:
        op.create_table(
            "listing_views",
            sa.Column("id", uuid_type, primary_key=True),
            sa.Column("listing_id", uuid_type, nullable=False),
            sa.Column("user_id", uuid_type, nullable=True),
            sa.Column("visitor_key", sa.String(64), nullable=True),
            sa.Column(
                "viewed_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            # No FK to listings when the parent was created outside Alembic and
            # may not carry the type this expects. The application always writes
            # a real listing id; a constraint that fails to create would abort
            # the whole migration for a guarantee we can enforce in the query.
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        )
        op.create_index(
            "ix_listing_views_listing_time", "listing_views", ["listing_id", "viewed_at"]
        )
        op.create_index(
            "ix_listing_views_user_time", "listing_views", ["user_id", "viewed_at"]
        )

    if "search_events" not in existing:
        op.create_table(
            "search_events",
            sa.Column("id", uuid_type, primary_key=True),
            sa.Column("user_id", uuid_type, nullable=True),
            sa.Column("visitor_key", sa.String(64), nullable=True),
            sa.Column("query_text", sa.String(120), nullable=True),
            sa.Column("make", sa.String(60), nullable=True),
            sa.Column("model", sa.String(60), nullable=True),
            sa.Column("body_type", sa.String(40), nullable=True),
            sa.Column("fuel_type", sa.String(30), nullable=True),
            sa.Column("city", sa.String(100), nullable=True),
            sa.Column("pincode", sa.String(10), nullable=True),
            sa.Column("price_min", sa.Integer(), nullable=True),
            sa.Column("price_max", sa.Integer(), nullable=True),
            sa.Column("result_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column(
                "searched_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        )
        op.create_index("ix_search_events_time", "search_events", ["searched_at"])
        op.create_index(
            "ix_search_events_city_time", "search_events", ["city", "searched_at"]
        )
        op.create_index(
            "ix_search_events_model_time", "search_events", ["make", "model", "searched_at"]
        )


def downgrade() -> None:
    op.drop_table("search_events")
    op.drop_table("listing_views")
