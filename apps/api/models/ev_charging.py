"""
Charging stations, their chargers, and what each car can accept.

BRD §21. Three tables and one principle running through all of them: a field we
do not know is NULL and stays NULL. Charging data is the kind a driver acts on
with a nearly-flat battery, so a plausible-looking default is worse than a gap —
the UI can say "not known" but it cannot un-strand someone.

WHY STATIONS ARE STORED AT ALL RATHER THAN PROXIED LIVE

Open Charge Map is rate-limited and occasionally slow, and a map pan should not
be a third-party round trip. Records are cached here with their source and
fetch time (§26) so the page can say how old the answer is. `last_updated_at`
is therefore load-bearing, not decoration: a station that closed six months ago
looks exactly like one that is open, unless the age is on screen.
"""
import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base, TimestampMixin, UUIDMixin

# JSONB on Postgres, plain JSON elsewhere. Defined once in models.challan and
# reused rather than re-declared: the suite runs on both engines, and a bare
# JSONB column renders fine in a migration (which branches on dialect) while
# failing every SQLite test that builds tables from the metadata.
from .challan import JSONBOrJSON


class ConnectorType(str, enum.Enum):
    """Mirrors services.ev_charging.compatibility.ConnectorType."""

    type2 = "type2"
    ccs2 = "ccs2"
    chademo = "chademo"
    type1 = "type1"
    bharat_ac_001 = "bharat_ac_001"
    bharat_dc_001 = "bharat_dc_001"
    three_pin = "three_pin"
    unknown = "unknown"


class CurrentType(str, enum.Enum):
    ac = "ac"
    dc = "dc"
    unknown = "unknown"


class ChargerStatus(str, enum.Enum):
    """
    BRD §18, mapped onto OCPI's vocabulary.

    `unknown` is the default and, for now, the only value most rows will ever
    hold. Open Charge Map does not carry reliable live occupancy, and BR-07 is
    explicit that live status may only be shown when a provider supports it —
    so a row says `unknown` rather than `available`, and the page says to ring
    ahead. Showing a green tick we cannot substantiate is the failure AC-07
    names directly.
    """

    available = "available"
    occupied = "occupied"
    charging = "charging"
    reserved = "reserved"
    out_of_order = "out_of_order"
    offline = "offline"
    unknown = "unknown"


class StationStatus(str, enum.Enum):
    operational = "operational"
    temporarily_closed = "temporarily_closed"
    permanently_closed = "permanently_closed"
    planned = "planned"
    unknown = "unknown"


class ChargingStation(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "charging_stations"
    __table_args__ = (
        # One row per station per source. The same site appears in several
        # feeds, and merging them on a name match would collapse two genuinely
        # different sites in the same retail park.
        UniqueConstraint("source", "source_station_id", name="uq_station_source_ref"),
        # The nearby query: a bounding box on lat/lon.
        Index("ix_charging_stations_lat_lon", "latitude", "longitude"),
        Index("ix_charging_stations_city", "city"),
        CheckConstraint("latitude BETWEEN -90 AND 90", name="ck_station_latitude_range"),
        CheckConstraint("longitude BETWEEN -180 AND 180", name="ck_station_longitude_range"),
    )

    name: Mapped[str] = mapped_column(String(300), nullable=False)
    operator_name: Mapped[str | None] = mapped_column(String(200))

    address: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(String(120))
    state: Mapped[str | None] = mapped_column(String(120))
    country: Mapped[str | None] = mapped_column(String(80), default="IN")
    postcode: Mapped[str | None] = mapped_column(String(20))

    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)

    status: Mapped[StationStatus] = mapped_column(
        Enum(StationStatus, name="charging_station_status", native_enum=True),
        default=StationStatus.unknown,
        nullable=False,
    )

    #: Per kWh where the provider carries it. Usually absent — Indian tariffs
    #: vary by operator, time of day and connector, and a stale price is a
    #: complaint at the till.
    price_per_kwh: Mapped[float | None] = mapped_column(Float)
    price_note: Mapped[str | None] = mapped_column(String(300))

    # ── Provenance (§26) ─────────────────────────────────────────────────────
    source: Mapped[str] = mapped_column(String(60), nullable=False)
    source_station_id: Mapped[str] = mapped_column(String(120), nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(500))
    #: When the upstream record was last touched, as the upstream reports it —
    #: distinct from when we fetched it. A feed can hand back a record it last
    #: verified in 2021.
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: 0-1. How much of the record survived normalisation intact.
    data_confidence: Mapped[float | None] = mapped_column(Float)

    #: The provider's original payload, kept so a normalisation bug can be
    #: diagnosed and re-run without re-fetching everything.
    raw: Mapped[dict | None] = mapped_column(JSONBOrJSON)

    chargers: Mapped[list["Charger"]] = relationship(
        back_populates="station", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<ChargingStation {self.name!r} {self.latitude},{self.longitude}>"


class Charger(UUIDMixin, TimestampMixin, Base):
    """
    One connector at a station.

    A station is not a charger. §8's worked example has four at one site — 7.2
    and 22 kW AC, 60 and 120 kW DC — and a driver whose car takes CCS2 cares
    about exactly two of them. Collapsing a site to its best number is how "120
    kW station" ends up in front of somebody who can only use the 7.2 kW post.
    """

    __tablename__ = "chargers"
    __table_args__ = (
        Index("ix_chargers_station", "station_id"),
        Index("ix_chargers_connector", "connector_type"),
        CheckConstraint("power_kw IS NULL OR power_kw > 0", name="ck_charger_power_positive"),
    )

    station_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("charging_stations.id", ondelete="CASCADE"), nullable=False
    )

    connector_type: Mapped[ConnectorType] = mapped_column(
        Enum(ConnectorType, name="ev_connector_type", native_enum=True),
        default=ConnectorType.unknown,
        nullable=False,
    )
    current_type: Mapped[CurrentType] = mapped_column(
        Enum(CurrentType, name="ev_current_type", native_enum=True),
        default=CurrentType.unknown,
        nullable=False,
    )
    #: NULL when the feed omitted it. Never 0 — the check constraint refuses
    #: that, because 0 kW would classify as a real (slow) charger.
    power_kw: Mapped[float | None] = mapped_column(Float)
    voltage: Mapped[int | None] = mapped_column(Integer)
    amperage: Mapped[int | None] = mapped_column(Integer)

    total_ports: Mapped[int | None] = mapped_column(Integer)
    available_ports: Mapped[int | None] = mapped_column(Integer)

    status: Mapped[ChargerStatus] = mapped_column(
        Enum(ChargerStatus, name="ev_charger_status", native_enum=True),
        default=ChargerStatus.unknown,
        nullable=False,
    )
    #: True only when the status came from a live feed this minute. Without
    #: this a stale `available` from a nightly import is indistinguishable from
    #: a real-time one — which is exactly what BR-07 forbids.
    status_is_live: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    station: Mapped["ChargingStation"] = relationship(back_populates="chargers")

    def __repr__(self) -> str:
        return f"<Charger {self.connector_type.value} {self.power_kw}kW>"


