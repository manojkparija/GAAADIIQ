"""
Tests for notifications, price alerts, and background notification triggers.
"""
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from db.base import Base
from db.session import get_db
from main import app

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture
async def db_engine():
    engine = create_async_engine(TEST_DB_URL, echo=False)
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


async def _make_listing(client: AsyncClient, token: str, price: int = 1_000_000) -> str:
    car = await client.post("/cars", json={
        "make": "Maruti", "model": "Swift", "year": 2021,
        "fuel_type": "petrol", "transmission": "manual", "body_type": "hatchback",
    }, headers={"Authorization": f"Bearer {token}"})
    listing = await client.post("/listings", json={
        "car_id": car.json()["id"], "listing_type": "used",
        "price": price, "km_driven": 30000, "owners_count": 1,
        "condition": "good", "city": "Pune",
    }, headers={"Authorization": f"Bearer {token}"})
    assert listing.status_code == 201, listing.text
    return listing.json()["id"]


# ── Notification CRUD ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_unread_count_zero_for_new_user(client):
    token = await _register_token(client, "bell@test.com")
    r = await client.get(
        "/notifications/unread-count",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["unread_count"] == 0


@pytest.mark.asyncio
async def test_list_notifications_empty(client):
    token = await _register_token(client, "empty_notif@test.com")
    r = await client.get("/notifications", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_notifications_require_auth(client):
    r = await client.get("/notifications")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_booking_creates_notification(client):
    """Seller gets a notification when buyer books test drive."""
    seller_token = await _register_token(client, "seller_notif@test.com")
    listing_id = await _make_listing(client, seller_token)

    buyer_token = await _register_token(client, "buyer_notif@test.com")
    r = await client.post("/bookings", json={"listing_id": listing_id},
                          headers={"Authorization": f"Bearer {buyer_token}"})
    assert r.status_code == 201

    # Seller should have a notification now
    r = await client.get("/notifications", headers={"Authorization": f"Bearer {seller_token}"})
    assert r.status_code == 200
    notifs = r.json()
    assert len(notifs) == 1
    assert notifs[0]["type"] == "booking_received"
    assert notifs[0]["is_read"] is False


@pytest.mark.asyncio
async def test_loan_inquiry_creates_notification(client):
    """Seller gets a notification when buyer submits a loan inquiry."""
    seller_token = await _register_token(client, "seller_loan_notif@test.com")
    listing_id = await _make_listing(client, seller_token)

    buyer_token = await _register_token(client, "buyer_loan_notif@test.com")
    r = await client.post("/loans/inquiries", json={
        "listing_id": listing_id,
        "loan_amount": 800000,
        "tenure_months": 60,
        "employment_type": "salaried",
        "annual_income": 1200000,
    }, headers={"Authorization": f"Bearer {buyer_token}"})
    assert r.status_code == 201

    r = await client.get("/notifications", headers={"Authorization": f"Bearer {seller_token}"})
    assert r.status_code == 200
    notifs = r.json()
    assert len(notifs) == 1
    assert notifs[0]["type"] == "loan_inquiry_received"


@pytest.mark.asyncio
async def test_unread_count_increments(client):
    seller_token = await _register_token(client, "seller_cnt@test.com")
    listing_id = await _make_listing(client, seller_token)

    buyer_token = await _register_token(client, "buyer_cnt@test.com")
    await client.post("/bookings", json={"listing_id": listing_id},
                      headers={"Authorization": f"Bearer {buyer_token}"})
    await client.post("/loans/inquiries", json={
        "listing_id": listing_id, "loan_amount": 500000,
        "tenure_months": 36, "employment_type": "self_employed", "annual_income": 800000,
    }, headers={"Authorization": f"Bearer {buyer_token}"})

    r = await client.get(
        "/notifications/unread-count",
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert r.json()["unread_count"] == 2


@pytest.mark.asyncio
async def test_mark_notification_read(client):
    seller_token = await _register_token(client, "seller_rd@test.com")
    listing_id = await _make_listing(client, seller_token)
    buyer_token = await _register_token(client, "buyer_rd@test.com")
    await client.post("/bookings", json={"listing_id": listing_id},
                      headers={"Authorization": f"Bearer {buyer_token}"})

    notifs = (
        await client.get(
            "/notifications",
            headers={"Authorization": f"Bearer {seller_token}"},
        )
    ).json()
    notif_id = notifs[0]["id"]

    r = await client.patch(f"/notifications/{notif_id}/read",
                           headers={"Authorization": f"Bearer {seller_token}"})
    assert r.status_code == 200
    assert r.json()["is_read"] is True

    r = await client.get(
        "/notifications/unread-count",
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert r.json()["unread_count"] == 0


@pytest.mark.asyncio
async def test_mark_all_read(client):
    seller_token = await _register_token(client, "seller_allrd@test.com")
    listing_id = await _make_listing(client, seller_token)
    buyer_token = await _register_token(client, "buyer_allrd@test.com")
    await client.post("/bookings", json={"listing_id": listing_id},
                      headers={"Authorization": f"Bearer {buyer_token}"})
    await client.post("/loans/inquiries", json={
        "listing_id": listing_id, "loan_amount": 500000,
        "tenure_months": 48, "employment_type": "salaried", "annual_income": 900000,
    }, headers={"Authorization": f"Bearer {buyer_token}"})

    r = await client.post("/notifications/mark-all-read",
                          headers={"Authorization": f"Bearer {seller_token}"})
    assert r.status_code == 200
    assert r.json()["marked"] is True

    r = await client.get(
        "/notifications/unread-count",
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert r.json()["unread_count"] == 0


@pytest.mark.asyncio
async def test_cannot_read_other_users_notification(client):
    seller_token = await _register_token(client, "seller_priv@test.com")
    listing_id = await _make_listing(client, seller_token)
    buyer_token = await _register_token(client, "buyer_priv@test.com")
    await client.post("/bookings", json={"listing_id": listing_id},
                      headers={"Authorization": f"Bearer {buyer_token}"})

    notifs = (
        await client.get(
            "/notifications",
            headers={"Authorization": f"Bearer {seller_token}"},
        )
    ).json()
    notif_id = notifs[0]["id"]

    r = await client.patch(f"/notifications/{notif_id}/read",
                           headers={"Authorization": f"Bearer {buyer_token}"})
    assert r.status_code == 404


# ── Price Alerts ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_subscribe_price_alert(client):
    seller_token = await _register_token(client, "pa_seller@test.com")
    listing_id = await _make_listing(client, seller_token)

    watcher_token = await _register_token(client, "pa_watcher@test.com")
    r = await client.post("/price-alerts", params={"listing_id": listing_id},
                          headers={"Authorization": f"Bearer {watcher_token}"})
    assert r.status_code == 201
    assert r.json()["listing_id"] == listing_id


@pytest.mark.asyncio
async def test_duplicate_price_alert_rejected(client):
    seller_token = await _register_token(client, "pa_dup_seller@test.com")
    listing_id = await _make_listing(client, seller_token)
    watcher_token = await _register_token(client, "pa_dup_watcher@test.com")

    await client.post("/price-alerts", params={"listing_id": listing_id},
                      headers={"Authorization": f"Bearer {watcher_token}"})
    r = await client.post("/price-alerts", params={"listing_id": listing_id},
                          headers={"Authorization": f"Bearer {watcher_token}"})
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_list_my_price_alerts(client):
    seller_token = await _register_token(client, "pa_list_seller@test.com")
    listing_id = await _make_listing(client, seller_token)
    watcher_token = await _register_token(client, "pa_list_watcher@test.com")

    await client.post("/price-alerts", params={"listing_id": listing_id},
                      headers={"Authorization": f"Bearer {watcher_token}"})

    r = await client.get("/price-alerts", headers={"Authorization": f"Bearer {watcher_token}"})
    assert r.status_code == 200
    assert len(r.json()) == 1


@pytest.mark.asyncio
async def test_unsubscribe_price_alert(client):
    seller_token = await _register_token(client, "pa_del_seller@test.com")
    listing_id = await _make_listing(client, seller_token)
    watcher_token = await _register_token(client, "pa_del_watcher@test.com")

    sub = await client.post("/price-alerts", params={"listing_id": listing_id},
                            headers={"Authorization": f"Bearer {watcher_token}"})
    alert_id = sub.json()["id"]

    r = await client.delete(f"/price-alerts/{alert_id}",
                            headers={"Authorization": f"Bearer {watcher_token}"})
    assert r.status_code == 204

    r = await client.get("/price-alerts", headers={"Authorization": f"Bearer {watcher_token}"})
    assert r.json() == []


@pytest.mark.asyncio
async def test_price_drop_creates_notification(client):
    """When seller lowers price, subscribed watcher gets a notification."""
    seller_token = await _register_token(client, "pa_drop_seller@test.com")
    listing_id = await _make_listing(client, seller_token, price=1_000_000)

    watcher_token = await _register_token(client, "pa_drop_watcher@test.com")
    await client.post("/price-alerts", params={"listing_id": listing_id},
                      headers={"Authorization": f"Bearer {watcher_token}"})

    # Seller lowers price
    r = await client.patch(f"/listings/{listing_id}", json={"price": 900000},
                           headers={"Authorization": f"Bearer {seller_token}"})
    assert r.status_code == 200

    # Watcher should have a price_drop notification
    r = await client.get("/notifications", headers={"Authorization": f"Bearer {watcher_token}"})
    assert r.status_code == 200
    notifs = r.json()
    assert len(notifs) == 1
    assert notifs[0]["type"] == "price_drop"
    assert "900" in notifs[0]["body"]


@pytest.mark.asyncio
async def test_price_increase_no_notification(client):
    """No notification when price goes up."""
    seller_token = await _register_token(client, "pa_up_seller@test.com")
    listing_id = await _make_listing(client, seller_token, price=800_000)

    watcher_token = await _register_token(client, "pa_up_watcher@test.com")
    await client.post("/price-alerts", params={"listing_id": listing_id},
                      headers={"Authorization": f"Bearer {watcher_token}"})

    await client.patch(f"/listings/{listing_id}", json={"price": 900000},
                       headers={"Authorization": f"Bearer {seller_token}"})

    r = await client.get("/notifications", headers={"Authorization": f"Bearer {watcher_token}"})
    assert r.json() == []


@pytest.mark.asyncio
async def test_is_subscribed_endpoint(client):
    seller_token = await _register_token(client, "pa_check_seller@test.com")
    listing_id = await _make_listing(client, seller_token)
    watcher_token = await _register_token(client, "pa_check_watcher@test.com")

    r = await client.get(f"/price-alerts/listing/{listing_id}/subscribed",
                         headers={"Authorization": f"Bearer {watcher_token}"})
    assert r.json()["subscribed"] is False

    await client.post("/price-alerts", params={"listing_id": listing_id},
                      headers={"Authorization": f"Bearer {watcher_token}"})

    r = await client.get(f"/price-alerts/listing/{listing_id}/subscribed",
                         headers={"Authorization": f"Bearer {watcher_token}"})
    assert r.json()["subscribed"] is True
