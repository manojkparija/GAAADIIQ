"""
A car's response names every gearbox its trims are sold with.

Reported: on New Cars, ticking Body Type = Hatchback and Transmission =
Automatic showed nothing, though the S-Presso has an automatic trim.

The grid filters on `cars.transmission` — one value on the catalogue row,
"Manual" for the S-Presso — because that was the only transmission the API
told it about. The automatic lives on a trim in car_variants, which a listing
card never fetches. So a model that does offer an automatic was filtered out,
and a filtered-out model is indistinguishable from one that does not exist.

Same shape as the price band already in _variant_summaries: the card holds one
catalogue row, cannot reach that row's trims, and so answers from a single
hand-maintained field that does not match what is on offer.

Published trims only, as with the count and the band: a draft is a figure
nobody has read, and offering a buyer a gearbox on the strength of one would
promise a choice that is not on sale.
"""
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.dependencies import get_admin_user, get_current_user
from db.session import get_db
from main import app
from models.user import User


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


@pytest_asyncio.fixture
async def car(client) -> dict:
    resp = await client.post("/cars", json={
        "make": "Maruti Suzuki", "model": "S-Presso", "year": 2026,
        "fuel_type": "petrol", "transmission": "manual",
        "ex_showroom_price": "530000",
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _add(client, car_id, **kwargs):
    payload = {"name": "VXi", "ex_showroom_price": "549000", **kwargs}
    resp = await client.post(f"/cars/{car_id}/variants", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_lists_a_gearbox_the_catalogue_row_does_not_carry(client, car):
    # Exactly the reported case: the row says Manual, a trim says Automatic.
    await _add(client, car["id"], name="VXi", transmission="Manual")
    await _add(client, car["id"], name="VXi AGS", transmission="Automatic")

    body = (await client.get(f"/cars/{car['id']}")).json()

    assert sorted(body["variant_transmissions"]) == ["Automatic", "Manual"], (
        "the grid can only offer a gearbox the API mentions"
    )


@pytest.mark.asyncio
async def test_the_listing_endpoint_carries_it_too(client, car):
    # The grid reads the list endpoint, not the single-car one. Filling only
    # the latter would leave the reported bug exactly as it was.
    await _add(client, car["id"], name="VXi AGS", transmission="Automatic")

    items = (await client.get("/cars?make=maruti")).json()["items"]
    row = next(c for c in items if c["id"] == car["id"])

    assert row["variant_transmissions"] == ["Automatic"]


@pytest.mark.asyncio
async def test_each_gearbox_is_named_once(client, car):
    # Eight trims share three gearboxes; the filter wants the set.
    for name in ("Std", "LXi", "VXi"):
        await _add(client, car["id"], name=name, transmission="Manual")
    await _add(client, car["id"], name="VXi AGS", transmission="Automatic")

    body = (await client.get(f"/cars/{car['id']}")).json()

    assert sorted(body["variant_transmissions"]) == ["Automatic", "Manual"]


@pytest.mark.asyncio
async def test_fuels_come_back_the_same_way(client, car):
    # The fuel filter has the identical defect: a CNG trim on a row recorded
    # as Petrol is invisible to it.
    await _add(client, car["id"], name="VXi", fuel_type="Petrol")
    await _add(client, car["id"], name="VXi CNG", fuel_type="CNG")

    body = (await client.get(f"/cars/{car['id']}")).json()

    assert sorted(body["variant_fuels"]) == ["CNG", "Petrol"]


@pytest.mark.asyncio
async def test_a_draft_gearbox_is_not_offered(client, car):
    # A draft is a figure nobody has read. Offering its gearbox would promise
    # a buyer a choice that is not on sale — the same rule the count and the
    # price band already follow.
    await _add(client, car["id"], name="VXi", transmission="Manual")
    # POST always publishes — an admin typing a price has already done the
    # checking review exists to force — so a draft is reached by PATCH. Only
    # AI research creates one directly.
    auto = await _add(client, car["id"], name="VXi AGS", transmission="Automatic")
    resp = await client.patch(
        f"/cars/{car['id']}/variants/{auto['id']}", json={"status": "draft"})
    assert resp.status_code == 200, resp.text

    body = (await client.get(f"/cars/{car['id']}")).json()

    assert body["variant_transmissions"] == ["Manual"]


@pytest.mark.asyncio
async def test_a_car_with_no_trims_reports_no_gearboxes(client, car):
    # Empty, not absent: the grid falls back to the catalogue row's own value,
    # and a missing key would be a TypeError in the browser instead.
    body = (await client.get(f"/cars/{car['id']}")).json()

    assert body["variant_transmissions"] == []
    assert body["variant_fuels"] == []


@pytest.mark.asyncio
async def test_a_trim_with_no_gearbox_recorded_is_skipped(client, car):
    # transmission is nullable, and "" is not a gearbox anyone can filter on.
    await _add(client, car["id"], name="Std")
    await _add(client, car["id"], name="VXi AGS", transmission="Automatic")

    body = (await client.get(f"/cars/{car['id']}")).json()

    assert body["variant_transmissions"] == ["Automatic"]
