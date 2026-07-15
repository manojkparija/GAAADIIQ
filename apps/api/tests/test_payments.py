"""
Tests for payments (Razorpay stub) and subscription management.
Dev mode is active when RAZORPAY_KEY_ID is not set — auto-approves all payments.
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


async def _register_token(client: AsyncClient, email: str) -> str:
    r = await client.post("/auth/register", json={"email": email, "password": "pass1234"})
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"]


async def _make_listing(client: AsyncClient, token: str) -> str:
    car = await client.post("/cars", json={
        "make": "Kia", "model": "Seltos", "year": 2023,
        "fuel_type": "petrol", "transmission": "automatic", "body_type": "suv",
    }, headers={"Authorization": f"Bearer {token}"})
    listing = await client.post("/listings", json={
        "car_id": car.json()["id"], "listing_type": "used",
        "price": 1_500_000, "km_driven": 10000, "owners_count": 1,
        "condition": "excellent", "city": "Mumbai",
    }, headers={"Authorization": f"Bearer {token}"})
    assert listing.status_code == 201, listing.text
    return listing.json()["id"]


# ── Feature listing (dev auto-approve) ───────────────────────────────────────

@pytest.mark.asyncio
async def test_feature_listing_dev_mode(client):
    """In dev mode (no RAZORPAY_KEY_ID), payment auto-approves and listing becomes featured."""
    token = await _register_token(client, "feat_seller@test.com")
    listing_id = await _make_listing(client, token)

    r = await client.post("/payments/feature-listing", json={
        "listing_id": listing_id,
        "duration_days": 30,
    }, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    data = r.json()
    assert data["dev_mode"] is True
    assert data["listing_featured"] is True
    assert data["amount_paise"] == 149900
    assert data["razorpay_order_id"] is not None

    # Listing should now have is_featured=True
    r = await client.get(f"/listings/{listing_id}")
    assert r.json()["is_featured"] is True


@pytest.mark.asyncio
async def test_feature_listing_invalid_duration(client):
    token = await _register_token(client, "feat_dur@test.com")
    listing_id = await _make_listing(client, token)
    r = await client.post("/payments/feature-listing", json={
        "listing_id": listing_id, "duration_days": 15,
    }, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_feature_others_listing_forbidden(client):
    seller_token = await _register_token(client, "feat_owner@test.com")
    listing_id = await _make_listing(client, seller_token)

    other_token = await _register_token(client, "feat_other@test.com")
    r = await client.post("/payments/feature-listing", json={
        "listing_id": listing_id, "duration_days": 7,
    }, headers={"Authorization": f"Bearer {other_token}"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_my_payments(client):
    token = await _register_token(client, "mypay@test.com")
    listing_id = await _make_listing(client, token)

    await client.post("/payments/feature-listing", json={
        "listing_id": listing_id, "duration_days": 7,
    }, headers={"Authorization": f"Bearer {token}"})

    r = await client.get("/payments/my", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    payments = r.json()
    assert len(payments) == 1
    assert payments[0]["status"] == "paid"
    assert payments[0]["purpose"] == "featured_listing"
    assert payments[0]["amount_paise"] == 49900


@pytest.mark.asyncio
async def test_feature_listing_requires_auth(client):
    r = await client.post("/payments/feature-listing", json={
        "listing_id": "00000000-0000-0000-0000-000000000000", "duration_days": 30,
    })
    assert r.status_code == 401


# ── Subscriptions ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_default_subscription_is_free(client):
    token = await _register_token(client, "sub_default@test.com")
    r = await client.get("/subscriptions/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    data = r.json()
    assert data["tier"] == "free"
    assert data["valid_until"] is None


@pytest.mark.asyncio
async def test_upgrade_to_pro(client):
    token = await _register_token(client, "sub_pro@test.com")
    r = await client.post("/subscriptions/upgrade", json={"tier": "pro"},
                          headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    data = r.json()
    assert data["dev_mode"] is True
    assert data["amount_paise"] == 99900

    # Subscription should now be pro
    r = await client.get("/subscriptions/me", headers={"Authorization": f"Bearer {token}"})
    assert r.json()["tier"] == "pro"
    assert r.json()["valid_until"] is not None


@pytest.mark.asyncio
async def test_upgrade_to_dealer_tier(client):
    token = await _register_token(client, "sub_dealer@test.com")
    r = await client.post("/subscriptions/upgrade", json={"tier": "dealer"},
                          headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["amount_paise"] == 299900

    r = await client.get("/subscriptions/me", headers={"Authorization": f"Bearer {token}"})
    assert r.json()["tier"] == "dealer"


@pytest.mark.asyncio
async def test_cannot_upgrade_to_free(client):
    token = await _register_token(client, "sub_free_up@test.com")
    r = await client.post("/subscriptions/upgrade", json={"tier": "free"},
                          headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_subscription_requires_auth(client):
    r = await client.get("/subscriptions/me")
    assert r.status_code == 401
