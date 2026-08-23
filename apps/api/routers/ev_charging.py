"""
EV charging stations, and whether a given car can use them.

    GET  /ev-charging/stations        public — nearby, with compatibility
    GET  /ev-charging/profiles        public — vehicles we hold charging specs for
    POST /ev-charging/estimate        public — session time for a car and a charger
    POST /ev-charging/report          public — "this station is wrong" (§23)
    GET  /ev-charging/admin/profiles  admin  — every profile
    POST /ev-charging/admin/profiles  admin  — create or update one

WHAT IS NEVER INVENTED HERE

Stations come from a provider or they do not come at all. When no adapter is
configured, /stations returns an empty list and says why — it does not fall
back to a demonstration set. A fabricated charging station is the worst
possible fabrication in this application: it sends someone with a nearly-flat
battery to a place that is not there.

Availability is the same. Open Charge Map has no live occupancy, so every
charger reports `unknown` and the response carries `live_availability: false`.
BR-07 permits live status only where a provider supports it and AC-07 forbids
showing a charger as available when that is not known.
"""
# NOTE: deliberately NOT using `from __future__ import annotations` — PEP 563
# turns annotations into strings and FastAPI reads body params as query params.

import logging
import math
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.dependencies import get_admin_user
from core.limiter import limiter
from db.session import get_db
from models.ev_charging import (
    Charger,
    ChargingStation,
    ChargingStationReport,
    VehicleChargingProfile,
)
from models.ev_charging import (
    ConnectorType as ModelConnector,
)
from models.user import User
from services.ev_charging import (
    ChargerSpec,
    ConnectorType,
    VehicleChargingSpec,
    assess,
    classify,
    describe,
    estimate,
    label,
)
from services.ev_charging.providers import ProviderUnavailable, active_provider

logger = logging.getLogger("gaadiiq.ev_charging")

