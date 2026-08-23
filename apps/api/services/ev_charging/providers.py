"""
Where station data comes from, and how it is made uniform.

BRD §19-20. The point of the layer is that the rest of the application never
learns which provider answered. Open Charge Map is the first adapter because it
is open, free and has real Indian coverage today; a government feed or an
operator's OCPI endpoint drops in beside it without the compatibility engine,
the API or the page changing.

WHAT OPEN CHARGE MAP CANNOT TELL US

Live occupancy. OCM records what a site *has*, not what is free right now, and
its "status" field is about whether the equipment is believed operational —
often last confirmed months ago. So every charger from this adapter comes back
`unknown` with `status_is_live=False`, and the page says to ring ahead. BR-07
allows live status only where a provider supports it, and AC-07 forbids showing
a charger as available when it is not known to be. Mapping OCM's
"Operational" onto "Available" would break both, and would do it in the way
that actually hurts: a driver detours to a charger that is occupied.
"""
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Protocol

from models.ev_charging import ChargerStatus, ConnectorType, CurrentType, StationStatus

logger = logging.getLogger("gaadiiq.ev_charging.providers")


class ProviderUnavailable(RuntimeError):
    """The upstream could not be reached or understood. Never means "no stations"."""


@dataclass
class NormalisedCharger:
    connector_type: ConnectorType = ConnectorType.unknown
    current_type: CurrentType = CurrentType.unknown
    power_kw: float | None = None
    voltage: int | None = None
    amperage: int | None = None
    total_ports: int | None = None
    status: ChargerStatus = ChargerStatus.unknown
    status_is_live: bool = False


@dataclass
class NormalisedStation:
    source: str
    source_station_id: str
    name: str
    latitude: float
    longitude: float
    operator_name: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = "IN"
    postcode: str | None = None
    status: StationStatus = StationStatus.unknown
    source_url: str | None = None
    source_updated_at: datetime | None = None
    data_confidence: float | None = None
    raw: dict | None = None
    chargers: list[NormalisedCharger] = field(default_factory=list)


class StationProvider(Protocol):
    """What an adapter must offer. Deliberately small."""

    name: str

    def configured(self) -> bool: ...

    async def nearby(
        self, latitude: float, longitude: float, radius_km: float, limit: int
    ) -> list[NormalisedStation]: ...


# ── Open Charge Map ──────────────────────────────────────────────────────────
#
# OCM's ConnectionType ids. Hardcoded because they are stable identifiers in a
# public reference list, and resolving them at runtime would mean a second
# request per import for data that changes about once a decade.
_OCM_CONNECTION_TYPES: dict[int, tuple[ConnectorType, CurrentType]] = {
    1: (ConnectorType.type1, CurrentType.ac),          # J1772
    2: (ConnectorType.chademo, CurrentType.dc),
    25: (ConnectorType.type2, CurrentType.ac),         # Type 2 socket
    1036: (ConnectorType.type2, CurrentType.ac),       # Type 2 tethered
    32: (ConnectorType.ccs2, CurrentType.dc),          # CCS Type 1 — treated as DC
    33: (ConnectorType.ccs2, CurrentType.dc),          # CCS Type 2
    27: (ConnectorType.three_pin, CurrentType.ac),     # domestic
    28: (ConnectorType.three_pin, CurrentType.ac),
    1041: (ConnectorType.bharat_dc_001, CurrentType.dc),
    1042: (ConnectorType.bharat_ac_001, CurrentType.ac),
}

#: OCM StatusType ids that mean the SITE is not usable. Note what is absent:
#: nothing here maps to "available". OCM's operational flag says the equipment
#: is believed to exist and work, not that a bay is free.
_OCM_STATION_UNUSABLE = {100, 200, 210}  # not operational / planned / removed


def _as_float(value: Any) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if out > 0 else None


