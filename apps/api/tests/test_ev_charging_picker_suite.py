"""
The EV picker offers the cars we can name, not only the ones we have specs for.

## What was reported

A screenshot of /ev-charging with the "Your electric car" dropdown open,
containing two rows and nothing else:

    Not selected — show all chargers
    My car is not listed — enter its figures

with the note "EV is already listed, why are they not there?"

Both halves of that are true, and they are about different tables. The EVs are
in `cars`. The picker was built from `vehicle_charging_profiles`, which
migration 0044 creates and seeds nothing into, and which nobody had entered a
row in. So every electric car in the catalogue was invisible to the one page
that exists to ask which one you drive.

## What these tests pin

**A catalogue EV reaches the picker.** That is the reported bug.

**It reaches it with null figures, not invented ones.** The catalogue has no
battery or charge-rate columns to derive them from — `cars.specs` is free-form
label/value JSON — and `VehicleChargingProfile.source_note` exists so a figure
can be checked when a driver reports it wrong. Filling the gap with a plausible
number would produce a charging time somebody plans a journey around.

**A profile wins over the catalogue row for the same car**, case-insensitively,
so entering one on the admin screen upgrades that car rather than duplicating
it. The case rule is not fussiness: catalogue rows and hand-typed profiles
disagree about capitalisation constantly.

**Selecting a car with no profile still works.** /stations answers that case
with a notice the code already carried and could never reach, because no such
car could be selected.
"""
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from db.session import get_db
from main import app
from models.car import Car, FuelType
from models.ev_charging import ConnectorType, VehicleChargingProfile


@pytest_asyncio.fixture
async def client(db_engine):
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


@pytest_asyncio.fixture
async def seed(db_engine):
    """A catalogue with EVs and a petrol car, and no profiles unless a test adds one."""
    factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)

    async def _add(*rows):
        async with factory() as session:
            for row in rows:
                session.add(row)
            await session.commit()

    return _add


def _car(make: str, model: str, fuel: FuelType, year: int = 2026) -> Car:
    return Car(make=make, model=model, year=year, fuel_type=fuel)


@pytest.mark.asyncio
async def test_a_catalogue_ev_appears_in_the_picker(client, seed):
    """THE REPORTED BUG.

    Before this, the response was [] whenever the profile table was empty —
    which it was, and is, in production.
    """
    await seed(_car("Tata", "Nexon EV", FuelType.electric))

    rows = (await client.get("/ev-charging/profiles")).json()

    assert [(r["make"], r["model"]) for r in rows] == [("Tata", "Nexon EV")]


@pytest.mark.asyncio
async def test_it_arrives_with_no_figures_rather_than_guessed_ones(client, seed):
    """The catalogue has nothing to derive charging figures from.

    A plausible usable-kWh is a wrong charging time for someone planning a
    journey, and source_note exists so a figure can be checked when it is
    disputed. Null is the honest value until somebody enters one.
    """
    await seed(_car("Tata", "Nexon EV", FuelType.electric))

    row = (await client.get("/ev-charging/profiles")).json()[0]

    assert row["usable_battery_capacity_kwh"] is None
    assert row["battery_capacity_kwh"] is None
    assert row["max_dc_kw"] is None and row["max_ac_kw"] is None
    assert row["dc_connector"] is None and row["ac_connector"] is None
    assert row["source_note"] is None


@pytest.mark.asyncio
async def test_a_petrol_car_is_not_offered(client, seed):
    # The question this dropdown asks is "which electric car do you drive".
    await seed(
        _car("Tata", "Nexon EV", FuelType.electric),
        _car("Maruti Suzuki", "Swift", FuelType.petrol),
        _car("Toyota", "Innova", FuelType.hybrid),
    )

    models = {r["model"] for r in (await client.get("/ev-charging/profiles")).json()}

    assert models == {"Nexon EV"}


@pytest.mark.asyncio
async def test_a_profile_replaces_the_catalogue_row_for_the_same_car(client, seed):
    """Entering a profile must upgrade a car, not duplicate it."""
    await seed(
        _car("Tata", "Nexon EV", FuelType.electric),
        VehicleChargingProfile(
            make="Tata", model="Nexon EV", variant="",
            usable_battery_capacity_kwh=40.5,
            dc_connector=ConnectorType.ccs2, max_dc_kw=50,
            source_note="Manufacturer brochure",
        ),
    )

    rows = (await client.get("/ev-charging/profiles")).json()

    assert len(rows) == 1
    assert rows[0]["usable_battery_capacity_kwh"] == 40.5
    assert rows[0]["source_note"] == "Manufacturer brochure"


