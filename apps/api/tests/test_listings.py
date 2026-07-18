"""
Listings & Cars API tests using in-memory SQLite.
Image upload tests mock the storage service to avoid needing real R2 credentials.
"""
import io
from unittest.mock import patch

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


async def _register_and_token(client: AsyncClient, email: str = "seller@test.com") -> str:
    resp = await client.post("/auth/register", json={"email": email, "password": "password123"})
    return resp.json()["access_token"]


async def _create_car(client: AsyncClient, token: str) -> str:
    resp = await client.post(
        "/cars",
        json={"make": "Maruti Suzuki", "model": "Swift", "year": 2023, "fuel_type": "petrol"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201
    return resp.json()["id"]


# --- Cars ---

@pytest.mark.asyncio
async def test_list_cars_empty(client: AsyncClient):
    resp = await client.get("/cars")
    assert resp.status_code == 200
    assert resp.json()["total"] == 0
    assert resp.json()["items"] == []


@pytest.mark.asyncio
async def test_create_and_list_cars(client: AsyncClient):
    token = await _register_and_token(client)
    car_id = await _create_car(client, token)
    assert car_id is not None

    resp = await client.get("/cars")
    assert resp.json()["total"] == 1
    assert resp.json()["items"][0]["make"] == "Maruti Suzuki"


@pytest.mark.asyncio
async def test_car_filter_by_make(client: AsyncClient):
    token = await _register_and_token(client, "filter@test.com")
    await _create_car(client, token)
    await client.post(
        "/cars",
        json={"make": "Hyundai", "model": "Creta", "year": 2022},
        headers={"Authorization": f"Bearer {token}"},
    )

    resp = await client.get("/cars?make=maruti")
    assert resp.json()["total"] == 1
    assert resp.json()["items"][0]["make"] == "Maruti Suzuki"


# --- Listings ---

@pytest.mark.asyncio
async def test_create_listing(client: AsyncClient):
    token = await _register_and_token(client, "create@test.com")
    car_id = await _create_car(client, token)

    resp = await client.post(
        "/listings",
        json={
            "car_id": car_id,
            "listing_type": "used",
            "price": 750000,
            "km_driven": 45000,
            "city": "Pune",
            "condition": "good",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["price"] == 750000
    assert data["city"] == "Pune"
    assert data["is_active"] is True
    assert data["views_count"] == 0
    assert data["image_urls"] == []


@pytest.mark.asyncio
async def test_list_listings_empty(client: AsyncClient):
    resp = await client.get("/listings")
    assert resp.status_code == 200
    assert resp.json()["total"] == 0


@pytest.mark.asyncio
async def test_list_listings_with_filter(client: AsyncClient):
    token = await _register_and_token(client, "filter2@test.com")
    car_id = await _create_car(client, token)

    await client.post(
        "/listings",
        json={"car_id": car_id, "listing_type": "used", "price": 500000, "city": "Mumbai"},
        headers={"Authorization": f"Bearer {token}"},
    )
    await client.post(
        "/listings",
        json={"car_id": car_id, "listing_type": "new", "price": 900000, "city": "Delhi"},
        headers={"Authorization": f"Bearer {token}"},
    )

    resp = await client.get("/listings?listing_type=used")
    assert resp.json()["total"] == 1
    assert resp.json()["items"][0]["city"] == "Mumbai"

    resp = await client.get("/listings?min_price=800000")
    assert resp.json()["total"] == 1
    assert resp.json()["items"][0]["price"] == 900000


@pytest.mark.asyncio
async def test_get_listing_increments_views(client: AsyncClient):
    token = await _register_and_token(client, "views@test.com")
    car_id = await _create_car(client, token)
    create_resp = await client.post(
        "/listings",
        json={"car_id": car_id, "listing_type": "used", "price": 600000},
        headers={"Authorization": f"Bearer {token}"},
    )
    listing_id = create_resp.json()["id"]

    resp = await client.get(f"/listings/{listing_id}")
    assert resp.status_code == 200
    assert resp.json()["views_count"] == 1


@pytest.mark.asyncio
async def test_update_listing(client: AsyncClient):
    token = await _register_and_token(client, "update@test.com")
    car_id = await _create_car(client, token)
    create_resp = await client.post(
        "/listings",
        json={"car_id": car_id, "listing_type": "used", "price": 600000},
        headers={"Authorization": f"Bearer {token}"},
    )
    listing_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/listings/{listing_id}",
        json={"price": 550000, "negotiable": True},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["price"] == 550000
    assert resp.json()["negotiable"] is True


@pytest.mark.asyncio
async def test_delete_listing_soft(client: AsyncClient):
    token = await _register_and_token(client, "delete@test.com")
    car_id = await _create_car(client, token)
    create_resp = await client.post(
        "/listings",
        json={"car_id": car_id, "listing_type": "used", "price": 600000},
        headers={"Authorization": f"Bearer {token}"},
    )
    listing_id = create_resp.json()["id"]

    resp = await client.delete(
        f"/listings/{listing_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 204

    # Should not appear in listing feed (soft deleted)
    resp = await client.get("/listings")
    assert resp.json()["total"] == 0


@pytest.mark.asyncio
async def test_update_other_users_listing_forbidden(client: AsyncClient):
    owner_token = await _register_and_token(client, "owner@test.com")
    other_token = await _register_and_token(client, "other@test.com")
    car_id = await _create_car(client, owner_token)
    create_resp = await client.post(
        "/listings",
        json={"car_id": car_id, "listing_type": "used", "price": 600000},
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    listing_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/listings/{listing_id}",
        json={"price": 1},
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_image_upload(client: AsyncClient):
    token = await _register_and_token(client, "img@test.com")
    car_id = await _create_car(client, token)
    create_resp = await client.post(
        "/listings",
        json={"car_id": car_id, "listing_type": "used", "price": 600000},
        headers={"Authorization": f"Bearer {token}"},
    )
    listing_id = create_resp.json()["id"]

    fake_image = io.BytesIO(b"\xff\xd8\xff" + b"\x00" * 100)  # minimal JPEG header
    with patch("services.storage.upload_image", return_value="https://media.gaadiiq.com/listings/fake.jpg"):
        resp = await client.post(
            f"/listings/{listing_id}/images",
            files={"file": ("photo.jpg", fake_image, "image/jpeg")},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 200
    assert "https://media.gaadiiq.com/listings/fake.jpg" in resp.json()["image_urls"]