def _as_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def normalise_ocm_station(payload: dict) -> NormalisedStation | None:
    """
    One Open Charge Map POI into GAADIIQ's shape.

    Returns None when the record has no usable position — a station without
    coordinates cannot be put on a map or measured for distance, and keeping it
    would only pad the count.

    Everything else degrades field by field. A POI with no connection list
    still yields a station with no chargers, which is honest and lets the UI
    say "charger details not published" rather than dropping a real site.
    """
    if not isinstance(payload, dict):
        return None

    address_info = payload.get("AddressInfo") or {}
    lat = address_info.get("Latitude")
    lon = address_info.get("Longitude")
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None

    source_id = payload.get("ID")
    if source_id is None:
        return None

    operator = (payload.get("OperatorInfo") or {}).get("Title")

    status_info = payload.get("StatusTypeID")
    station_status = StationStatus.unknown
    if status_info in _OCM_STATION_UNUSABLE:
        station_status = StationStatus.temporarily_closed
    elif status_info == 50:  # OCM "Operational"
        # Operational, not open-right-now. The distinction matters enough to
        # keep the station status separate from any charger's availability.
        station_status = StationStatus.operational

    chargers: list[NormalisedCharger] = []
    for conn in payload.get("Connections") or []:
        if not isinstance(conn, dict):
            continue
        connector, current = _OCM_CONNECTION_TYPES.get(
            conn.get("ConnectionTypeID"), (ConnectorType.unknown, CurrentType.unknown)
        )
        # OCM also carries a CurrentTypeID; prefer it when the connector map
        # could not decide, since a connector we do not recognise may still
        # have a known current type.
        if current is CurrentType.unknown:
            current_id = conn.get("CurrentTypeID")
            if current_id in (30,):
                current = CurrentType.dc
            elif current_id in (10, 20):
                current = CurrentType.ac

        chargers.append(
            NormalisedCharger(
                connector_type=connector,
                current_type=current,
                power_kw=_as_float(conn.get("PowerKW")),
                voltage=_as_int(conn.get("Voltage")),
                amperage=_as_int(conn.get("Amps")),
                total_ports=_as_int(conn.get("Quantity")),
                # Always. See the module docstring: OCM has no live occupancy,
                # and a green "Available" we cannot substantiate is the failure
                # AC-07 names.
                status=ChargerStatus.unknown,
                status_is_live=False,
            )
        )

    # How much of the record survived. Surfaced so the UI can be quieter about
    # a sparse entry, and so an operator can see which imports are thin.
    present = sum(
        1
        for value in (
            address_info.get("Title"), operator, address_info.get("AddressLine1"),
            address_info.get("Town"), chargers or None,
        )
        if value
    )
    confidence = round(present / 5, 2)

    updated = payload.get("DateLastStatusUpdate") or payload.get("DateLastVerified")
    source_updated_at = None
    if isinstance(updated, str):
        try:
            source_updated_at = datetime.fromisoformat(updated.replace("Z", "+00:00"))
            if source_updated_at.tzinfo is None:
                source_updated_at = source_updated_at.replace(tzinfo=timezone.utc)
        except ValueError:
            source_updated_at = None

    return NormalisedStation(
        source="openchargemap",
        source_station_id=str(source_id),
        name=(address_info.get("Title") or "Charging station").strip()[:300],
        latitude=float(lat),
        longitude=float(lon),
        operator_name=(operator or None),
        address=", ".join(
            part
            for part in (address_info.get("AddressLine1"), address_info.get("AddressLine2"))
            if part
        )
        or None,
        city=address_info.get("Town") or None,
        state=(address_info.get("StateOrProvince") or None),
        country=((address_info.get("Country") or {}).get("ISOCode") or "IN"),
        postcode=address_info.get("Postcode") or None,
        status=station_status,
        source_url=f"https://openchargemap.org/site/poi/details/{source_id}",
        source_updated_at=source_updated_at,
        data_confidence=confidence,
        raw=payload,
        chargers=chargers,
    )


class OpenChargeMapProvider:
    """
    Open Charge Map.

    Free and open, with genuine Indian coverage. The key is optional for light
    use but rate limits are far kinder with one, and it lives server-side only:
    a key in the browser bundle is public the moment it ships.
    """

    name = "openchargemap"

    def configured(self) -> bool:
        # Deliberately not gated on the key. OCM answers unauthenticated
        # requests, and refusing to work without a key would mean the map is
        # empty in every environment where nobody has set one — including a
        # reviewer's. The key raises the rate limit, it does not unlock it.
        from core.config import settings

        return bool(settings.ocm_api_url)

    async def nearby(
        self, latitude: float, longitude: float, radius_km: float, limit: int
    ) -> list[NormalisedStation]:
        import json
        import urllib.parse

        from core.config import settings

        from ..news_feed import NewsUnavailable, _download

        params = {
            "output": "json",
            "latitude": f"{latitude:.6f}",
            "longitude": f"{longitude:.6f}",
            "distance": f"{radius_km:.1f}",
            "distanceunit": "KM",
            "maxresults": str(max(1, min(int(limit), 200))),
            "compact": "false",
            "verbose": "false",
            # India. Without this a search near a border returns sites the
            # driver cannot reach.
            "countrycode": "IN",
        }
        if settings.ocm_api_key.strip():
            params["key"] = settings.ocm_api_key.strip()

        url = f"{settings.ocm_api_url.rstrip('/')}/poi/?{urllib.parse.urlencode(params)}"

        # Reuses the news feed's hardened fetch: streaming with a size ceiling,
        # https-only, and every redirect hop checked against private address
        # ranges. Written for one third-party feed, but nothing about it is
        # news-specific and a second unaudited download path would be a
        # second place to get SSRF wrong.
        try:
            body = await _download(url)
        except NewsUnavailable as exc:
            raise ProviderUnavailable(f"Open Charge Map unreachable: {exc}") from exc

        try:
            payload = json.loads(body)
        except ValueError as exc:
            raise ProviderUnavailable("Open Charge Map returned invalid JSON") from exc

        if not isinstance(payload, list):
            # OCM returns an object with a message on error rather than a list.
            raise ProviderUnavailable("Open Charge Map returned an unexpected shape")

        out: list[NormalisedStation] = []
        for item in payload:
            station = normalise_ocm_station(item)
            if station is not None:
                out.append(station)

        logger.info(
            "OCM returned %d POIs near %.4f,%.4f (%d usable)",
            len(payload), latitude, longitude, len(out),
        )
        return out


#: Adapters, in preference order. A government feed or an operator's OCPI
#: endpoint is added here and nothing downstream changes.
_PROVIDERS: list[StationProvider] = [OpenChargeMapProvider()]


def active_provider() -> StationProvider | None:
    """The first configured adapter, or None — never a fabricated fallback."""
    for provider in _PROVIDERS:
        if provider.configured():
            return provider
    return None
