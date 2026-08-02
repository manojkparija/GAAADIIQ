"""
Tests for view tracking, admin endpoints, and seller analytics.
"""
import pytest
import pytest_asyncio
from fastapi import HTTPException, status
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.dependencies import get_admin_user
from db.session import get_db
from main import app
from models.user import User, UserRole

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

    async def override_get_admin_user():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_admin_user] = override_get_admin_user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def _register_token(client: AsyncClient, email: str) -> tuple[str, str]:
    """Returns (token, user_id)."""
    r = await client.post("/auth/register", json={"email": email, "password": "pass1234"})
    assert r.status_code in (200, 201), r.text
    data = r.json()
    return data["access_token"], data["user"]["id"]


async def _make_listing(client: AsyncClient, token: str, price: int = 700_000) -> str:
    car = await client.post("/cars", json={
        "make": "Hyundai", "model": "Creta", "year": 2022,
        "fuel_type": "petrol", "transmission": "automatic", "body_type": "suv",
    }, headers={"Authorization": f"Bearer {token}"})
    listing = await client.post("/listings", json={
        "car_id": car.json()["id"], "listing_type": "used",
        "price": price, "km_driven": 15000, "owners_count": 1,
        "condition": "excellent", "city": "Bangalore",
    }, headers={"Authorization": f"Bearer {token}"})
    assert listing.status_code == 201, listing.text
    return listing.json()["id"]


async def _make_admin(db_engine, user_id: str):
    """Directly set a user's role to admin in the test DB."""
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)
    async with session_factory() as session:
        import uuid
        result = await session.execute(select(User).where(User.id == uuid.UUID(user_id)))
        user = result.scalar_one()
        user.role = UserRole.admin
        await session.commit()


# ── View tracking ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_view_increments_on_get(client):
    """GET /listings/{id} increments views_count on each call."""
    seller_token, _ = await _register_token(client, "view_seller@test.com")
    listing_id = await _make_listing(client, seller_token)

    # Each GET increments views by 1
    r1 = await client.get(f"/listings/{listing_id}")
    v1 = r1.json()["views_count"]

    r2 = await client.get(f"/listings/{listing_id}")
    v2 = r2.json()["views_count"]

    assert v2 == v1 + 1


@pytest.mark.asyncio
async def test_multiple_views_accumulate(client):
    """Multiple GETs accumulate views."""
    seller_token, _ = await _register_token(client, "mview_seller@test.com")
    listing_id = await _make_listing(client, seller_token)

    # Fetch 5 times
    for _ in range(5):
        await client.get(f"/listings/{listing_id}")

    r = await client.get(f"/listings/{listing_id}")
    # After 6 total GETs, views should be 6
    assert r.json()["views_count"] == 6


# ── Admin endpoints ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_stats_forbidden_for_regular_user(client):
    token, _ = await _register_token(client, "regular_stats@test.com")
    r = await client.get("/admin/stats", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_admin_stats_forbidden_unauthenticated(client):
    r = await client.get("/admin/stats")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_admin_stats(client, db_engine):
    token, user_id = await _register_token(client, "admin_stats@test.com")
    await _make_admin(db_engine, user_id)

    # Create some data
    seller_token, _ = await _register_token(client, "admin_data_seller@test.com")
    await _make_listing(client, seller_token)

    r = await client.get("/admin/stats", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    data = r.json()
    assert data["total_users"] >= 2
    assert data["total_listings"] >= 1
    assert data["active_listings"] >= 1
    assert "total_bookings" in data
    assert "total_reviews" in data


@pytest.mark.asyncio
async def test_admin_list_users(client, db_engine):
    admin_token, admin_id = await _register_token(client, "admin_lu@test.com")
    await _make_admin(db_engine, admin_id)

    await _register_token(client, "user1_lu@test.com")
    await _register_token(client, "user2_lu@test.com")

    r = await client.get("/admin/users", headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    assert len(r.json()) >= 3


@pytest.mark.asyncio
async def test_admin_update_user_role(client, db_engine):
    admin_token, admin_id = await _register_token(client, "admin_upd@test.com")
    await _make_admin(db_engine, admin_id)

    _, target_id = await _register_token(client, "target_upd@test.com")

    r = await client.patch(
        f"/admin/users/{target_id}",
        json={"role": "seller"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200
    assert r.json()["role"] == "seller"


@pytest.mark.asyncio
async def test_admin_deactivate_listing(client, db_engine):
    admin_token, admin_id = await _register_token(client, "admin_deact@test.com")
    await _make_admin(db_engine, admin_id)

    seller_token, _ = await _register_token(client, "seller_deact@test.com")
    listing_id = await _make_listing(client, seller_token)

    r = await client.patch(
        f"/admin/listings/{listing_id}/deactivate",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 204

    r = await client.get(f"/listings/{listing_id}")
    assert r.json()["is_active"] is False


# ── Seller analytics ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_seller_analytics_empty(client):
    token, _ = await _register_token(client, "anl_empty@test.com")
    r = await client.get("/dealers/me/analytics", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    data = r.json()
    assert data["total_listings"] == 0
    assert data["total_views"] == 0
    assert data["overall_avg_rating"] is None
    assert data["listings"] == []


@pytest.mark.asyncio
async def test_seller_analytics_with_data(client):
    seller_token, seller_id = await _register_token(client, "anl_seller@test.com")
    listing_id = await _make_listing(client, seller_token)

    # Add 3 views (each GET increments views_count)
    for _ in range(3):
        await client.get(f"/listings/{listing_id}")

    # Buyer creates a booking
    buyer_token, _ = await _register_token(client, "anl_buyer@test.com")
    await client.post("/bookings", json={"listing_id": listing_id},
                      headers={"Authorization": f"Bearer {buyer_token}"})

    # Buyer leaves a review
    await client.post("/reviews", json={"listing_id": listing_id, "rating": 4},
                      headers={"Authorization": f"Bearer {buyer_token}"})

    r = await client.get(
        "/dealers/me/analytics",
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["total_listings"] == 1
    assert data["total_views"] >= 3
    assert data["total_bookings"] == 1
    assert data["total_reviews"] == 1
    assert data["overall_avg_rating"] == 4.0
    assert len(data["listings"]) == 1
    assert data["listings"][0]["views"] == 3
    assert data["listings"][0]["bookings"] == 1
    assert data["listings"][0]["avg_rating"] == 4.0


@pytest.mark.asyncio
async def test_seller_analytics_requires_auth(client):
    r = await client.get("/dealers/me/analytics")
    assert r.status_code == 401