@pytest.mark.asyncio
async def test_capitalisation_does_not_produce_a_duplicate(client, seed):
    """Catalogue rows and hand-typed profiles disagree about case constantly.

    "TATA" in the catalogue against "Tata" on the admin screen would show the
    same car twice — once with figures and once without — and the driver has
    no way to tell which to pick.
    """
    await seed(
        _car("TATA", "NEXON EV", FuelType.electric),
        VehicleChargingProfile(
            make="Tata", model="Nexon ev", variant="", max_dc_kw=50,
        ),
    )

    rows = (await client.get("/ev-charging/profiles")).json()

    assert len(rows) == 1, f"the same car twice: {[(r['make'], r['model']) for r in rows]}"
    assert rows[0]["max_dc_kw"] == 50


@pytest.mark.asyncio
async def test_one_row_per_model_not_per_year(client, seed):
    # The picker asks which car you drive. A 2024 and a 2026 Nexon EV charge
    # alike, and two identical-looking rows is a choice with no answer.
    await seed(
        _car("Tata", "Nexon EV", FuelType.electric, year=2024),
        _car("Tata", "Nexon EV", FuelType.electric, year=2026),
    )

    rows = (await client.get("/ev-charging/profiles")).json()

    assert len(rows) == 1


@pytest.mark.asyncio
async def test_profiles_come_before_catalogue_only_cars(client, seed):
    # The cars we can actually assess are the useful ones, so they lead.
    await seed(
        _car("Zzz Motors", "Unprofiled", FuelType.electric),
        VehicleChargingProfile(make="Aaa Motors", model="Profiled", variant=""),
    )

    rows = (await client.get("/ev-charging/profiles")).json()

    assert [r["model"] for r in rows] == ["Profiled", "Unprofiled"]


@pytest.mark.asyncio
async def test_an_empty_catalogue_is_an_empty_list_not_an_error(client):
    resp = await client.get("/ev-charging/profiles")
    assert resp.status_code == 200 and resp.json() == []


@pytest.mark.asyncio
async def test_choosing_a_car_with_no_profile_says_so_and_still_lists_chargers(
    client, seed, monkeypatch
):
    """The notice that existed and could never be reached.

    /stations has always carried this message for a car it holds no spec for.
    Until the picker could offer such a car, no request could produce it.

    A stub provider rather than the real one, and not only to avoid the
    network: when a provider is missing or unreachable, that notice REPLACES
    this one — an outage is the more urgent thing to say — so the message
    under test only appears on the path where stations actually come back.
    """
    from services.ev_charging.providers import NormalisedCharger, NormalisedStation

    class _Stub:
        name = "stub"
        may_store = False
        live_availability = False

        def configured(self):
            return True

        async def nearby(self, lat, lon, radius_km, limit):
            return [
                NormalisedStation(
                    source="stub",
                    source_station_id="s1",
                    name="Salt Lake DC",
                    latitude=22.5726,
                    longitude=88.4574,
                    chargers=[
                        NormalisedCharger(
                            connector_type=ConnectorType.ccs2, power_kw=60
                        )
                    ],
                )
            ]

    monkeypatch.setattr("routers.ev_charging.active_provider", lambda: _Stub())
    await seed(_car("Tata", "Nexon EV", FuelType.electric))

    body = (await client.get(
        "/ev-charging/stations?lat=22.5726&lon=88.4574&radius_km=15"
        "&make=Tata&model=Nexon%20EV"
    )).json()

    assert "do not hold charging specifications" in (body["notice"] or "")

    # Not an error, and not an empty page: the charger is still described, with
    # its connector and power. Compatibility is the only thing withheld.
    assert len(body["stations"]) == 1
    charger = body["stations"][0]["chargers"][0]
    assert charger["connector_type"] == "ccs2" and charger["power_kw"] == 60
    assert charger["compatibility"] is None
