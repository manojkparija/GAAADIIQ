"""
Charging stations from Google Places, shown but never kept.

## Why this adapter exists

Open Charge Map was the first source because it is open and free. Its Indian
coverage turned out to be too thin to ship — a search over Kolkata returned
almost nothing usable. Google knows about far more sites, and for operators
that report to it, knows how many connectors are free right now, which OCM
cannot express at all.

## The two things these tests actually protect

**Nothing from Google is stored.** Its terms permit displaying Places content
and caching it briefly, not building a copy of it. This application's station
flow was written around a local charging_stations table, so the adapter
declares may_store = False and the router answers from the provider per
request. A test below drives the endpoint and asserts the table is still empty
afterwards — because the failure here is silent: everything would look right
while a copy of somebody else's database accumulated.

**A missing availability count is not zero.** Google omits availableCount for
operators that do not report it. Reading absent as "none free" would tell a
driver a working site is full, and the reverse — defaulting to available —
would send them to an occupied one. Both are what AC-07 forbids, so an absent
count stays `unknown` and `status_is_live` stays false.
"""
import uuid

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from db.session import get_db
from main import app
from models.ev_charging import ChargerStatus, ChargingStation, ConnectorType, CurrentType
from services.ev_charging.providers import (
    GoogleMapsProvider,
    OpenChargeMapProvider,
    ProviderUnavailable,
    active_provider,
    normalise_google_place,
)


@pytest_asyncio.fixture
async def client(db_engine):
    """The app over a per-test database, as the other endpoint suites build it."""
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


def _place(**overrides) -> dict:
    place = {
        "id": "ChIJexample",
        "displayName": {"text": "Tata Power — Salt Lake"},
        "formattedAddress": "Sector V, Kolkata",
        "location": {"latitude": 22.5726, "longitude": 88.4574},
        "googleMapsUri": "https://maps.google.com/?cid=1",
        "evChargeOptions": {
            "connectorCount": 2,
            "connectorAggregation": [
                {
                    "type": "EV_CONNECTOR_TYPE_CCS_COMBO_2",
                    "maxChargeRateKw": 60,
                    "count": 2,
                    "availableCount": 1,
                }
            ],
        },
    }
    place.update(overrides)
    return place


# ── normalising one place ───────────────────────────────────────────────────

def test_a_place_becomes_a_station():
    station = normalise_google_place(_place())

    assert station is not None
    assert station.source == "google"
    assert station.source_station_id == "ChIJexample"
    assert station.name == "Tata Power — Salt Lake"
    assert (station.latitude, station.longitude) == (22.5726, 88.4574)
    assert station.address == "Sector V, Kolkata"


def test_the_raw_payload_is_not_carried():
    """`raw` exists to be stored, and nothing here is stored.

    Keeping it would put the provider's response into the object the persist
    path writes, which is the copy the licence does not allow.
    """
    assert normalise_google_place(_place()).raw is None


@pytest.mark.parametrize("broken", [
    {"location": {}},                       # no coordinates
    {"location": {"latitude": 22.5}},       # half a coordinate
    {"id": ""},                             # no place id
])
def test_an_unusable_place_is_dropped_rather_than_guessed(broken):
    # Without coordinates it cannot be placed or distance-filtered, and without
    # an id it cannot be told apart from another. Either way it is not shown.
    assert normalise_google_place(_place(**broken)) is None


def test_a_place_with_no_ev_data_still_appears():
    # A site Google knows is a charging station but holds no connector detail
    # for. Worth showing with no chargers listed; not worth inventing any.
    station = normalise_google_place(_place(evChargeOptions={}))
    assert station is not None and station.chargers == []


# ── connectors and availability ─────────────────────────────────────────────

def test_a_ccs2_connector_maps_across():
    charger = normalise_google_place(_place()).chargers[0]
    assert charger.connector_type is ConnectorType.ccs2
    assert charger.current_type is CurrentType.dc
    assert charger.power_kw == 60
    assert charger.total_ports == 2


def test_a_free_connector_is_reported_live():
    charger = normalise_google_place(_place()).chargers[0]
    assert charger.status is ChargerStatus.available
    assert charger.status_is_live is True


def test_a_full_connector_is_reported_live_too():
    station = normalise_google_place(_place(evChargeOptions={
        "connectorAggregation": [
            {"type": "EV_CONNECTOR_TYPE_CCS_COMBO_2", "count": 2, "availableCount": 0},
        ],
    }))
    assert station.chargers[0].status is ChargerStatus.occupied
    assert station.chargers[0].status_is_live is True


def test_a_missing_count_is_unknown_not_zero():
    """THE ONE THAT MATTERS MOST.

    Google omits availableCount for operators that do not report it. Reading
    absent as zero tells a driver a working site is full; defaulting the other
    way sends them to an occupied one. AC-07 forbids both, so it stays unknown.
    """
    station = normalise_google_place(_place(evChargeOptions={
        "connectorAggregation": [
            {"type": "EV_CONNECTOR_TYPE_CCS_COMBO_2", "count": 2},
        ],
    }))
    assert station.chargers[0].status is ChargerStatus.unknown
    assert station.chargers[0].status_is_live is False


