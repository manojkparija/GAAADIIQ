"""Tests for insurance router (MOB-013, MOB-022)."""
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from db.session import get_db
from main import app


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


@pytest.mark.asyncio
async def test_insurance_quotes_requires_consent(client: AsyncClient):
    resp = await client.post("/insurance/quotes", json={
        "vehicle_make": "Tata",
        "vehicle_model": "Nexon",
        "year": 2022,
        "fuel_type": "petrol",
        "idv": 700000,
        "phone": "+919876543210",
        "consent": False,
    })
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_insurance_quotes_returns_sorted_quotes(client: AsyncClient):
    resp = await client.post("/insurance/quotes", json={
        "vehicle_make": "Tata",
        "vehicle_model": "Nexon",
        "year": 2022,
        "fuel_type": "petrol",
        "idv": 700000,
        "phone": "+919876543210",
        "consent": True,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "quotes" in data
    assert len(data["quotes"]) >= 1
    # Quotes should be sorted by premium (ascending)
    premiums = [q["premium_pa"] for q in data["quotes"]]
    assert premiums == sorted(premiums)


@pytest.mark.asyncio
async def test_insurance_quotes_ev_discount(client: AsyncClient):
    """EV quotes should have lower premiums than equivalent petrol."""
    base_payload = {
        "vehicle_make": "Tata",
        "vehicle_model": "Nexon",
        "year": 2023,
        "idv": 1500000,
        "phone": "+919876543210",
        "consent": True,
    }
    ev_resp = await client.post("/insurance/quotes", json={**base_payload, "fuel_type": "electric"})
    petrol_resp = await client.post("/insurance/quotes", json={**base_payload, "fuel_type": "petrol"})

    assert ev_resp.status_code == 200
    assert petrol_resp.status_code == 200

    ev_min = min(q["premium_pa"] for q in ev_resp.json()["quotes"] if q["plan_type"] == "comprehensive")
    petrol_min = min(q["premium_pa"] for q in petrol_resp.json()["quotes"] if q["plan_type"] == "comprehensive")
    assert ev_min < petrol_min


@pytest.mark.asyncio
async def test_insurance_invalid_fuel_type(client: AsyncClient):
    resp = await client.post("/insurance/quotes", json={
        "vehicle_make": "Tata",
        "vehicle_model": "Nexon",
        "year": 2022,
        "fuel_type": "steam",
        "idv": 700000,
        "phone": "+919876543210",
        "consent": True,
    })
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_insurance_invalid_phone(client: AsyncClient):
    resp = await client.post("/insurance/quotes", json={
        "vehicle_make": "Tata",
        "vehicle_model": "Nexon",
        "year": 2022,
        "fuel_type": "petrol",
        "idv": 700000,
        "phone": "+14155551234",  # US number
        "consent": True,
    })
    assert resp.status_code == 422
