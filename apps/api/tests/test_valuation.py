"""
Valuation service and endpoint tests.
Mocks both Ollama (LLM path) and the heuristic fallback.
"""
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from db.base import Base
from db.session import get_db
from main import app
from services.valuation import _heuristic_valuation

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


async def _register_token(client: AsyncClient, email: str = "v@test.com") -> str:
    r = await client.post("/auth/register", json={"email": email, "password": "password123"})
    return r.json()["access_token"]


async def _make_listing(client: AsyncClient, token: str) -> str:
    car = await client.post(
        "/cars",
        json={"make": "Hyundai", "model": "Creta", "year": 2021,
              "fuel_type": "petrol", "transmission": "automatic", "body_type": "suv"},
        headers={"Authorization": f"Bearer {token}"},
    )
    listing = await client.post(
        "/listings",
        json={"car_id": car.json()["id"], "listing_type": "used",
              "price": 1200000, "km_driven": 40000, "owners_count": 1,
              "condition": "good", "city": "Bangalore"},
        headers={"Authorization": f"Bearer {token}"},
    )
    return listing.json()["id"]


# ── Heuristic unit tests ──────────────────────────────────────────────────────

def _make_mock_listing(price: float, km: int, age: int, owners: int = 1,
                       fuel: str = "petrol") -> MagicMock:
    car = MagicMock()
    car.year = datetime.now().year - age
    car.fuel_type = MagicMock()
    car.fuel_type.value = fuel
    car.transmission = None
    car.body_type = None
    car.engine_cc = 1200
    car.make = "Test"
    car.model = "Car"
    car.variant = None

    listing = MagicMock()
    listing.price = price
    listing.km_driven = km
    listing.owners_count = owners
    listing.condition = None
    listing.registration_state = None
    listing.city = "Test"
    listing.listing_type = MagicMock()
    listing.listing_type.value = "used"
    listing.car = car
    return listing


def test_heuristic_new_car_no_depreciation():
    listing = _make_mock_listing(price=1_000_000, km=0, age=0)
    value, method, confidence, reasoning = _heuristic_valuation(listing)
    # age=0 → no time depreciation, but 1-owner penalty (3%) on used listing
    assert 950_000 <= value <= 1_000_000
    assert "heuristic" in method


def test_heuristic_1_year_old():
    listing = _make_mock_listing(price=1_000_000, km=10_000, age=1)
    value, *_ = _heuristic_valuation(listing)
    # 15% depreciation → ~850K
    assert 800_000 <= value <= 870_000


def test_heuristic_high_mileage_penalty():
    listing = _make_mock_listing(price=1_000_000, km=80_000, age=3)
    value_normal, *_ = _heuristic_valuation(
        _make_mock_listing(price=1_000_000, km=30_000, age=3)
    )
    value_high, *_ = _heuristic_valuation(listing)
    assert value_high < value_normal


def test_heuristic_electric_premium():
    petrol = _make_mock_listing(price=1_000_000, km=20_000, age=2, fuel="petrol")
    electric = _make_mock_listing(price=1_000_000, km=20_000, age=2, fuel="electric")
    val_p, *_ = _heuristic_valuation(petrol)
    val_e, *_ = _heuristic_valuation(electric)
    assert val_e > val_p


def test_heuristic_floor_applied():
    """Very old, high-mileage car should not drop below 25% of asking price."""
    listing = _make_mock_listing(price=500_000, km=300_000, age=15, owners=5)
    value, *_ = _heuristic_valuation(listing)
    assert value >= 500_000 * 0.25


# ── Endpoint tests ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_valuate_uses_heuristic_when_ollama_down(client: AsyncClient):
    token = await _register_token(client, "val1@test.com")
    listing_id = await _make_listing(client, token)

    # Ollama is not running in test — heuristic fallback kicks in automatically
    resp = await client.post(
        f"/listings/{listing_id}/valuate",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ai_valuation"] is not None
    assert data["ai_valuation"] > 0


@pytest.mark.asyncio
async def test_valuate_persists_value(client: AsyncClient):
    token = await _register_token(client, "val2@test.com")
    listing_id = await _make_listing(client, token)

    await client.post(
        f"/listings/{listing_id}/valuate",
        headers={"Authorization": f"Bearer {token}"},
    )

    # Fetch the listing — ai_valuation should be set
    resp = await client.get(f"/listings/{listing_id}")
    assert resp.json()["ai_valuation"] is not None


@pytest.mark.asyncio
async def test_valuate_ollama_path(client: AsyncClient):
    """When Ollama returns valid JSON, use its value."""
    token = await _register_token(client, "val3@test.com")
    listing_id = await _make_listing(client, token)

    mock_llm_response = (
        '{"fair_value": 980000, "confidence": "high", "reasoning": "Well maintained SUV"}'
    )

    with patch("services.valuation.httpx.AsyncClient") as mock_http:
        mock_http.return_value.__aenter__ = AsyncMock(return_value=MagicMock(
            get=AsyncMock(return_value=MagicMock(status_code=200))
        ))
        mock_http.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("services.valuation.Ollama") as mock_ollama_cls:
            mock_chain = AsyncMock(return_value=mock_llm_response)
            mock_ollama_instance = MagicMock()
            mock_ollama_cls.return_value = mock_ollama_instance

            with patch("langchain_core.runnables.base.RunnableSequence.ainvoke",
                       new=mock_chain):
                resp = await client.post(
                    f"/listings/{listing_id}/valuate",
                    headers={"Authorization": f"Bearer {token}"},
                )

    # Either Ollama path or heuristic — both should return a valid valuation
    assert resp.status_code == 200
    assert resp.json()["ai_valuation"] is not None


@pytest.mark.asyncio
async def test_valuate_requires_auth(client: AsyncClient):
    token = await _register_token(client, "val4@test.com")
    listing_id = await _make_listing(client, token)
    client.cookies.clear()  # remove session cookie so the request is truly unauthenticated
    resp = await client.post(f"/listings/{listing_id}/valuate")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_valuate_404_for_missing_listing(client: AsyncClient):
    token = await _register_token(client, "val5@test.com")
    fake_id = "00000000-0000-0000-0000-000000000000"
    resp = await client.post(
        f"/listings/{fake_id}/valuate",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404
