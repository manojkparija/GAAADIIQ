"""Tests for the customer sentiment / purchase intent API."""
from unittest.mock import AsyncMock, patch

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


async def _register_and_token(client: AsyncClient, email: str, role: str = "dealer") -> tuple[str, str]:
    """Register a user, optionally upgrade to dealer, return (token, user_id)."""
    resp = await client.post("/auth/register", json={"email": email, "password": "pass1234"})
    assert resp.status_code in (200, 201), resp.text
    data = resp.json()
    token = data["access_token"]
    user_id = data["user"]["id"]

    if role == "dealer":
        r = await client.post(
            "/dealers/register",
            json={"business_name": "Test Motors", "city": "Mumbai", "state": "Maharashtra"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code in (200, 201), r.text

    return token, user_id


async def _register_buyer(client: AsyncClient, email: str) -> str:
    resp = await client.post("/auth/register", json={"email": email, "password": "pass1234"})
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["user"]["id"]


# ── Tests ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_summary_empty_dealer(client):
    """Dealer with no leads gets a zero summary."""
    token, _ = await _register_and_token(client, "dealer_empty@test.com")
    resp = await client.get("/sentiment/summary", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_leads"] == 0
    assert data["hot_leads"] == 0


@pytest.mark.asyncio
async def test_leads_empty(client):
    """Leads list is empty for a new dealer."""
    token, _ = await _register_and_token(client, "dealer_leads@test.com")
    resp = await client.get("/sentiment/leads", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_track_activity(client):
    """Dealer can track a buyer activity event."""
    token, _ = await _register_and_token(client, "dealer_track@test.com")
    buyer_id = await _register_buyer(client, "buyer_track@test.com")

    resp = await client.post(
        "/sentiment/track",
        json={
            "user_id": buyer_id,
            "activity_type": "listing_view",
            "duration_seconds": 120,
            "metadata": {"car": "Maruti Swift"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201
    assert resp.json()["status"] == "tracked"


@pytest.mark.asyncio
async def test_analyse_heuristic_fallback(client):
    """
    analyse endpoint returns a valid intent score using heuristic fallback
    (Ollama unavailable in test environment).
    """
    token, _ = await _register_and_token(client, "dealer_analyse@test.com")
    buyer_id = await _register_buyer(client, "buyer_analyse@test.com")

    # Track some activity first
    await client.post(
        "/sentiment/track",
        json={"user_id": buyer_id, "activity_type": "enquiry", "metadata": {"notes": "Interested in Creta"}},
        headers={"Authorization": f"Bearer {token}"},
    )

    # Patch Ollama to simulate unavailability
    with patch("services.sentiment._call_ollama", new=AsyncMock(return_value=None)):
        resp = await client.post(
            f"/sentiment/analyse/{buyer_id}",
            json={"customer_name": "Test Buyer"},
            headers={"Authorization": f"Bearer {token}"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert 0 <= data["intent_score"] <= 100
    assert data["lead_grade"] in ("A", "B", "C", "D")
    assert data["next_best_action"] is not None
    assert data["ollama_used"] is False


@pytest.mark.asyncio
async def test_analyse_ollama_result(client):
    """analyse endpoint uses Ollama result when available."""
    token, _ = await _register_and_token(client, "dealer_ollama@test.com")
    buyer_id = await _register_buyer(client, "buyer_ollama@test.com")

    mock_llm_result = {
        "intent_score": 88,
        "lead_grade": "A",
        "engagement_score": 90,
        "urgency_score": 85,
        "budget_fit_score": 80,
        "sentiment_score": 92,
        "next_best_action": "Schedule test drive immediately",
        "best_contact_time": "Morning 10am-12pm",
        "predicted_purchase_window": "This week",
        "reasoning": "Customer has high engagement with 3 enquiries and a test drive request.",
    }

    with patch("services.sentiment._call_ollama", new=AsyncMock(return_value=mock_llm_result)):
        resp = await client.post(
            f"/sentiment/analyse/{buyer_id}",
            json={"customer_name": "Ollama Buyer"},
            headers={"Authorization": f"Bearer {token}"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["intent_score"] == 88
    assert data["lead_grade"] == "A"
    assert data["ollama_used"] is True
    assert "test drive" in data["next_best_action"].lower()


@pytest.mark.asyncio
async def test_get_lead_detail_not_found(client):
    """Returns 404 for a customer with no score."""
    token, _ = await _register_and_token(client, "dealer_detail@test.com")
    buyer_id = await _register_buyer(client, "buyer_detail@test.com")

    resp = await client.get(
        f"/sentiment/leads/{buyer_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_analyse_then_fetch_detail(client):
    """After analysing, the detail endpoint returns the stored score."""
    token, _ = await _register_and_token(client, "dealer_fetch@test.com")
    buyer_id = await _register_buyer(client, "buyer_fetch@test.com")

    with patch("services.sentiment._call_ollama", new=AsyncMock(return_value=None)):
        await client.post(
            f"/sentiment/analyse/{buyer_id}",
            json={"customer_name": "Fetch Buyer"},
            headers={"Authorization": f"Bearer {token}"},
        )

    resp = await client.get(
        f"/sentiment/leads/{buyer_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["user_id"] == buyer_id


@pytest.mark.asyncio
async def test_leads_appear_after_analyse(client):
    """After scoring a customer, they appear in /sentiment/leads."""
    token, _ = await _register_and_token(client, "dealer_list@test.com")
    buyer_id = await _register_buyer(client, "buyer_list@test.com")

    with patch("services.sentiment._call_ollama", new=AsyncMock(return_value=None)):
        await client.post(
            f"/sentiment/analyse/{buyer_id}",
            json={"customer_name": "List Buyer"},
            headers={"Authorization": f"Bearer {token}"},
        )

    resp = await client.get("/sentiment/leads", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    leads = resp.json()
    assert any(l["user_id"] == buyer_id for l in leads)


@pytest.mark.asyncio
async def test_summary_after_analyse(client):
    """Summary counts update after a customer is scored."""
    token, _ = await _register_and_token(client, "dealer_sum2@test.com")
    buyer_id = await _register_buyer(client, "buyer_sum2@test.com")

    with patch("services.sentiment._call_ollama", new=AsyncMock(return_value=None)):
        await client.post(
            f"/sentiment/analyse/{buyer_id}",
            json={"customer_name": "Sum Buyer"},
            headers={"Authorization": f"Bearer {token}"},
        )

    resp = await client.get("/sentiment/summary", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_leads"] == 1
    assert data["analysed_today"] == 1


@pytest.mark.asyncio
async def test_non_dealer_cannot_track(client):
    """A buyer (non-dealer) cannot call /sentiment/track."""
    resp = await client.post(
        "/auth/register", json={"email": "plain_buyer@test.com", "password": "pass1234"}
    )
    token = resp.json()["access_token"]
    buyer_id = resp.json()["user"]["id"]

    resp = await client.post(
        "/sentiment/track",
        json={"user_id": buyer_id, "activity_type": "listing_view"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403
