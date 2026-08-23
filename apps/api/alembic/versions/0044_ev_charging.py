"""ev charging: stations, chargers, vehicle profiles, reports

Revision ID: 0044
Revises: 0043
Create Date: 2026-08-23

THE ENUM TRAP, WITH AN EXTRA TURN

`op.create_table` emits CREATE TYPE for every Enum column it sees, so every
reference below passes create_type=False and the types are created once,
explicitly, up front — the same shape as 0041, 0042 and 0043.

This migration has the case that actually bites: `ev_connector_type` is used by
BOTH `chargers` and `vehicle_charging_profiles`, and by two columns of the
latter — three columns across two tables, one type. Miss create_type=False on
any of them and the second CREATE TYPE fails on Postgres, while SQLite, which
has no native enums, accepts the whole thing happily. Only CI's Postgres job
catches it. Verified against a real server: the type is created once and
information_schema reports all three columns using it.
"""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0044"
down_revision = "0043"
branch_labels = None
depends_on = None

CONNECTOR = (
    "type2", "ccs2", "chademo", "type1",
    "bharat_ac_001", "bharat_dc_001", "three_pin", "unknown",
)
CURRENT = ("ac", "dc", "unknown")
CHARGER_STATUS = (
    "available", "occupied", "charging", "reserved",
    "out_of_order", "offline", "unknown",
)
STATION_STATUS = (
    "operational", "temporarily_closed", "permanently_closed", "planned", "unknown",
)

ENUMS = (
    (CONNECTOR, "ev_connector_type"),
    (CURRENT, "ev_current_type"),
    (CHARGER_STATUS, "ev_charger_status"),
    (STATION_STATUS, "charging_station_status"),
)


def _enum(values, name, create_type):
    return postgresql.ENUM(*values, name=name, create_type=create_type)