router = APIRouter(prefix="/ev-charging", tags=["ev-charging"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
AdminUser = Annotated[User, Depends(get_admin_user)]

EARTH_RADIUS_KM = 6371.0


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance. Good to a few metres at city scale, which is plenty."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


# ── Response shapes ──────────────────────────────────────────────────────────


class ChargerOut(BaseModel):
    id: uuid.UUID | None = None
    connector_type: str
    current_type: str
    # BR-03: the actual figure, always, alongside the category — never instead of it.
    power_kw: float | None
    speed_category: str
    speed_label: str
    total_ports: int | None
    status: str
    live_availability: bool
    # Present only when a vehicle was supplied.
    compatibility: str | None = None
    compatibility_message: str | None = None
    expected_max_kw: float | None = None
    vehicle_max_kw: float | None = None


class StationOut(BaseModel):
    id: uuid.UUID | None
    name: str
    operator_name: str | None
    address: str | None
    city: str | None
    latitude: float
    longitude: float
    status: str
    distance_km: float | None
    price_per_kwh: float | None
    chargers: list[ChargerOut]
    # §26 — a station that closed months ago looks like an open one without this.
    source: str
    source_url: str | None
    last_updated: datetime | None
    data_confidence: float | None


class StationsResponse(BaseModel):
    stations: list[StationOut]
    #: False when no adapter is configured. The page says so rather than
    #: rendering an empty map that looks like "no chargers near you".
    provider_configured: bool
    provider: str | None
    #: Always false for Open Charge Map. See the module docstring.
    live_availability: bool
    notice: str | None


def _charger_out(charger: Charger, vehicle: VehicleChargingSpec | None) -> ChargerOut:
    category = classify(charger.power_kw)
    out = ChargerOut(
        id=charger.id,
        connector_type=charger.connector_type.value,
        current_type=charger.current_type.value,
        power_kw=charger.power_kw,
        speed_category=category.value,
        speed_label=label(category),
        total_ports=charger.total_ports,
        status=charger.status.value,
        live_availability=charger.status_is_live,
    )

    if vehicle is None:
        return out

    result = assess(
        vehicle,
        ChargerSpec(
            connector=ConnectorType(charger.connector_type.value),
            power_kw=charger.power_kw,
            is_dc=(charger.current_type.value == "dc") if charger.current_type.value != "unknown" else None,
        ),
    )
    out.compatibility = result.status.value
    out.compatibility_message = result.message
    out.expected_max_kw = result.expected_max_kw
    out.vehicle_max_kw = result.vehicle_max_kw
    return out


async def _vehicle_spec(
    db: AsyncSession, make: str | None, model: str | None, variant: str | None
) -> VehicleChargingSpec | None:
    """
    The charging profile for a car, or None.

    Falls back from an exact variant match to the model-wide row, because
    "Nexon EV 45 Empowered+" and "Nexon EV 45" charge alike and holding a
    profile per trim would be data entry with no benefit.
    """
    if not make or not model:
        return None

    rows = (
        await db.execute(
            select(VehicleChargingProfile).where(
                VehicleChargingProfile.make.ilike(make.strip()),
                VehicleChargingProfile.model.ilike(model.strip()),
            )
        )
    ).scalars().all()
    if not rows:
        return None

    chosen = None
    if variant:
        chosen = next((r for r in rows if r.variant.lower() == variant.strip().lower()), None)
    if chosen is None:
        chosen = next((r for r in rows if not r.variant), rows[0])

    def _conn(value) -> ConnectorType | None:
        return ConnectorType(value.value) if value is not None else None

    return VehicleChargingSpec(
        battery_capacity_kwh=chosen.battery_capacity_kwh,
        usable_battery_capacity_kwh=chosen.usable_battery_capacity_kwh,
        ac_connector=_conn(chosen.ac_connector),
        max_ac_kw=chosen.max_ac_kw,
        dc_connector=_conn(chosen.dc_connector),
        max_dc_kw=chosen.max_dc_kw,
    )


# ── Stations ─────────────────────────────────────────────────────────────────


@router.get("/stations", response_model=StationsResponse)
@limiter.limit("60/minute")
async def nearby_stations(
    request: Request,
    db: DbDep,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(15.0, gt=0, le=100),
    limit: int = Query(50, ge=1, le=200),
    make: str | None = Query(None),
    model: str | None = Query(None),
    variant: str | None = Query(None),
):
    """
    Stations near a point, each charger assessed against the given car.

    Cached rows are served first and the provider is asked only to fill the
    gap. A map pan should not be a third-party round trip, and the provenance
    fields let the page state how old the answer is (§26).
    """
    provider = active_provider()
    vehicle = await _vehicle_spec(db, make, model, variant)

    # A generous bounding box, then an exact distance filter. Cheap on the
    # index and correct at the edges, where a naive box is up to 40% too wide
    # in longitude at Indian latitudes.
    lat_span = radius_km / 111.0
    lon_span = radius_km / (111.0 * max(math.cos(math.radians(lat)), 0.01))

    rows = (
        await db.execute(
            select(ChargingStation)
            .options(selectinload(ChargingStation.chargers))
            .where(
                ChargingStation.latitude.between(lat - lat_span, lat + lat_span),
                ChargingStation.longitude.between(lon - lon_span, lon + lon_span),
            )
            .limit(limit * 3)
        )
    ).scalars().all()

    notice = None
    if not rows and provider is not None:
        # Nothing cached here yet. Ask upstream once, store what comes back, and
        # answer from it — so the next pan over the same area is instant.
        try:
            fetched = await provider.nearby(lat, lon, radius_km, limit)
        except ProviderUnavailable as exc:
            logger.warning("Charging provider unavailable: %s", exc)
            return StationsResponse(
                stations=[], provider_configured=True, provider=provider.name,
                live_availability=False,
                notice=(
                    "We could not reach the charging station directory just now. "
                    "Please try again shortly."
                ),
            )
        rows = await _persist(db, fetched)

    if provider is None and not rows:
        return StationsResponse(
            stations=[], provider_configured=False, provider=None,
            live_availability=False,
            notice=(
                "No charging station directory is connected yet, so we cannot show "
                "stations near you. Nothing here is estimated or filled in."
            ),
        )

    out: list[StationOut] = []
    for station in rows:
        distance = _distance_km(lat, lon, station.latitude, station.longitude)
        if distance > radius_km:
            continue
        out.append(
            StationOut(
                id=station.id,
                name=station.name,
                operator_name=station.operator_name,
                address=station.address,
                city=station.city,
                latitude=station.latitude,
                longitude=station.longitude,
                status=station.status.value,
                distance_km=round(distance, 2),
                price_per_kwh=station.price_per_kwh,
                chargers=[_charger_out(c, vehicle) for c in station.chargers],
                source=station.source,
                source_url=station.source_url,
                last_updated=station.source_updated_at or station.fetched_at,
                data_confidence=station.data_confidence,
            )
        )

    out.sort(key=lambda s: s.distance_km or 0)
    out = out[:limit]

    if vehicle is None and (make or model):
        notice = (
            "We do not hold charging specifications for that car yet, so compatibility "
            "is not shown. Every charger's connector and power rating is still listed."
        )

    return StationsResponse(
        stations=out,
        provider_configured=provider is not None,
        provider=provider.name if provider else None,
        # Open Charge Map carries no live occupancy. Saying otherwise is what
        # AC-07 forbids.
        live_availability=False,
        notice=notice,
    )


async def _persist(db: AsyncSession, fetched: list) -> list[ChargingStation]:
    """Store normalised stations, replacing any earlier copy from the same source."""
    stored: list[ChargingStation] = []
    now = datetime.now(timezone.utc)

    for item in fetched:
        existing = (
            await db.execute(
                select(ChargingStation)
                .options(selectinload(ChargingStation.chargers))
                .where(
                    ChargingStation.source == item.source,
                    ChargingStation.source_station_id == item.source_station_id,
                )
            )
        ).scalar_one_or_none()

        station = existing or ChargingStation(
            source=item.source, source_station_id=item.source_station_id
        )
        station.name = item.name
        station.operator_name = item.operator_name
        station.address = item.address
        station.city = item.city
        station.state = item.state
        station.country = item.country
        station.postcode = item.postcode
        station.latitude = item.latitude
        station.longitude = item.longitude
        station.status = item.status
        station.source_url = item.source_url
        station.source_updated_at = item.source_updated_at
        station.fetched_at = now
        station.data_confidence = item.data_confidence
        station.raw = item.raw

        # Replace rather than merge: the upstream is the authority on what a
        # site has, and a connector removed there should disappear here.
        station.chargers = [
            Charger(
                connector_type=ModelConnector(c.connector_type.value),
                current_type=c.current_type,
                power_kw=c.power_kw,
                voltage=c.voltage,
                amperage=c.amperage,
                total_ports=c.total_ports,
                status=c.status,
                status_is_live=c.status_is_live,
                status_updated_at=now if c.status_is_live else None,
            )
            for c in item.chargers
        ]

        if existing is None:
            db.add(station)
        stored.append(station)

    await db.commit()
    for station in stored:
        await db.refresh(station, attribute_names=["chargers"])
    return stored


# ── Estimate ─────────────────────────────────────────────────────────────────


class EstimateIn(BaseModel):
    usable_capacity_kwh: float = Field(gt=0, le=400)
    from_pct: float = Field(ge=0, le=100)
    to_pct: float = Field(ge=0, le=100)
    charger_kw: float = Field(gt=0, le=1000)
    vehicle_max_kw: float | None = Field(default=None, gt=0, le=1000)
    is_dc: bool = True


class EstimateOut(BaseModel):
    energy_needed_kwh: float
    minutes_low: int
    minutes_high: int
    assumed_kw: float
    includes_taper_zone: bool
    summary: str


@router.post("/estimate", response_model=EstimateOut)
@limiter.limit("60/minute")
async def charging_estimate(request: Request, payload: EstimateIn):
    """
    How long a session will take (§12).

    The power used is min(charger, vehicle) when both are known. Estimating
    from the charger's advertised figure is the misleading-number bug in its
    most damaging form — it yields a specific, confident, far-too-short time.
    """
    power = payload.charger_kw
    if payload.vehicle_max_kw is not None:
        power = min(power, payload.vehicle_max_kw)

    est = estimate(
        usable_capacity_kwh=payload.usable_capacity_kwh,
        from_pct=payload.from_pct,
        to_pct=payload.to_pct,
        power_kw=power,
        is_dc=payload.is_dc,
    )
    if est is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Those figures do not describe a charging session we can estimate.",
        )

    return EstimateOut(
        energy_needed_kwh=est.energy_needed_kwh,
        minutes_low=est.minutes_low,
        minutes_high=est.minutes_high,
        assumed_kw=est.assumed_kw,
        includes_taper_zone=est.includes_taper_zone,
        summary=describe(est),
    )


# ── Vehicle profiles ─────────────────────────────────────────────────────────


class ProfileOut(BaseModel):
    id: uuid.UUID
    make: str
    model: str
    variant: str
    battery_capacity_kwh: float | None
    usable_battery_capacity_kwh: float | None
    ac_connector: str | None
    max_ac_kw: float | None
    dc_connector: str | None
    max_dc_kw: float | None
    source_note: str | None


def _profile_out(p: VehicleChargingProfile) -> ProfileOut:
    return ProfileOut(
        id=p.id, make=p.make, model=p.model, variant=p.variant,
        battery_capacity_kwh=p.battery_capacity_kwh,
        usable_battery_capacity_kwh=p.usable_battery_capacity_kwh,
        ac_connector=p.ac_connector.value if p.ac_connector else None,
        max_ac_kw=p.max_ac_kw,
        dc_connector=p.dc_connector.value if p.dc_connector else None,
        max_dc_kw=p.max_dc_kw,
        source_note=p.source_note,
    )


@router.get("/profiles", response_model=list[ProfileOut])
@limiter.limit("60/minute")
async def list_profiles(request: Request, db: DbDep):
    """Cars we hold charging specifications for — the picker's options."""
    rows = (
        await db.execute(
            select(VehicleChargingProfile).order_by(
                VehicleChargingProfile.make, VehicleChargingProfile.model
            )
        )
    ).scalars().all()
    return [_profile_out(p) for p in rows]


class ProfileIn(BaseModel):
    make: str = Field(min_length=1, max_length=80)
    model: str = Field(min_length=1, max_length=120)
    variant: str = Field(default="", max_length=120)
    battery_capacity_kwh: float | None = Field(default=None, gt=0, le=400)
    usable_battery_capacity_kwh: float | None = Field(default=None, gt=0, le=400)
    ac_connector: str | None = None
    max_ac_kw: float | None = Field(default=None, gt=0, le=100)
    dc_connector: str | None = None
    max_dc_kw: float | None = Field(default=None, gt=0, le=1000)
    source_note: str | None = Field(default=None, max_length=400)


@router.get("/admin/profiles", response_model=list[ProfileOut])
async def admin_list_profiles(db: DbDep, admin: AdminUser):
    rows = (
        await db.execute(
            select(VehicleChargingProfile).order_by(
                VehicleChargingProfile.make, VehicleChargingProfile.model
            )
        )
    ).scalars().all()
    return [_profile_out(p) for p in rows]


@router.post("/admin/profiles", response_model=ProfileOut)
async def upsert_profile(payload: ProfileIn, db: DbDep, admin: AdminUser):
    """
    Create or update one car's charging specification.

    Every figure here feeds a charging-time estimate somebody plans a journey
    around, so the usable capacity is checked against the gross pack — a usable
    figure larger than the battery is a transcription slip, and it would shorten
    every estimate for that car.
    """
    if (
        payload.usable_battery_capacity_kwh is not None
        and payload.battery_capacity_kwh is not None
        and payload.usable_battery_capacity_kwh > payload.battery_capacity_kwh
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Usable capacity cannot exceed the total battery capacity.",
        )

    def _conn(value: str | None):
        if not value:
            return None
        try:
            return ModelConnector(value)
        except ValueError:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown connector '{value}'."
            ) from None

    existing = (
        await db.execute(
            select(VehicleChargingProfile).where(
                VehicleChargingProfile.make == payload.make.strip(),
                VehicleChargingProfile.model == payload.model.strip(),
                VehicleChargingProfile.variant == payload.variant.strip(),
            )
        )
    ).scalar_one_or_none()

    profile = existing or VehicleChargingProfile(
        make=payload.make.strip(),
        model=payload.model.strip(),
        variant=payload.variant.strip(),
    )
    profile.battery_capacity_kwh = payload.battery_capacity_kwh
    profile.usable_battery_capacity_kwh = payload.usable_battery_capacity_kwh
    profile.ac_connector = _conn(payload.ac_connector)
    profile.max_ac_kw = payload.max_ac_kw
    profile.dc_connector = _conn(payload.dc_connector)
    profile.max_dc_kw = payload.max_dc_kw
    profile.source_note = payload.source_note

    if existing is None:
        db.add(profile)
    await db.commit()
    await db.refresh(profile)

    logger.info("Charging profile saved for %s %s by %s", profile.make, profile.model, admin.id)
    return _profile_out(profile)


# ── User reports (§23) ───────────────────────────────────────────────────────


class ReportIn(BaseModel):
    station_id: uuid.UUID
    issue: str = Field(min_length=1, max_length=60)
    detail: str | None = Field(default=None, max_length=2000)


@router.post("/report", status_code=status.HTTP_201_CREATED)
@limiter.limit("10/hour")
async def report_station(request: Request, payload: ReportIn, db: DbDep):
    """
    A driver telling us the data is wrong.

    Unauthenticated on purpose: the person best placed to report a closed
    station is the one standing outside it, and requiring a sign-in at that
    moment loses the report. Rate-limited instead, and nothing is published —
    a report is a queue entry for an admin, not a change to what others see.
    """
    station = await db.get(ChargingStation, payload.station_id)
    if station is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such station.")

    db.add(
        ChargingStationReport(
            station_id=station.id,
            issue=payload.issue.strip()[:60],
            detail=(payload.detail or "").strip()[:2000] or None,
            status="user_reported",
        )
    )
    await db.commit()
    return {"status": "recorded"}