class VehicleChargingProfile(UUIDMixin, TimestampMixin, Base):
    """
    What one model of car can accept (§5).

    Entered by an admin from the manufacturer's brochure, not inferred. Every
    figure here feeds a charging-time estimate somebody plans a journey around,
    so `source_note` records where it came from and nothing arrives by guess.

    Keyed by make/model/variant text rather than a FK to `cars`: the catalogue
    is rebuilt by ingestion and its ids are not stable, whereas a profile
    should outlive a re-import. The lookup is deliberately forgiving on
    variant, since "Nexon EV 45 Empowered+" and "Nexon EV 45" charge alike.
    """

    __tablename__ = "vehicle_charging_profiles"
    __table_args__ = (
        UniqueConstraint("make", "model", "variant", name="uq_charging_profile_vehicle"),
        Index("ix_charging_profiles_make_model", "make", "model"),
        CheckConstraint(
            "battery_capacity_kwh IS NULL OR battery_capacity_kwh > 0",
            name="ck_profile_battery_positive",
        ),
        CheckConstraint(
            "usable_battery_capacity_kwh IS NULL OR battery_capacity_kwh IS NULL "
            "OR usable_battery_capacity_kwh <= battery_capacity_kwh",
            name="ck_profile_usable_within_gross",
        ),
    )

    make: Mapped[str] = mapped_column(String(80), nullable=False)
    model: Mapped[str] = mapped_column(String(120), nullable=False)
    #: "" rather than NULL for the catch-all row: NULL is not equal to NULL in
    #: a unique index, so a nullable column here would permit any number of
    #: duplicate "all variants" profiles for one model.
    variant: Mapped[str] = mapped_column(String(120), default="", nullable=False)

    battery_capacity_kwh: Mapped[float | None] = mapped_column(Float)
    #: The figure estimates use. Cars hold back a buffer at both ends, so the
    #: headline pack size overstates the energy a session actually moves.
    usable_battery_capacity_kwh: Mapped[float | None] = mapped_column(Float)

    ac_connector: Mapped[ConnectorType | None] = mapped_column(
        Enum(ConnectorType, name="ev_connector_type", native_enum=True, create_type=False)
    )
    max_ac_kw: Mapped[float | None] = mapped_column(Float)

    dc_connector: Mapped[ConnectorType | None] = mapped_column(
        Enum(ConnectorType, name="ev_connector_type", native_enum=True, create_type=False)
    )
    max_dc_kw: Mapped[float | None] = mapped_column(Float)

    #: Where these numbers came from — a brochure, a press kit, a spec page.
    #: Not optional in spirit: a figure with no provenance cannot be checked
    #: when a driver reports that it is wrong.
    source_note: Mapped[str | None] = mapped_column(String(400))

    def __repr__(self) -> str:
        return f"<VehicleChargingProfile {self.make} {self.model} {self.variant}>"


class ChargingStationReport(UUIDMixin, TimestampMixin, Base):
    """
    A driver telling us the data is wrong (§23).

    Worth having early: aggregated feeds go stale in exactly the ways a person
    standing at the site notices first, and a station that has closed is the
    single most costly error this feature can make.
    """

    __tablename__ = "charging_station_reports"
    __table_args__ = (Index("ix_station_reports_status", "status", "created_at"),)

    station_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("charging_stations.id", ondelete="CASCADE"), nullable=False
    )
    reporter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    issue: Mapped[str] = mapped_column(String(60), nullable=False)
    detail: Mapped[str | None] = mapped_column(Text)
    #: user_reported → pending_verification → verified | rejected (§23)
    status: Mapped[str] = mapped_column(String(30), default="user_reported", nullable=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_note: Mapped[str | None] = mapped_column(Text)