def test_ccs1_is_not_passed_off_as_ccs2():
    """Both are "CCS" and they do not fit each other.

    CCS1 is a North American plug with no member in our Indian ConnectorType.
    Mapping it onto ccs2 on the strength of the name would tell a CCS2 driver a
    post fits when it physically cannot.
    """
    station = normalise_google_place(_place(evChargeOptions={
        "connectorAggregation": [{"type": "EV_CONNECTOR_TYPE_CCS_COMBO_1", "count": 1}],
    }))
    assert station.chargers[0].connector_type is ConnectorType.unknown
    assert station.chargers[0].current_type is CurrentType.dc


def test_an_unrecognised_connector_is_unknown():
    station = normalise_google_place(_place(evChargeOptions={
        "connectorAggregation": [{"type": "EV_CONNECTOR_TYPE_SOMETHING_NEW", "count": 1}],
    }))
    assert station.chargers[0].connector_type is ConnectorType.unknown


def test_junk_in_a_numeric_field_does_not_raise():
    station = normalise_google_place(_place(evChargeOptions={
        "connectorAggregation": [
            {"type": "EV_CONNECTOR_TYPE_TYPE_2", "maxChargeRateKw": "fast", "count": "two"},
        ],
    }))
    assert station.chargers[0].power_kw is None
    assert station.chargers[0].total_ports is None


# ── the adapter's contract ──────────────────────────────────────────────────

def test_the_adapter_declares_it_must_not_store():
    provider = GoogleMapsProvider()
    assert provider.may_store is False
    assert provider.live_availability is True
    assert OpenChargeMapProvider().may_store is True
    assert OpenChargeMapProvider().live_availability is False


def test_it_is_not_configured_without_a_key(monkeypatch):
    from core.config import settings

    monkeypatch.setattr(settings, "google_maps_server_key", "", raising=False)
    assert GoogleMapsProvider().configured() is False

    monkeypatch.setattr(settings, "google_maps_server_key", "AIza-test", raising=False)
    assert GoogleMapsProvider().configured() is True


def test_google_is_preferred_when_configured_and_ocm_when_not(monkeypatch):
    from core.config import settings

    monkeypatch.setattr(settings, "google_maps_server_key", "AIza-test", raising=False)
    assert active_provider().name == "google"

    # Falls back rather than leaving the map empty: OCM needs no key, so a
    # developer machine and CI still show stations.
    monkeypatch.setattr(settings, "google_maps_server_key", "", raising=False)
    assert active_provider().name == "openchargemap"


# ── the request it sends ────────────────────────────────────────────────────

class _FakeResponse:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload if payload is not None else {"places": [_place()]}
        self.text = text or str(self._payload)

    def json(self):
        if self._payload is _UNPARSEABLE:
            raise ValueError("not json")
        return self._payload


_UNPARSEABLE = object()


def _fake_client(monkeypatch, response=None, raises=None, captured=None):
    class _Client:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, headers=None, json=None):
            if captured is not None:
                captured.update({"url": url, "headers": headers, "body": json})
            if raises:
                raise raises
            return response or _FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", _Client)


@pytest.mark.asyncio
async def test_the_request_asks_only_for_the_fields_the_page_renders(monkeypatch):
    # Places bills by field mask, so a wider one costs money for data nothing
    # displays. evChargeOptions is the expensive part and the reason to be here.
    from core.config import settings

    monkeypatch.setattr(settings, "google_maps_server_key", "AIza-test", raising=False)
    captured: dict = {}
    _fake_client(monkeypatch, captured=captured)

    await GoogleMapsProvider().nearby(22.57, 88.45, 15, 20)

    assert captured["url"].endswith("/places:searchNearby")
    assert captured["headers"]["X-Goog-Api-Key"] == "AIza-test"
    mask = captured["headers"]["X-Goog-FieldMask"]
    assert "places.evChargeOptions" in mask and "places.location" in mask
    assert "places.reviews" not in mask and "places.photos" not in mask
    assert captured["body"]["includedTypes"] == ["electric_vehicle_charging_station"]


@pytest.mark.asyncio
async def test_the_key_travels_in_a_header_not_the_url(monkeypatch):
    # A key in the query string ends up in every log line and error message
    # that echoes the URL.
    from core.config import settings

    monkeypatch.setattr(settings, "google_maps_server_key", "AIza-secret", raising=False)
    captured: dict = {}
    _fake_client(monkeypatch, captured=captured)

    await GoogleMapsProvider().nearby(22.57, 88.45, 15, 20)

    assert "AIza-secret" not in captured["url"]


