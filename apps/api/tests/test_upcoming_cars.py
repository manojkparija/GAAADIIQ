"""
The Upcoming Cars strip shows cars that are actually still upcoming.

Reported with a screenshot of the strip: four of its five entries were already
on sale. It was a hardcoded array in the Angular component, with the expected
date as free text ("Q3 2026") and nothing that ever removed an entry — so a car
stayed under "Upcoming" after it launched, and correcting that needed a deploy.

Two things retire a car, because one is not enough:

- the expected date passes, which needs a DATE rather than a quarter string:
  "Q3 2026" cannot be compared with today, which is precisely how a launched
  car stayed on the strip;
- an admin marks it launched, for the ordinary case where a car arrives before
  its announced window closes. The Tata Sierra EV was on sale with a month
  still to run on its own "Q3 2026".

The filter lives in the API rather than the page: it is the same question for
every caller, and a page that has to remember to apply it will one day forget.
"""
import uuid
from datetime import date, timedelta

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.dependencies import get_admin_user, get_current_user
from db.session import get_db
from main import app
from models.user import User

TOMORROW = date.today() + timedelta(days=1)
NEXT_YEAR = date.today() + timedelta(days=365)
YESTERDAY = date.today() - timedelta(days=1)


@pytest_asyncio.fixture
async def client(db_engine):
    factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)

    async def override_db():
        async with factory() as session:
            yield session
            await session.commit()

    admin = User(id=uuid.uuid4(), email="admin@test.com", hashed_password="x")
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_admin_user] = lambda: admin
    app.dependency_overrides[get_current_user] = lambda: admin
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def _add(client, **kwargs):
    payload = {
        "make": "Tata", "model": "Sierra EV",
        "expected_on": str(NEXT_YEAR),
        **kwargs,
    }
    resp = await client.post("/upcoming-cars", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_an_announced_car_is_listed(client):
    await _add(client)

    body = (await client.get("/upcoming-cars")).json()

    assert [c["model"] for c in body] == ["Sierra EV"]


@pytest.mark.asyncio
async def test_a_car_whose_date_has_passed_drops_off(client):
    # The Toyota Urban Cruiser case: "Q2 2026" long gone, still on the strip,
    # because nothing ever compared it with today.
    await _add(client, model="Urban Cruiser", expected_on=str(YESTERDAY))

    assert (await client.get("/upcoming-cars")).json() == []


@pytest.mark.asyncio
async def test_a_car_expected_today_is_still_upcoming(client):
    # The boundary belongs on the inclusive side: a car announced for today has
    # not missed its date, and dropping it a day early is the same falsehood in
    # the other direction.
    await _add(client, expected_on=str(date.today()))

    assert len((await client.get("/upcoming-cars")).json()) == 1


@pytest.mark.asyncio
async def test_marking_one_launched_takes_it_off_the_strip(client):
    # The case a date cannot cover: on sale before its own window closes.
    car = await _add(client)

    resp = await client.patch(f"/upcoming-cars/{car['id']}", json={"launched": True})
    assert resp.status_code == 200, resp.text
    assert resp.json()["launched_at"] is not None

    assert (await client.get("/upcoming-cars")).json() == []


@pytest.mark.asyncio
async def test_a_launch_can_be_undone(client):
    # Marked launched by mistake. Without this the only way back is the
    # database.
    car = await _add(client)
    await client.patch(f"/upcoming-cars/{car['id']}", json={"launched": True})

    resp = await client.patch(f"/upcoming-cars/{car['id']}", json={"launched": False})

    assert resp.json()["launched_at"] is None
    assert len((await client.get("/upcoming-cars")).json()) == 1


@pytest.mark.asyncio
async def test_deactivating_hides_it_without_claiming_it_launched(client):
    # An announcement that came to nothing is not a launch, and recording it as
    # one would be a claim nobody made.
    car = await _add(client)

    await client.patch(f"/upcoming-cars/{car['id']}", json={"is_active": False})

    assert (await client.get("/upcoming-cars")).json() == []


@pytest.mark.asyncio
async def test_an_admin_can_see_everything(client):
    # The admin screen has to show what it is managing, including the retired
    # rows — otherwise a launch marked by mistake is invisible to the person
    # who has to undo it.
    launched = await _add(client)
    await client.patch(f"/upcoming-cars/{launched['id']}", json={"launched": True})
    await _add(client, model="XEV 7e")

    body = (await client.get("/upcoming-cars?include_past=true")).json()

    assert len(body) == 2


@pytest.mark.asyncio
async def test_the_quarter_is_derived_from_the_date(client):
    # Shown as a quarter because that is how the industry announces, but stored
    # as a date so it can be compared. A stored string cannot be.
    car = await _add(client, expected_on="2026-08-15")

    assert car["expected_quarter"] == "Q3 2026"


@pytest.mark.asyncio
async def test_every_quarter_boundary(client):
    for day, label in [
        ("2027-01-01", "Q1 2027"), ("2027-03-31", "Q1 2027"),
        ("2027-04-01", "Q2 2027"), ("2027-06-30", "Q2 2027"),
        ("2027-07-01", "Q3 2027"), ("2027-09-30", "Q3 2027"),
        ("2027-10-01", "Q4 2027"), ("2027-12-31", "Q4 2027"),
    ]:
        car = await _add(client, expected_on=day)
        assert car["expected_quarter"] == label, day


@pytest.mark.asyncio
async def test_soonest_first(client):
    await _add(client, model="Later", expected_on=str(NEXT_YEAR))
    await _add(client, model="Sooner", expected_on=str(TOMORROW))

    body = (await client.get("/upcoming-cars")).json()

    assert [c["model"] for c in body] == ["Sooner", "Later"]


@pytest.mark.asyncio
async def test_a_price_is_optional(client):
    # An announcement routinely names a car and a quarter and no price.
    # Inventing one would put a figure on the page nobody stated.
    car = await _add(client)

    assert car["expected_price_min"] is None
    assert car["expected_price_max"] is None


@pytest.mark.asyncio
async def test_a_blank_model_is_rejected(client):
    resp = await client.post("/upcoming-cars", json={
        "make": "Tata", "model": "   ", "expected_on": str(NEXT_YEAR),
    })

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_deleting_removes_it(client):
    car = await _add(client)

    resp = await client.delete(f"/upcoming-cars/{car['id']}")

    assert resp.status_code == 204
    assert (await client.get("/upcoming-cars?include_past=true")).json() == []


@pytest.mark.asyncio
async def test_a_missing_car_is_a_404(client):
    missing = uuid.uuid4()

    assert (await client.patch(f"/upcoming-cars/{missing}", json={})).status_code == 404
    assert (await client.delete(f"/upcoming-cars/{missing}")).status_code == 404
