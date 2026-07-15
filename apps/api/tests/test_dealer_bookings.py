"""
Tests for dealer registration API and test drive bookings API.
"""
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from db.base import Base
from db.session import get_db
from main import app

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture
async def db_engine():
    engine = create_async_engine(TEST_DB_URL, echo=False, connect_args={"check_same_thread": False}, poolclass=StaticPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


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


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _register_token(client: AsyncClient, email: str) -> str:
    r = await client.post("/auth/register", json={"email": email, "password": "password123"})
    assert r.status_code == 201, r.json()
    return r.json()["access_token"]


async def _make_listing(client: AsyncClient, token: str) -> str:
    car = await client.post(
        "/cars",
        json={"make": "Maruti", "model": "Swift", "year": 2020,
              "fuel_type": "petrol", "transmission": "manual", "body_type": "hatchback"},
        headers={"Authorization": f"Bearer {token}"},
    )
    listing = await client.post(
        "/listings",
        json={"car_id": car.json()["id"], "listing_type": "used",
              "price": 600000, "km_driven": 25000, "owners_count": 1,
              "condition": "good", "city": "Mumbai"},
        headers={"Authorization": f"Bearer {token}"},
    )
    return listing.json()["id"]


# ── Dealer registration tests ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_dealer_register_success(client: AsyncClient):
    token = await _register_token(client, "dealer1@test.com")
    resp = await client.post(
        "/dealers/register",
        json={"business_name": "AutoKing Motors", "city": "Delhi", "state": "Delhi"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["business_name"] == "AutoKing Motors"
    assert data["is_verified"] is False


@pytest.mark.asyncio
async def test_dealer_register_duplicate(client: AsyncClient):
    token = await _register_token(client, "dealer2@test.com")
    payload = {"business_name": "My Motors"}
    headers = {"Authorization": f"Bearer {token}"}

    r1 = await client.post("/dealers/register", json=payload, headers=headers)
    assert r1.status_code == 201

    r2 = await client.post("/dealers/register", json=payload, headers=headers)
    assert r2.status_code == 409


@pytest.mark.asyncio
async def test_dealer_register_requires_auth(client: AsyncClient):
    resp = await client.post("/dealers/register", json={"business_name": "No Auth"})
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_dealer_get_me(client: AsyncClient):
    token = await _register_token(client, "dealer3@test.com")
    headers = {"Authorization": f"Bearer {token}"}

    await client.post(
        "/dealers/register",
        json={"business_name": "Speed Cars", "gst_number": "22AAAAA0000A1Z5"},
        headers=headers,
    )

    resp = await client.get("/dealers/me", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["gst_number"] == "22AAAAA0000A1Z5"


@pytest.mark.asyncio
async def test_dealer_get_me_not_registered(client: AsyncClient):
    token = await _register_token(client, "dealer4@test.com")
    resp = await client.get("/dealers/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_dealer_update_me(client: AsyncClient):
    token = await _register_token(client, "dealer5@test.com")
    headers = {"Authorization": f"Bearer {token}"}

    await client.post("/dealers/register", json={"business_name": "Old Name"}, headers=headers)

    resp = await client.patch(
        "/dealers/me",
        json={"business_name": "New Name", "city": "Pune"},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["business_name"] == "New Name"
    assert resp.json()["city"] == "Pune"


@pytest.mark.asyncio
async def test_my_listings_summary(client: AsyncClient):
    token = await _register_token(client, "dealer6@test.com")
    headers = {"Authorization": f"Bearer {token}"}

    await _make_listing(client, token)

    resp = await client.get("/dealers/my-listings-summary", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_listings"] == 1
    assert data["active_listings"] == 1
    assert data["total_views"] == 0


# ── Booking tests ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_booking(client: AsyncClient):
    seller_token = await _register_token(client, "seller1@test.com")
    buyer_token = await _register_token(client, "buyer1@test.com")

    listing_id = await _make_listing(client, seller_token)

    resp = await client.post(
        "/bookings",
        json={
            "listing_id": listing_id,
            "preferred_date": "2026-07-15",
            "notes": "Morning slot preferred",
        },
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["listing_id"] == listing_id
    assert data["status"] == "pending"


@pytest.mark.asyncio
async def test_create_booking_requires_auth(client: AsyncClient):
    seller_token = await _register_token(client, "seller2@test.com")
    listing_id = await _make_listing(client, seller_token)

    client.cookies.clear()  # remove session cookie so the request is truly unauthenticated
    resp = await client.post("/bookings", json={"listing_id": listing_id})
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_create_booking_invalid_listing(client: AsyncClient):
    token = await _register_token(client, "buyer2@test.com")
    fake_id = "00000000-0000-0000-0000-000000000000"
    resp = await client.post(
        "/bookings",
        json={"listing_id": fake_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_list_my_bookings(client: AsyncClient):
    seller_token = await _register_token(client, "seller3@test.com")
    buyer_token = await _register_token(client, "buyer3@test.com")
    listing_id = await _make_listing(client, seller_token)

    await client.post(
        "/bookings",
        json={"listing_id": listing_id},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )

    resp = await client.get("/bookings", headers={"Authorization": f"Bearer {buyer_token}"})
    assert resp.status_code == 200
    assert len(resp.json()) == 1


@pytest.mark.asyncio
async def test_received_bookings_seller_only(client: AsyncClient):
    seller_token = await _register_token(client, "seller4@test.com")
    buyer_token = await _register_token(client, "buyer4@test.com")
    other_token = await _register_token(client, "other1@test.com")
    listing_id = await _make_listing(client, seller_token)

    await client.post(
        "/bookings",
        json={"listing_id": listing_id},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )

    # Seller sees the booking
    resp = await client.get(
        "/bookings/received",
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    # Other user sees nothing
    resp2 = await client.get(
        "/bookings/received",
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert resp.status_code == 200
    assert len(resp2.json()) == 0


@pytest.mark.asyncio
async def test_update_booking_status(client: AsyncClient):
    seller_token = await _register_token(client, "seller5@test.com")
    buyer_token = await _register_token(client, "buyer5@test.com")
    listing_id = await _make_listing(client, seller_token)

    booking = await client.post(
        "/bookings",
        json={"listing_id": listing_id},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    booking_id = booking.json()["id"]

    resp = await client.patch(
        f"/bookings/{booking_id}/status",
        json={"status": "confirmed"},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "confirmed"


@pytest.mark.asyncio
async def test_update_booking_status_non_owner_forbidden(client: AsyncClient):
    seller_token = await _register_token(client, "seller6@test.com")
    buyer_token = await _register_token(client, "buyer6@test.com")
    listing_id = await _make_listing(client, seller_token)

    booking = await client.post(
        "/bookings",
        json={"listing_id": listing_id},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    booking_id = booking.json()["id"]

    # Buyer tries to update status — should fail (they don't own the listing)
    resp = await client.patch(
        f"/bookings/{booking_id}/status",
        json={"status": "confirmed"},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert resp.status_code == 404
