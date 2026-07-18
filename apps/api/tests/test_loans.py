"""
Tests for EMI calculator and loan inquiry endpoints.
"""
import math

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


async def _register_token(client: AsyncClient, email: str) -> str:
    r = await client.post("/auth/register", json={"email": email, "password": "password123"})
    return r.json()["access_token"]


async def _make_listing(client: AsyncClient, token: str) -> str:
    car = await client.post("/cars", json={
        "make": "Honda", "model": "City", "year": 2022,
        "fuel_type": "petrol", "transmission": "automatic", "body_type": "sedan",
    }, headers={"Authorization": f"Bearer {token}"})
    listing = await client.post("/listings", json={
        "car_id": car.json()["id"], "listing_type": "used",
        "price": 800000, "km_driven": 20000, "owners_count": 1,
        "condition": "excellent", "city": "Hyderabad",
    }, headers={"Authorization": f"Bearer {token}"})
    return listing.json()["id"]


# ── EMI calculator tests ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_emi_basic_calculation(client: AsyncClient):
    """Verify EMI formula: P=500000, r=10% pa, n=60 months → ~₹10624/month."""
    resp = await client.get(
        "/loans/emi-calculator?principal=500000&annual_rate=10&tenure_months=60"
    )
    assert resp.status_code == 200
    data = resp.json()
    # Expected: 500000 * (10/1200) * (1 + 10/1200)^60 / ((1 + 10/1200)^60 - 1)
    r = 10 / 1200
    n = 60
    expected = 500000 * r * math.pow(1 + r, n) / (math.pow(1 + r, n) - 1)
    assert abs(data["monthly_emi"] - round(expected, 2)) < 1


@pytest.mark.asyncio
async def test_emi_total_payment(client: AsyncClient):
    resp = await client.get(
        "/loans/emi-calculator?principal=1000000&annual_rate=9&tenure_months=84"
    )
    assert resp.status_code == 200
    data = resp.json()
    # total_payment should equal monthly_emi * tenure_months (within rounding)
    assert abs(data["total_payment"] - data["monthly_emi"] * 84) < 2


