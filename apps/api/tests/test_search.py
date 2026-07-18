"""
Tests for full-text search, autocomplete, and similar listings.
Uses SQLite in-memory — search router detects dialect and uses LIKE fallback.
"""
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from db.session import get_db
from main import app

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture
async def client(db_engine):
    # Patch dialect detection so search router uses LIKE fallback
    import routers.search as search_mod
    search_mod._dialect_cache = "sqlite"

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
    search_mod._dialect_cache = None  # reset for other test files


async def _register_token(client: AsyncClient, email: str) -> str:
    r = await client.post("/auth/register", json={"email": email, "password": "password123"})
    return r.json()["access_token"]


async def _seed_listings(client: AsyncClient, token: str):
    """Create 3 listings: 2 Hyundai Creta (SUV petrol), 1 Maruti Swift (hatchback petrol)."""
    headers = {"Authorization": f"Bearer {token}"}

    creta1 = await client.post("/cars", json={
        "make": "Hyundai", "model": "Creta", "year": 2022,
        "fuel_type": "petrol", "transmission": "automatic", "body_type": "suv",
    }, headers=headers)
    creta2 = await client.post("/cars", json={
        "make": "Hyundai", "model": "Creta", "year": 2021,
        "fuel_type": "petrol", "transmission": "manual", "body_type": "suv",
    }, headers=headers)
    swift = await client.post("/cars", json={
        "make": "Maruti", "model": "Swift", "year": 2020,
        "fuel_type": "petrol", "transmission": "manual", "body_type": "hatchback",
    }, headers=headers)

    listings = []
    for car_id, city in [
        (creta1.json()["id"], "Bangalore"),
        (creta2.json()["id"], "Mumbai"),
        (swift.json()["id"], "Delhi"),
    ]:
        r = await client.post("/listings", json={
            "car_id": car_id, "listing_type": "used", "price": 1000000,
            "km_driven": 30000, "owners_count": 1, "condition": "good", "city": city,
        }, headers=headers)
        listings.append(r.json()["id"])
    return listings


# ── Search tests ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_search_by_make(client: AsyncClient):
    token = await _register_token(client, "s1@test.com")
    await _seed_listings(client, token)

    resp = await client.get("/search?q=Hyundai")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    assert all("Hyundai" in item["car"]["make"] for item in data["items"])


@pytest.mark.asyncio
async def test_search_by_model(client: AsyncClient):
    token = await _register_token(client, "s2@test.com")
    await _seed_listings(client, token)

    resp = await client.get("/search?q=Swift")
    assert resp.status_code == 200
    assert resp.json()["total"] == 1
    assert resp.json()["items"][0]["car"]["model"] == "Swift"


@pytest.mark.asyncio
async def test_search_by_city(client: AsyncClient):
    token = await _register_token(client, "s3@test.com")
    await _seed_listings(client, token)

    resp = await client.get("/search?q=Bangalore")
    assert resp.status_code == 200
    assert resp.json()["total"] == 1
    assert resp.json()["items"][0]["city"] == "Bangalore"


@pytest.mark.asyncio
async def test_search_no_results(client: AsyncClient):
    token = await _register_token(client, "s4@test.com")
    await _seed_listings(client, token)

    resp = await client.get("/search?q=BMW")
    assert resp.status_code == 200
    assert resp.json()["total"] == 0
    assert resp.json()["items"] == []


@pytest.mark.asyncio
async def test_search_pagination(client: AsyncClient):
    token = await _register_token(client, "s5@test.com")
    await _seed_listings(client, token)

    # "Hyundai" gives 2 total, page_size=1 → 1 item returned
    resp = await client.get("/search?q=Hyundai&page_size=1")
    assert resp.status_code == 200
    assert resp.json()["total"] == 2
    assert len(resp.json()["items"]) == 1


@pytest.mark.asyncio
async def test_search_missing_q(client: AsyncClient):
    resp = await client.get("/search")
    assert resp.status_code == 422


# ── Autocomplete tests ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_autocomplete_make_prefix(client: AsyncClient):
    token = await _register_token(client, "s6@test.com")
    await _seed_listings(client, token)

    resp = await client.get("/search/autocomplete?q=hyu")
    assert resp.status_code == 200
    suggestions = resp.json()["suggestions"]
    assert any("Hyundai" in s for s in suggestions)


@pytest.mark.asyncio
async def test_autocomplete_no_match(client: AsyncClient):
    token = await _register_token(client, "s7@test.com")
    await _seed_listings(client, token)

    resp = await client.get("/search/autocomplete?q=xyz")
    assert resp.status_code == 200
    assert resp.json()["suggestions"] == []


# ── Similar listings tests ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_similar_listings(client: AsyncClient):
    token = await _register_token(client, "s8@test.com")
    listing_ids = await _seed_listings(client, token)

    # Creta listing[0] is SUV petrol — similar should return Creta listing[1] (also SUV petrol)
    resp = await client.get(f"/listings/{listing_ids[0]}/similar")
    assert resp.status_code == 200
    similar = resp.json()
    assert len(similar) == 1
    assert similar[0]["id"] == listing_ids[1]


@pytest.mark.asyncio
async def test_similar_listings_empty(client: AsyncClient):
    token = await _register_token(client, "s9@test.com")
    listing_ids = await _seed_listings(client, token)

    # Swift (hatchback petrol) — no other hatchbacks in seed data
    resp = await client.get(f"/listings/{listing_ids[2]}/similar")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_similar_listings_404(client: AsyncClient):
    resp = await client.get("/listings/00000000-0000-0000-0000-000000000000/similar")
    assert resp.status_code == 404