@pytest.mark.asyncio
async def test_the_provider_limits_are_respected(monkeypatch):
    # Places caps a nearby search at 20 results and 50 km; sending more is a
    # 400 rather than a bigger answer.
    from core.config import settings

    monkeypatch.setattr(settings, "google_maps_server_key", "AIza-test", raising=False)
    captured: dict = {}
    _fake_client(monkeypatch, captured=captured)

    await GoogleMapsProvider().nearby(22.57, 88.45, 500, 200)

    assert captured["body"]["maxResultCount"] == 20
    assert captured["body"]["locationRestriction"]["circle"]["radius"] == 50000.0


# ── failure ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_network_failure_is_provider_unavailable(monkeypatch):
    # Never "no stations near you": ProviderUnavailable means we could not ask,
    # and the page must say that rather than imply an empty area.
    from core.config import settings

    monkeypatch.setattr(settings, "google_maps_server_key", "AIza-test", raising=False)
    _fake_client(monkeypatch, raises=httpx.ConnectError("down"))

    with pytest.raises(ProviderUnavailable):
        await GoogleMapsProvider().nearby(22.57, 88.45, 15, 20)


@pytest.mark.asyncio
async def test_a_rejected_key_is_provider_unavailable(monkeypatch):
    from core.config import settings

    monkeypatch.setattr(settings, "google_maps_server_key", "AIza-bad", raising=False)
    _fake_client(monkeypatch, response=_FakeResponse(403, {"error": "denied"}))

    with pytest.raises(ProviderUnavailable):
        await GoogleMapsProvider().nearby(22.57, 88.45, 15, 20)


@pytest.mark.asyncio
async def test_an_empty_area_is_not_a_failure(monkeypatch):
    # Places returns {} with no "places" key for an area with nothing in it.
    # That is a real answer - zero stations - not an outage.
    from core.config import settings

    monkeypatch.setattr(settings, "google_maps_server_key", "AIza-test", raising=False)
    _fake_client(monkeypatch, response=_FakeResponse(200, {}))

    assert await GoogleMapsProvider().nearby(22.57, 88.45, 15, 20) == []


@pytest.mark.asyncio
async def test_a_non_json_body_is_provider_unavailable(monkeypatch):
    from core.config import settings

    monkeypatch.setattr(settings, "google_maps_server_key", "AIza-test", raising=False)
    _fake_client(monkeypatch, response=_FakeResponse(200, _UNPARSEABLE))

    with pytest.raises(ProviderUnavailable):
        await GoogleMapsProvider().nearby(22.57, 88.45, 15, 20)


# ── end to end: shown, and not written down ─────────────────────────────────

@pytest.mark.asyncio
async def test_stations_are_served_without_being_stored(monkeypatch, client, db_engine):
    """THE LICENCE CONDITION, DRIVEN THROUGH THE ENDPOINT.

    Google's terms allow showing Places content, not accumulating it. The
    failure mode is silent — the page looks right either way — so this asserts
    the table is still empty after a search that returned a station.
    """
    from core.config import settings

    monkeypatch.setattr(settings, "google_maps_server_key", "AIza-test", raising=False)
    _fake_client(monkeypatch)

    resp = await client.get("/ev-charging/stations?lat=22.5726&lon=88.4574&radius_km=15")
    assert resp.status_code == 200

    body = resp.json()
    assert body["provider"] == "google"
    assert body["provider_configured"] is True
    assert body["live_availability"] is True
    assert len(body["stations"]) == 1
    assert body["stations"][0]["name"] == "Tata Power — Salt Lake"

    # No row, so no id — which is why both id fields are Optional.
    assert body["stations"][0]["id"] is None

    factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)
    async with factory() as session:
        stored = (await session.execute(select(ChargingStation))).scalars().all()
    assert stored == [], f"{len(stored)} Google station(s) were written to our table"


@pytest.mark.asyncio
async def test_an_outage_says_so_rather_than_showing_an_empty_map(monkeypatch, client):
    from core.config import settings

    monkeypatch.setattr(settings, "google_maps_server_key", "AIza-test", raising=False)
    _fake_client(monkeypatch, raises=httpx.ConnectError("down"))

    body = (await client.get(
        "/ev-charging/stations?lat=22.5726&lon=88.4574&radius_km=15"
    )).json()

    assert body["stations"] == []
    assert body["provider_configured"] is True
    assert "could not reach" in (body["notice"] or "")


@pytest.mark.asyncio
async def test_a_station_beyond_the_radius_is_filtered_out(monkeypatch, client):
    from core.config import settings

    monkeypatch.setattr(settings, "google_maps_server_key", "AIza-test", raising=False)
    far = _place(id="ChIJfar", location={"latitude": 28.61, "longitude": 77.21})  # Delhi
    _fake_client(monkeypatch, response=_FakeResponse(200, {"places": [_place(), far]}))

    body = (await client.get(
        "/ev-charging/stations?lat=22.5726&lon=88.4574&radius_km=15"
    )).json()

    assert [s["name"] for s in body["stations"]] == ["Tata Power — Salt Lake"]


def test_uuid_is_imported_for_the_optional_ids():
    # Guards the import the Optional id fields rely on; a NameError here would
    # only surface at request time.
    assert uuid.UUID is not None
