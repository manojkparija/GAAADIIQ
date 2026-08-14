"""POST /valuation/estimate — the endpoint that replaced a browser-to-Anthropic call.

The `list-car` page used to invoke a Supabase Edge Function directly, which held
its own ANTHROPIC_API_KEY and bypassed the Gemini gateway. These tests pin the
properties that made moving it worthwhile: one provider, one gateway, and no
invented number when the model cannot answer.
"""

from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from db.session import get_db
from main import app
from services import gemini_gateway

pytestmark = pytest.mark.asyncio

ESTIMATE = "/valuation/estimate"

BODY = {
    "make": "Maruti Suzuki", "model": "Swift", "variant": "VXi",
    "year": 2019, "km": 62000, "fuel": "Petrol",
    "transmission": "Manual", "owners": 1, "condition": "Good",
}

GOOD_JSON = (
    '{"low": 420000, "mid": 485000, "high": 545000, "confidence": 90, '
    '"depreciation": 42, "marketTrend": "Steady demand for petrol hatchbacks", '
    '"tips": ["Service records raise the price", "Fix minor dents first"]}'
)


@pytest_asyncio.fixture
async def client(db_session):
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    limiter_was = app.state.limiter.enabled
    app.state.limiter.enabled = False
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c
    app.dependency_overrides.clear()
    app.state.limiter.enabled = limiter_was


async def test_valuation_returns_a_range(client):
    with patch.object(gemini_gateway, "is_available", return_value=True), \
         patch.object(gemini_gateway, "generate_text", return_value=GOOD_JSON):
        r = await client.post(ESTIMATE, json=BODY)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["low"] < d["mid"] < d["high"]
    assert d["method"] == "gemini"
    assert len(d["tips"]) == 2


async def test_valuation_goes_through_the_gateway(client):
    """The point of the change: one door to the model, with `caller` recorded."""
    with patch.object(gemini_gateway, "is_available", return_value=True), \
         patch.object(gemini_gateway, "generate_text", return_value=GOOD_JSON) as gen:
        await client.post(ESTIMATE, json=BODY)
    assert gen.call_count == 1
    assert gen.call_args.kwargs["caller"] == "valuation"


async def test_no_model_means_503_not_a_made_up_number(client):
    """The client has a deterministic heuristic and will use it. A price this
    service did not compute must never be returned as though it had."""
    with patch.object(gemini_gateway, "is_available", return_value=False):
        r = await client.post(ESTIMATE, json=BODY)
    assert r.status_code == 503
    assert "not configured" in r.json()["detail"].lower()


async def test_unparseable_model_output_is_503(client):
    with patch.object(gemini_gateway, "is_available", return_value=True), \
         patch.object(gemini_gateway, "generate_text", return_value="sorry, I can't"):
        r = await client.post(ESTIMATE, json=BODY)
    assert r.status_code == 503


async def test_response_missing_mid_is_503(client):
    """A valuation without a price is not a valuation."""
    with patch.object(gemini_gateway, "is_available", return_value=True), \
         patch.object(gemini_gateway, "generate_text",
                      return_value='{"low": 1, "high": 2}'):
        r = await client.post(ESTIMATE, json=BODY)
    assert r.status_code == 503


async def test_markdown_fences_are_tolerated(client):
    """The prompt says no fences; models emit them anyway."""
    with patch.object(gemini_gateway, "is_available", return_value=True), \
         patch.object(gemini_gateway, "generate_text",
                      return_value=f"```json\n{GOOD_JSON}\n```"):
        r = await client.post(ESTIMATE, json=BODY)
    assert r.status_code == 200
    assert r.json()["mid"] == 485000


@pytest.mark.parametrize(
    "override",
    [
        {"fuel": "Kerosene"},
        {"year": 1899},
        {"km": -1},
        {"condition": "Immaculate"},
        {"make": ""},
        {"owners": 0},
    ],
)
async def test_invalid_input_is_refused(client, override):
    with patch.object(gemini_gateway, "is_available", return_value=True):
        r = await client.post(ESTIMATE, json={**BODY, **override})
    assert r.status_code == 422


async def test_no_authentication_required(client):
    """Finding out what a car is worth must not require an account — it is the
    first thing a seller does."""
    with patch.object(gemini_gateway, "is_available", return_value=True), \
         patch.object(gemini_gateway, "generate_text", return_value=GOOD_JSON):
        r = await client.post(ESTIMATE, json=BODY)
    assert r.status_code == 200