def _col(values, name, is_pg):
    """The column type: a native enum on Postgres, plain text on SQLite."""
    return _enum(values, name, create_type=False) if is_pg else sa.String(40)


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    if is_pg:
        for values, name in ENUMS:
            _enum(values, name, create_type=True).create(bind, checkfirst=True)

    json_type = postgresql.JSONB if is_pg else sa.JSON

    op.create_table(
        "charging_stations",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True,
            server_default=sa.text("gen_random_uuid()") if is_pg else None,
        ),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("operator_name", sa.String(200), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("city", sa.String(120), nullable=True),
        sa.Column("state", sa.String(120), nullable=True),
        sa.Column("country", sa.String(80), nullable=True, server_default="IN"),
        sa.Column("postcode", sa.String(20), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column(
            "status", _col(STATION_STATUS, "charging_station_status", is_pg),
            nullable=False, server_default="unknown",
        ),
        sa.Column("price_per_kwh", sa.Float(), nullable=True),
        sa.Column("price_note", sa.String(300), nullable=True),
        # Provenance (§26). fetched_at is distinct from source_updated_at: a
        # feed can hand back a record it last verified years ago.
        sa.Column("source", sa.String(60), nullable=False),
        sa.Column("source_station_id", sa.String(120), nullable=False),
        sa.Column("source_url", sa.String(500), nullable=True),
        sa.Column("source_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("data_confidence", sa.Float(), nullable=True),
        sa.Column("raw", json_type(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text("now()"),
        ),
        # The same site appears in several feeds; merging on a name match would
        # collapse two different sites in one retail park.
        sa.UniqueConstraint("source", "source_station_id", name="uq_station_source_ref"),
        sa.CheckConstraint("latitude BETWEEN -90 AND 90", name="ck_station_latitude_range"),
        sa.CheckConstraint("longitude BETWEEN -180 AND 180", name="ck_station_longitude_range"),
    )
    op.create_index(
        "ix_charging_stations_lat_lon", "charging_stations", ["latitude", "longitude"]
    )
    op.create_index("ix_charging_stations_city", "charging_stations", ["city"])

    op.create_table(
        "chargers",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True,
            server_default=sa.text("gen_random_uuid()") if is_pg else None,
        ),
        sa.Column(
            "station_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("charging_stations.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "connector_type", _col(CONNECTOR, "ev_connector_type", is_pg),
            nullable=False, server_default="unknown",
        ),
        sa.Column(
            "current_type", _col(CURRENT, "ev_current_type", is_pg),
            nullable=False, server_default="unknown",
        ),
        sa.Column("power_kw", sa.Float(), nullable=True),
        sa.Column("voltage", sa.Integer(), nullable=True),
        sa.Column("amperage", sa.Integer(), nullable=True),
        sa.Column("total_ports", sa.Integer(), nullable=True),
        sa.Column("available_ports", sa.Integer(), nullable=True),
        sa.Column(
            "status", _col(CHARGER_STATUS, "ev_charger_status", is_pg),
            nullable=False, server_default="unknown",
        ),
        # Without this a stale "available" from a nightly import is
        # indistinguishable from a real-time one — what BR-07 forbids.
        sa.Column(
            "status_is_live", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("status_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text("now()"),
        ),
        # NULL means unknown; 0 would classify as a real (slow) charger.
        sa.CheckConstraint("power_kw IS NULL OR power_kw > 0", name="ck_charger_power_positive"),
    )
    op.create_index("ix_chargers_station", "chargers", ["station_id"])
    op.create_index("ix_chargers_connector", "chargers", ["connector_type"])

    op.create_table(
        "vehicle_charging_profiles",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True,
            server_default=sa.text("gen_random_uuid()") if is_pg else None,
        ),
        sa.Column("make", sa.String(80), nullable=False),
        sa.Column("model", sa.String(120), nullable=False),
        # "" not NULL: NULL is never equal to NULL in a unique index, so a
        # nullable column would allow unlimited duplicate "all variants" rows.
        sa.Column("variant", sa.String(120), nullable=False, server_default=""),
        sa.Column("battery_capacity_kwh", sa.Float(), nullable=True),
        sa.Column("usable_battery_capacity_kwh", sa.Float(), nullable=True),
        sa.Column("ac_connector", _col(CONNECTOR, "ev_connector_type", is_pg), nullable=True),
        sa.Column("max_ac_kw", sa.Float(), nullable=True),
        sa.Column("dc_connector", _col(CONNECTOR, "ev_connector_type", is_pg), nullable=True),
        sa.Column("max_dc_kw", sa.Float(), nullable=True),
        sa.Column("source_note", sa.String(400), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("make", "model", "variant", name="uq_charging_profile_vehicle"),
        sa.CheckConstraint(
            "battery_capacity_kwh IS NULL OR battery_capacity_kwh > 0",
            name="ck_profile_battery_positive",
        ),
        sa.CheckConstraint(
            "usable_battery_capacity_kwh IS NULL OR battery_capacity_kwh IS NULL "
            "OR usable_battery_capacity_kwh <= battery_capacity_kwh",
            name="ck_profile_usable_within_gross",
        ),
    )
    op.create_index(
        "ix_charging_profiles_make_model", "vehicle_charging_profiles", ["make", "model"]
    )

    op.create_table(
        "charging_station_reports",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True,
            server_default=sa.text("gen_random_uuid()") if is_pg else None,
        ),
        sa.Column(
            "station_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("charging_stations.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "reporter_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("issue", sa.String(60), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="user_reported"),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_station_reports_status", "charging_station_reports", ["status", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_station_reports_status", table_name="charging_station_reports")
    op.drop_table("charging_station_reports")
    op.drop_index("ix_charging_profiles_make_model", table_name="vehicle_charging_profiles")
    op.drop_table("vehicle_charging_profiles")
    op.drop_index("ix_chargers_connector", table_name="chargers")
    op.drop_index("ix_chargers_station", table_name="chargers")
    op.drop_table("chargers")
    op.drop_index("ix_charging_stations_city", table_name="charging_stations")
    op.drop_index("ix_charging_stations_lat_lon", table_name="charging_stations")
    op.drop_table("charging_stations")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for values, name in ENUMS:
            _enum(values, name, create_type=False).drop(bind, checkfirst=True)
