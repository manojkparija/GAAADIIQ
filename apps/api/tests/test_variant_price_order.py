"""The order a trim ladder is read in.

/cars/{id}/variants ordered by `sort_order, name`. sort_order is whatever the
row was inserted with — the research importer numbers trims in the order it
found them in a brochure, which is neither alphabetical nor priced — so the
Fronx tab listed ₹7.75L, ₹6.84L, ₹7.75L, ₹8.25L, … and the entry-level Sigma
sat third. A buyer scanning for "what does this start at" cannot find it, and
the figure they land on is not the one the page's own header quotes.

Price ascending is the order a trim ladder means something in. The two
properties worth pinning are that it is the price and not the insertion order
that decides, and that a trim with no price yet does not fall to the top of the
list on a NULL.
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
        "make": "Maruti Suzuki", "model": "Fronx", "year": 2026,
        "fuel_type": "petrol", "ex_showroom_price": "930000",
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _add(client, car, name, price):
    resp = await client.post(f"/cars/{car['id']}/variants", json={
        "name": name, **({"ex_showroom_price": str(price)} if price is not None else {}),
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _names(client, car):
    return [v["name"] for v in (await client.get(f"/cars/{car['id']}/variants")).json()]


@pytest.mark.asyncio
async def test_the_cheapest_trim_is_listed_first(client, car):
    # The reported case: Sigma is the entry trim and appeared third.
    await _add(client, car, "Delta MT", 775000)
    await _add(client, car, "Sigma", 684000)
    await _add(client, car, "Alpha AT", 1198000)

    assert (await _names(client, car))[0] == "Sigma"


@pytest.mark.asyncio
async def test_the_whole_ladder_ascends(client, car):
    for name, price in [
        ("Delta MT", 775000), ("Sigma", 684000), ("Zeta", 970000),
        ("Alpha AT", 1198000), ("Delta Plus", 815000),
    ]:
        await _add(client, car, name, price)

    # float, not the string the API serialises: "970000.00" sorts before
    # "684000.00" lexicographically, which would pass on any order at all.
    prices = [float(v["ex_showroom_price"]) for v in
              (await client.get(f"/cars/{car['id']}/variants")).json()]

    assert prices == sorted(prices)


@pytest.mark.asyncio
async def test_price_decides_it_not_the_order_they_were_entered(client, car):
    # Every trim here carries sort_order 0, so an ordering that still leaned on
    # insertion order would hand back the order they were posted in.
    await _add(client, car, "Costly", 1198000)
    await _add(client, car, "Cheap", 684000)

    assert await _names(client, car) == ["Cheap", "Costly"]


@pytest.mark.asyncio
async def test_an_unpriced_trim_does_not_lead_the_list(client, car):
    """A NULL sorts first by default in Postgres' DESC and in SQLite's ASC.

    Either way an admin who adds a trim before its price is announced would
    push it to the top of a ladder that is meant to open with the cheapest —
    and the card above the tab would still quote the real entry price, so the
    two would disagree.
    """
    await _add(client, car, "Sigma", 684000)
    await _add(client, car, "Unannounced", None)

    assert await _names(client, car) == ["Sigma", "Unannounced"]


@pytest.mark.asyncio
async def test_two_trims_at_the_same_price_keep_a_stable_order(client, car):
    # Fronx really does have two pairs at one price (Delta and Delta MT both at
    # ₹7.75L). Ties fall through to sort_order then name rather than to
    # whatever the database felt like, so the page does not reshuffle on reload.
    await _add(client, car, "Delta MT", 775000)
    await _add(client, car, "Delta", 775000)

    first = await _names(client, car)
    second = await _names(client, car)

    assert first == second
    assert set(first) == {"Delta", "Delta MT"}


@pytest.mark.asyncio
async def test_drafts_are_ordered_the_same_way_for_the_admin_screen(client, car):
    # include_drafts=true is the admin's view of the same ladder; a different
    # order there means the admin cannot check the page a buyer sees.
    await _add(client, car, "Delta MT", 775000)
    await _add(client, car, "Sigma", 684000)

    body = (await client.get(
        f"/cars/{car['id']}/variants", params={"include_drafts": "true"})).json()

    assert [v["name"] for v in body][:2] == ["Sigma", "Delta MT"]