@pytest.mark.asyncio
async def test_emi_interest_non_negative(client: AsyncClient):
    resp = await client.get(
        "/loans/emi-calculator?principal=300000&annual_rate=8.5&tenure_months=36"
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_interest"] > 0
    assert data["total_interest"] == round(data["total_payment"] - data["principal"], 2)


@pytest.mark.asyncio
async def test_emi_down_payment_20pct(client: AsyncClient):
    resp = await client.get(
        "/loans/emi-calculator?principal=2000000&annual_rate=10&tenure_months=60"
    )
    assert resp.status_code == 200
    assert resp.json()["down_payment_20pct"] == 400000.0


@pytest.mark.asyncio
async def test_emi_invalid_params(client: AsyncClient):
    # negative principal
    r1 = await client.get("/loans/emi-calculator?principal=-1&annual_rate=10&tenure_months=60")
    assert r1.status_code == 422

    # rate > 50%
    r2 = await client.get("/loans/emi-calculator?principal=500000&annual_rate=51&tenure_months=60")
    assert r2.status_code == 422

    # tenure < 6 months
    r3 = await client.get("/loans/emi-calculator?principal=500000&annual_rate=10&tenure_months=3")
    assert r3.status_code == 422


@pytest.mark.asyncio
async def test_emi_no_auth_required(client: AsyncClient):
    """EMI calculator is public — no token needed."""
    resp = await client.get(
        "/loans/emi-calculator?principal=500000&annual_rate=10&tenure_months=60"
    )
    assert resp.status_code == 200


# ── Loan inquiry tests ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_loan_inquiry(client: AsyncClient):
    seller_token = await _register_token(client, "lseller1@test.com")
    buyer_token = await _register_token(client, "lbuyer1@test.com")
    listing_id = await _make_listing(client, seller_token)

    resp = await client.post("/loans/inquiries", json={
        "listing_id": listing_id,
        "loan_amount": 640000,
        "tenure_months": 60,
        "employment_type": "salaried",
        "annual_income": 800000,
    }, headers={"Authorization": f"Bearer {buyer_token}"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["listing_id"] == listing_id
    assert data["status"] == "submitted"
    assert data["loan_amount"] == 640000.0


@pytest.mark.asyncio
async def test_create_loan_inquiry_requires_auth(client: AsyncClient):
    seller_token = await _register_token(client, "lseller2@test.com")
    listing_id = await _make_listing(client, seller_token)

    client.cookies.clear()  # remove session cookie so the request is truly unauthenticated
    resp = await client.post("/loans/inquiries", json={
        "listing_id": listing_id, "loan_amount": 500000,
        "tenure_months": 48, "employment_type": "salaried", "annual_income": 600000,
    })
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_create_loan_inquiry_invalid_listing(client: AsyncClient):
    token = await _register_token(client, "lbuyer2@test.com")
    resp = await client.post("/loans/inquiries", json={
        "listing_id": "00000000-0000-0000-0000-000000000000",
        "loan_amount": 500000, "tenure_months": 48,
        "employment_type": "salaried", "annual_income": 600000,
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_list_my_loan_inquiries(client: AsyncClient):
    seller_token = await _register_token(client, "lseller3@test.com")
    buyer_token = await _register_token(client, "lbuyer3@test.com")
    listing_id = await _make_listing(client, seller_token)

    await client.post("/loans/inquiries", json={
        "listing_id": listing_id, "loan_amount": 500000,
        "tenure_months": 48, "employment_type": "self_employed", "annual_income": 1200000,
    }, headers={"Authorization": f"Bearer {buyer_token}"})

    resp = await client.get("/loans/inquiries", headers={"Authorization": f"Bearer {buyer_token}"})
    assert resp.status_code == 200
    assert len(resp.json()) == 1


@pytest.mark.asyncio
async def test_received_loan_inquiries_seller_view(client: AsyncClient):
    seller_token = await _register_token(client, "lseller4@test.com")
    buyer_token = await _register_token(client, "lbuyer4@test.com")
    other_token = await _register_token(client, "lother1@test.com")
    listing_id = await _make_listing(client, seller_token)

    await client.post("/loans/inquiries", json={
        "listing_id": listing_id, "loan_amount": 700000,
        "tenure_months": 72, "employment_type": "business", "annual_income": 2000000,
    }, headers={"Authorization": f"Bearer {buyer_token}"})

    seller_resp = await client.get(
        "/loans/inquiries/received",
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert seller_resp.status_code == 200
    assert len(seller_resp.json()) == 1

    other_resp = await client.get(
        "/loans/inquiries/received",
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert len(other_resp.json()) == 0


@pytest.mark.asyncio
async def test_get_single_loan_inquiry(client: AsyncClient):
    seller_token = await _register_token(client, "lseller5@test.com")
    buyer_token = await _register_token(client, "lbuyer5@test.com")
    listing_id = await _make_listing(client, seller_token)

    created = await client.post("/loans/inquiries", json={
        "listing_id": listing_id, "loan_amount": 500000,
        "tenure_months": 60, "employment_type": "salaried", "annual_income": 900000,
    }, headers={"Authorization": f"Bearer {buyer_token}"})
    inquiry_id = created.json()["id"]

    resp = await client.get(
        f"/loans/inquiries/{inquiry_id}",
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == inquiry_id


@pytest.mark.asyncio
async def test_get_inquiry_wrong_user_404(client: AsyncClient):
    seller_token = await _register_token(client, "lseller6@test.com")
    buyer_token = await _register_token(client, "lbuyer6@test.com")
    other_token = await _register_token(client, "lother2@test.com")
    listing_id = await _make_listing(client, seller_token)

    created = await client.post("/loans/inquiries", json={
        "listing_id": listing_id, "loan_amount": 400000,
        "tenure_months": 48, "employment_type": "salaried", "annual_income": 700000,
    }, headers={"Authorization": f"Bearer {buyer_token}"})
    inquiry_id = created.json()["id"]

    resp = await client.get(
        f"/loans/inquiries/{inquiry_id}",
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert resp.status_code == 404
