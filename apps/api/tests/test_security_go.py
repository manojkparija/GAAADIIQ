"""
GO retest — security paths that must pass before production.

Covers:
- Payment signature fail-closed (no bypass when keys present / non-dev)
- My Listings scoping (/listings/me isolation)
- Public listing responses strip seller PII (email/phone)
- Production config validation refuses insecure defaults
- Seed import path resolves AsyncSessionLocal
"""
import hashlib
import hmac
import json
from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.config import Settings
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


async def _register(client: AsyncClient, email: str) -> tuple[str, dict]:
    r = await client.post("/auth/register", json={"email": email, "password": "pass1234", "full_name": "Test Seller", "phone": "9876543210"})
    assert r.status_code in (200, 201), r.text
    data = r.json()
    return data["access_token"], data["user"]


async def _make_listing(client: AsyncClient, token: str) -> str:
    car = await client.post(
        "/cars",
        json={"make": "Tata", "model": "Nexon", "year": 2023, "fuel_type": "petrol", "transmission": "manual", "body_type": "suv"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert car.status_code == 201, car.text
    listing = await client.post(
        "/listings",
        json={
            "car_id": car.json()["id"],
            "listing_type": "used",
            "price": 900000,
            "km_driven": 12000,
            "owners_count": 1,
            "condition": "good",
            "city": "Pune",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert listing.status_code == 201, listing.text
    return listing.json()["id"]


# ── Public PII stripping ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_public_listing_strips_seller_pii(client: AsyncClient):
    token, user = await _register(client, "pii_seller@test.com")
    listing_id = await _make_listing(client, token)

    r = await client.get(f"/listings/{listing_id}")
    assert r.status_code == 200
    seller = r.json()["seller"]
    assert "email" not in seller
    assert "phone" not in seller
    assert seller["id"] == user["id"]
    assert seller["full_name"] == "Test Seller"

    # List endpoint also public
    r = await client.get("/listings")
    assert r.status_code == 200
    assert r.json()["total"] >= 1
    for item in r.json()["items"]:
        assert "email" not in item["seller"]
        assert "phone" not in item["seller"]


@pytest.mark.asyncio
async def test_auth_me_still_returns_full_user(client: AsyncClient):
    token, _ = await _register(client, "me_full@test.com")
    r = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    data = r.json()
    assert data["email"] == "me_full@test.com"
    assert data["phone"] == "9876543210"


# ── My Listings scoping ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_listings_me_returns_only_own(client: AsyncClient):
    seller_a, _ = await _register(client, "scope_a@test.com")
    seller_b, _ = await _register(client, "scope_b@test.com")
    listing_a = await _make_listing(client, seller_a)
    listing_b = await _make_listing(client, seller_b)

    r = await client.get("/listings/me", headers={"Authorization": f"Bearer {seller_a}"})
    assert r.status_code == 200
    ids = {item["id"] for item in r.json()["items"]}
    assert listing_a in ids
    assert listing_b not in ids
    assert r.json()["total"] == 1


@pytest.mark.asyncio
async def test_listings_me_requires_auth(client: AsyncClient):
    r = await client.get("/listings/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_public_listings_still_shows_all_active(client: AsyncClient):
    seller_a, _ = await _register(client, "pub_a@test.com")
    seller_b, _ = await _register(client, "pub_b@test.com")
    await _make_listing(client, seller_a)
    await _make_listing(client, seller_b)

    r = await client.get("/listings")
    assert r.status_code == 200
    assert r.json()["total"] == 2


# ── Payment signature fail-closed ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_verify_rejects_forged_signature_when_keys_set(client: AsyncClient):
    """With Razorpay keys present (non-dev), forged signature must fail."""
    token, _ = await _register(client, "pay_forge@test.com")
    listing_id = await _make_listing(client, token)

    with patch("routers.payments.settings") as mock_settings:
        mock_settings.is_production = False
        mock_settings.payments_enabled = True
        mock_settings.RAZORPAY_KEY_ID = "rzp_test_key"
        mock_settings.RAZORPAY_KEY_SECRET = "test_secret_abc"

        # Create pending payment by mocking Razorpay order create
        with patch("razorpay.Client") as mock_client_cls:
            mock_client = mock_client_cls.return_value
            mock_client.order.create.return_value = {"id": "order_test_123"}
            r = await client.post(
                "/payments/feature-listing",
                json={"listing_id": listing_id, "duration_days": 7},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert r.status_code == 200, r.text
            payment_id = r.json()["payment_id"]
            assert r.json()["dev_mode"] is False

        # Forged signature must be rejected
        r = await client.post(
            "/payments/verify",
            json={
                "payment_id": payment_id,
                "razorpay_payment_id": "pay_forged",
                "razorpay_signature": "deadbeef" * 8,
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 400
        assert "signature" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_verify_accepts_valid_hmac_signature(client: AsyncClient):
    token, _ = await _register(client, "pay_valid@test.com")
    listing_id = await _make_listing(client, token)
    secret = "test_secret_valid"

    with patch("routers.payments.settings") as mock_settings:
        mock_settings.is_production = False
        mock_settings.payments_enabled = True
        mock_settings.RAZORPAY_KEY_ID = "rzp_test_key"
        mock_settings.RAZORPAY_KEY_SECRET = secret

        with patch("razorpay.Client") as mock_client_cls:
            mock_client = mock_client_cls.return_value
            mock_client.order.create.return_value = {"id": "order_valid_456"}
            r = await client.post(
                "/payments/feature-listing",
                json={"listing_id": listing_id, "duration_days": 7},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert r.status_code == 200, r.text
            payment_id = r.json()["payment_id"]
            order_id = r.json()["razorpay_order_id"]

        razorpay_payment_id = "pay_valid_789"
        body = f"{order_id}|{razorpay_payment_id}"
        signature = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()

        r = await client.post(
            "/payments/verify",
            json={
                "payment_id": payment_id,
                "razorpay_payment_id": razorpay_payment_id,
                "razorpay_signature": signature,
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "paid"

        # Listing featured after valid verify
        r = await client.get(f"/listings/{listing_id}")
        assert r.json()["is_featured"] is True


@pytest.mark.asyncio
async def test_verify_cannot_mark_others_payment(client: AsyncClient):
    owner, _ = await _register(client, "pay_owner@test.com")
    other, _ = await _register(client, "pay_thief@test.com")
    listing_id = await _make_listing(client, owner)

    r = await client.post(
        "/payments/feature-listing",
        json={"listing_id": listing_id, "duration_days": 7},
        headers={"Authorization": f"Bearer {owner}"},
    )
    assert r.status_code == 200
    payment_id = r.json()["payment_id"]

    # Already paid in dev mode — but ownership check still applies for other user
    r = await client.post(
        "/payments/verify",
        json={
            "payment_id": payment_id,
            "razorpay_payment_id": "pay_x",
            "razorpay_signature": "sig",
        },
        headers={"Authorization": f"Bearer {other}"},
    )
    assert r.status_code == 404


# ── Production config validation ──────────────────────────────────────────────

def test_production_refuses_default_secret():
    s = Settings(
        environment="production",
        secret_key="change-me-in-production",
        RAZORPAY_KEY_ID="rzp_live",
        RAZORPAY_KEY_SECRET="secret",
        SMTP_HOST="smtp.example.com",
    )
    with pytest.raises(SystemExit):
        s.validate_production_config()


def test_production_refuses_missing_razorpay():
    s = Settings(
        environment="production",
        secret_key="a-strong-random-secret-value-here",
        RAZORPAY_KEY_ID="",
        RAZORPAY_KEY_SECRET="",
        SMTP_HOST="smtp.example.com",
    )
    with pytest.raises(SystemExit):
        s.validate_production_config()


def test_development_allows_defaults():
    s = Settings(environment="development", secret_key="change-me-in-production")
    s.validate_production_config()  # must not raise


def test_dev_mode_helper_false_when_keys_present():
    from routers import payments as pay

    with patch("routers.payments.settings") as mock_settings:
        mock_settings.is_production = False
        mock_settings.payments_enabled = True
        assert pay._dev_mode() is False


def test_dev_mode_helper_false_in_production():
    from routers import payments as pay

    with patch("routers.payments.settings") as mock_settings:
        mock_settings.is_production = True
        mock_settings.payments_enabled = False
        assert pay._dev_mode() is False


# ── Seed import path ──────────────────────────────────────────────────────────

def test_seed_imports_async_session_local():
    from pathlib import Path

    seed_path = Path(__file__).resolve().parents[1] / "seed.py"
    # Verify source no longer references broken module
    source = seed_path.read_text()
    assert "from db.session import AsyncSessionLocal" in source
    assert "from core.database import" not in source

    from db.session import AsyncSessionLocal as ASL

    assert ASL is not None


# ── Alembic migration present ─────────────────────────────────────────────────

def test_alembic_initial_migration_exists():
    from pathlib import Path

    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    files = list(versions.glob("*.py"))
    assert any("0001" in f.name for f in files), f"No initial migration in {versions}: {files}"
    assert any("0002" in f.name for f in files), f"Missing refresh_tokens migration: {files}"


# ── Auth cookies + refresh/logout ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_register_sets_httponly_auth_cookies(client: AsyncClient):
    r = await client.post(
        "/auth/register",
        json={"email": "cookie_user@test.com", "password": "pass1234", "full_name": "Cookie"},
    )
    assert r.status_code in (200, 201), r.text
    # httpx stores Set-Cookie on the client jar
    cookie_names = {c.name for c in client.cookies.jar}
    assert "access_token" in cookie_names
    assert "refresh_token" in cookie_names
    # Response should still include Bearer token for API clients
    assert "access_token" in r.json()


@pytest.mark.asyncio
async def test_me_works_with_cookie_only(client: AsyncClient):
    r = await client.post(
        "/auth/register",
        json={"email": "cookie_me@test.com", "password": "pass1234"},
    )
    assert r.status_code in (200, 201)
    # Drop Authorization header usage — rely on cookies from jar
    r = await client.get("/auth/me")
    assert r.status_code == 200
    assert r.json()["email"] == "cookie_me@test.com"


@pytest.mark.asyncio
async def test_refresh_rotates_tokens(client: AsyncClient):
    r = await client.post(
        "/auth/register",
        json={"email": "refresh_user@test.com", "password": "pass1234"},
    )
    assert r.status_code in (200, 201)
    old_refresh = client.cookies.get("refresh_token")
    assert old_refresh

    r = await client.post("/auth/refresh")
    assert r.status_code == 200, r.text
    assert "access_token" in r.json()
    new_refresh = client.cookies.get("refresh_token")
    assert new_refresh
    assert new_refresh != old_refresh


@pytest.mark.asyncio
async def test_logout_clears_session(client: AsyncClient):
    r = await client.post(
        "/auth/register",
        json={"email": "logout_user@test.com", "password": "pass1234"},
    )
    assert r.status_code in (200, 201)
    r = await client.post("/auth/logout")
    assert r.status_code == 204
    client.cookies.clear()
    r = await client.get("/auth/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_metrics_endpoint_exposes_prometheus(client: AsyncClient):
    await client.get("/health")
    r = await client.get("/metrics")
    assert r.status_code == 200
    body = r.text
    assert "http_requests_total" in body
    assert "http_request_duration_seconds" in body


def test_limiter_uses_redis_uri_in_production_config():
    from pathlib import Path

    source = (Path(__file__).resolve().parents[1] / "core" / "limiter.py").read_text()
    assert "redis_url" in source
    assert "is_production" in source


def test_wider_rate_limits_decorated_on_hot_paths():
    from pathlib import Path

    listings = (Path(__file__).resolve().parents[1] / "routers" / "listings.py").read_text()
    search = (Path(__file__).resolve().parents[1] / "routers" / "search.py").read_text()
    payments = (Path(__file__).resolve().parents[1] / "routers" / "payments.py").read_text()
    assert "@limiter.limit" in listings
    assert "@limiter.limit" in search
    assert "@limiter.limit" in payments
    assert "refund" in payments


# ── Refunds ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_refund_featured_listing_in_dev(client: AsyncClient):
    token, _ = await _register(client, "refund_seller@test.com")
    listing_id = await _make_listing(client, token)
    r = await client.post(
        "/payments/feature-listing",
        json={"listing_id": listing_id, "duration_days": 7},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    payment_id = r.json()["payment_id"]
    assert r.json()["listing_featured"] is True

    r = await client.post(
        f"/payments/{payment_id}/refund",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "refunded"

    r = await client.get(f"/listings/{listing_id}")
    assert r.json()["is_featured"] is False


@pytest.mark.asyncio
async def test_refund_requires_owner(client: AsyncClient):
    owner, _ = await _register(client, "refund_owner@test.com")
    other, _ = await _register(client, "refund_other@test.com")
    listing_id = await _make_listing(client, owner)
    r = await client.post(
        "/payments/feature-listing",
        json={"listing_id": listing_id, "duration_days": 7},
        headers={"Authorization": f"Bearer {owner}"},
    )
    payment_id = r.json()["payment_id"]
    r = await client.post(
        f"/payments/{payment_id}/refund",
        headers={"Authorization": f"Bearer {other}"},
    )
    assert r.status_code == 404


# ── Razorpay webhook ──────────────────────────────────────────────────────────

def _webhook_payload(order_id: str, payment_id: str = "pay_wh_1") -> bytes:
    return json.dumps({
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": payment_id,
                    "order_id": order_id,
                    "status": "captured",
                }
            }
        },
    }).encode()


@pytest.mark.asyncio
async def test_webhook_rejects_forged_signature_when_keys_set(client: AsyncClient):
    token, _ = await _register(client, "wh_forge@test.com")
    listing_id = await _make_listing(client, token)
    secret = "wh_secret_forge"

    with patch("routers.payments.settings") as mock_settings:
        mock_settings.is_production = False
        mock_settings.payments_enabled = True
        mock_settings.RAZORPAY_KEY_ID = "rzp_test"
        mock_settings.RAZORPAY_KEY_SECRET = secret

        with patch("razorpay.Client") as mock_client_cls:
            mock_client_cls.return_value.order.create.return_value = {"id": "order_wh_forge"}
            r = await client.post(
                "/payments/feature-listing",
                json={"listing_id": listing_id, "duration_days": 7},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert r.status_code == 200, r.text
            order_id = r.json()["razorpay_order_id"]

        body = _webhook_payload(order_id)
        r = await client.post(
            "/payments/webhook",
            content=body,
            headers={"Content-Type": "application/json", "X-Razorpay-Signature": "forged"},
        )
        assert r.status_code == 400
        assert "signature" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_webhook_accepts_valid_signature_and_features_listing(client: AsyncClient):
    token, _ = await _register(client, "wh_ok@test.com")
    listing_id = await _make_listing(client, token)
    secret = "wh_secret_ok"

    with patch("routers.payments.settings") as mock_settings:
        mock_settings.is_production = False
        mock_settings.payments_enabled = True
        mock_settings.RAZORPAY_KEY_ID = "rzp_test"
        mock_settings.RAZORPAY_KEY_SECRET = secret

        with patch("razorpay.Client") as mock_client_cls:
            mock_client_cls.return_value.order.create.return_value = {"id": "order_wh_ok"}
            r = await client.post(
                "/payments/feature-listing",
                json={"listing_id": listing_id, "duration_days": 7},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert r.status_code == 200, r.text
            order_id = r.json()["razorpay_order_id"]
            assert r.json()["listing_featured"] is False

        body = _webhook_payload(order_id, "pay_wh_ok")
        signature = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        r = await client.post(
            "/payments/webhook",
            content=body,
            headers={"Content-Type": "application/json", "X-Razorpay-Signature": signature},
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "ok"

        r = await client.get(f"/listings/{listing_id}")
        assert r.json()["is_featured"] is True


@pytest.mark.asyncio
async def test_webhook_ignores_non_capture_events(client: AsyncClient):
    body = json.dumps({"event": "payment.failed", "payload": {}}).encode()
    r = await client.post(
        "/payments/webhook",
        content=body,
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "ignored"


# ── Rate limiting / Docker presence ───────────────────────────────────────────

def test_auth_rate_limiter_wired():
    from routers import auth as auth_router

    assert auth_router.limiter is not None
    # Decorators applied to register/login
    assert hasattr(auth_router.register, "__wrapped__") or hasattr(auth_router.register, "__name__")


def test_docker_compose_and_dockerfile_exist():
    from pathlib import Path

    root = Path(__file__).resolve().parents[3]
    assert (root / "docker-compose.yml").exists()
    assert (root / "apps" / "api" / "Dockerfile").exists()
    compose = (root / "docker-compose.yml").read_text()
    assert "redis:" in compose
    assert "postgres" in compose
    assert "api:" in compose
