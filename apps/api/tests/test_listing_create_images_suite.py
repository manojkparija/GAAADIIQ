"""
A listing keeps the photographs it was created with.

## What was reported

The first advert this flow ever produced, live on /used-cars:

    2010 Maruti Suzuki Ritz VXi — ₹1.1L — 95,000 km — Kolkata
    [ No Image Available ]

The photograph was not missing. It had been uploaded to the storage bucket
and approved in Image Review, and it was visible on the admin screen the
whole time.

`create_listing` set `image_urls=[]` unconditionally, so the only way a
listing could ever carry a picture was POST /listings/{id}/images — which
takes raw file bytes. The sell form has no bytes by then: it uploads to the
bucket first and holds public URLs. There was no route from one to the other.

## The part worth being careful about

Accepting URLs from a client and rendering them on a public card is how an
arbitrary remote image — or a tracking pixel — ends up on a page attributed to
this site. So the field is filtered to storage we control, and the tests below
spend more effort on what is REJECTED than on what is kept.

Dropped rather than refused: the listing is the thing being created, and
failing the whole advert over one odd URL loses the advert too.
"""
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.dependencies import get_current_user
from db.session import get_db
from main import app
from models.car import Car, FuelType
from models.user import User, UserRole

GOOD = "https://abcdefg.supabase.co/storage/v1/object/public/car-images/ritz-front.jpg"
GOOD_2 = "https://abcdefg.supabase.co/storage/v1/object/public/car-images/ritz-rear.jpg"


@pytest_asyncio.fixture
async def seller(db_engine):
    factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)
    row = User(id=uuid.uuid4(), email="seller@test", role=UserRole.seller)
    async with factory() as session:
        session.add(row)
        await session.commit()
    return row


@pytest_asyncio.fixture
async def car(db_engine):
    factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)
    row = Car(id=uuid.uuid4(), make="Maruti Suzuki", model="Ritz", year=2010,
              fuel_type=FuelType.petrol)
    async with factory() as session:
        session.add(row)
        await session.commit()
    return row


@pytest_asyncio.fixture
async def client(db_engine, seller):
    factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = lambda: seller
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


def _payload(car, **over):
    body = {
        "car_id": str(car.id),
        "listing_type": "used",
        "price": 110000,
        "km_driven": 95000,
        "city": "Kolkata",
        "condition": "good",
    }
    body.update(over)
    return body


# ── the reported gap ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_listing_keeps_the_photographs_it_was_created_with(client, car):
    """THE REPORTED BUG. Before this, image_urls was forced to [] here."""
    resp = await client.post("/listings", json=_payload(car, image_urls=[GOOD, GOOD_2]))

    assert resp.status_code == 201, resp.text
    assert resp.json()["image_urls"] == [GOOD, GOOD_2]


@pytest.mark.asyncio
async def test_the_photographs_survive_the_read_the_grid_uses(client, car):
    # The write's echo is not what /used-cars renders. It reads the list.
    await client.post("/listings", json=_payload(car, image_urls=[GOOD]))

    rows = (await client.get("/listings?listing_type=used")).json()["items"]

    assert len(rows) == 1
    assert rows[0]["image_urls"] == [GOOD]


@pytest.mark.asyncio
async def test_a_listing_with_no_photographs_is_still_created(client, car):
    # Omitted entirely, as every existing caller does. Adding this field must
    # not make it required.
    resp = await client.post("/listings", json=_payload(car))

    assert resp.status_code == 201
    assert resp.json()["image_urls"] == []


# ── what must not get through ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_an_outside_host_is_dropped(client, car):
    """THE ONE THAT MATTERS MOST.

    This value is rendered as an <img> on a public card. A caller that can put
    any URL here can put a chosen image, or a tracking pixel, on a page that
    looks like ours.
    """
    resp = await client.post(
        "/listings",
        json=_payload(car, image_urls=["https://evil.example.com/pixel.gif", GOOD]),
    )

    assert resp.status_code == 201
    assert resp.json()["image_urls"] == [GOOD]


@pytest.mark.asyncio
async def test_a_lookalike_host_is_dropped(client, car):
    # Suffix matching is the easy thing to get wrong: "supabase.co.evil.com"
    # ends with neither, but "evilsupabase.co" would pass a naive `in` check.
    resp = await client.post(
        "/listings",
        json=_payload(car, image_urls=[
            "https://supabase.co.evil.com/x.jpg",
            "https://evil.com/?u=abcdefg.supabase.co",
        ]),
    )

    assert resp.json()["image_urls"] == []


@pytest.mark.asyncio
async def test_credentials_in_the_authority_do_not_smuggle_a_host(client, car):
    # https://abcdefg.supabase.co@evil.com/x.jpg is fetched from evil.com; the
    # part before the @ is userinfo, not the host. Splitting on '/' alone and
    # reading the first token would accept it.
    resp = await client.post(
        "/listings",
        json=_payload(car, image_urls=["https://abcdefg.supabase.co@evil.com/x.jpg"]),
    )

    assert resp.json()["image_urls"] == []


@pytest.mark.asyncio
async def test_plain_http_is_dropped(client, car):
    # A listing card on an https page must not pull an image over http.
    resp = await client.post(
        "/listings",
        json=_payload(car, image_urls=["http://abcdefg.supabase.co/x.jpg"]),
    )

    assert resp.json()["image_urls"] == []


@pytest.mark.asyncio
async def test_a_javascript_url_is_dropped(client, car):
    resp = await client.post(
        "/listings", json=_payload(car, image_urls=["javascript:alert(1)"]),
    )

    assert resp.json()["image_urls"] == []


@pytest.mark.asyncio
async def test_the_list_is_capped(client, car):
    # A seller with forty photographs is a seller with a slow page.
    resp = await client.post(
        "/listings",
        json=_payload(car, image_urls=[f"{GOOD}?n={n}" for n in range(40)]),
    )

    assert len(resp.json()["image_urls"]) == 12  # MAX_LISTING_IMAGES


@pytest.mark.asyncio
async def test_cloudinary_is_accepted(client, car):
    # The other store the app renders from.
    url = "https://res.cloudinary.com/gaadiiq/image/upload/v1/ritz.jpg"

    resp = await client.post("/listings", json=_payload(car, image_urls=[url]))

    assert resp.json()["image_urls"] == [url]
