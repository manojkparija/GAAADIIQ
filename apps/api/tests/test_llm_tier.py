"""
Model tier selection tests.

Free users are served by Ollama; paid subscribers and admins get Gemini Flash.
The two properties that matter:

  1. The tier cannot be self-selected — it is resolved from the caller's role
     and subscription, never from the request body.
  2. Every failure degrades downward. Gemini → Ollama → heuristic. A paid user
     may get a worse answer; they must never get no answer.
"""
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.config import settings
from db.session import get_db
from main import app
from models.subscription import Subscription, SubscriptionTier
from models.user import User, UserRole
from services.diagnosis import _call_gemini, run_diagnosis
from services.llm_tier import ModelTier, gemini_available, resolve_tier
from tests.test_diagnosis import OLLAMA_DIAGNOSIS, VALID_PAYLOAD, _mock_ollama


@pytest_asyncio.fixture
async def session_factory(db_engine):
    return async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)


@pytest_asyncio.fixture
async def db(session_factory):
    async with session_factory() as s:
        yield s


@pytest_asyncio.fixture
async def client(db_engine, session_factory):
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


@pytest.fixture
def gemini_on(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    monkeypatch.setattr(settings, "gemini_model", "gemini-2.0-flash")
    yield


def _gemini_response(payload: dict):
    """Mock a Gemini generateContent response wrapping `payload` as JSON text."""
    import json as _json
    from unittest.mock import AsyncMock, MagicMock

    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json = MagicMock(return_value={
        "candidates": [{"content": {"parts": [{"text": _json.dumps(payload)}]}}]
    })
    cm = AsyncMock()
    cm.__aenter__.return_value.post = AsyncMock(return_value=resp)
    cm.__aexit__.return_value = False
    return cm


async def _make_user(db, *, role=UserRole.buyer, tier=None, valid_until=None) -> uuid.UUID:
    user = User(
        email=f"{uuid.uuid4().hex[:8]}@test.com",
        hashed_password="x",
        role=role,
    )
    db.add(user)
    await db.flush()
    if tier is not None:
        db.add(Subscription(user_id=user.id, tier=tier, valid_until=valid_until))
        await db.flush()
    await db.commit()
    return user.id


class TestTierResolutionSuite:
    @pytest.mark.asyncio
    async def test_anonymous_gets_free(self, db, gemini_on):
        assert await resolve_tier(db, None) is ModelTier.free

    @pytest.mark.asyncio
    async def test_free_user_gets_free(self, db, gemini_on):
        uid = await _make_user(db, tier=SubscriptionTier.free)
        assert await resolve_tier(db, uid) is ModelTier.free

    @pytest.mark.asyncio
    async def test_user_without_subscription_gets_free(self, db, gemini_on):
        uid = await _make_user(db)
        assert await resolve_tier(db, uid) is ModelTier.free

    @pytest.mark.asyncio
    async def test_pro_subscriber_gets_premium(self, db, gemini_on):
        uid = await _make_user(db, tier=SubscriptionTier.pro)
        assert await resolve_tier(db, uid) is ModelTier.premium

    @pytest.mark.asyncio
    async def test_dealer_subscriber_gets_premium(self, db, gemini_on):
        uid = await _make_user(db, tier=SubscriptionTier.dealer)
        assert await resolve_tier(db, uid) is ModelTier.premium

    @pytest.mark.asyncio
    async def test_admin_gets_premium_without_a_subscription(self, db, gemini_on):
        uid = await _make_user(db, role=UserRole.admin)
        assert await resolve_tier(db, uid) is ModelTier.premium

    @pytest.mark.asyncio
    async def test_expired_subscription_is_free(self, db, gemini_on):
        past = datetime.now(timezone.utc) - timedelta(days=1)
        uid = await _make_user(db, tier=SubscriptionTier.pro, valid_until=past)
        assert await resolve_tier(db, uid) is ModelTier.free

    @pytest.mark.asyncio
    async def test_unexpired_subscription_is_premium(self, db, gemini_on):
        future = datetime.now(timezone.utc) + timedelta(days=30)
        uid = await _make_user(db, tier=SubscriptionTier.pro, valid_until=future)
        assert await resolve_tier(db, uid) is ModelTier.premium

    @pytest.mark.asyncio
    async def test_no_gemini_key_means_everyone_is_free(self, db, monkeypatch):
        # Without a key the premium path cannot work, so nobody is routed to it.
        monkeypatch.setattr(settings, "gemini_api_key", "")
        uid = await _make_user(db, role=UserRole.admin, tier=SubscriptionTier.pro)
        assert await resolve_tier(db, uid) is ModelTier.free
        assert gemini_available() is False

    @pytest.mark.asyncio
    async def test_unknown_user_id_is_free(self, db, gemini_on):
        assert await resolve_tier(db, uuid.uuid4()) is ModelTier.free

    @pytest.mark.asyncio
    async def test_lookup_failure_degrades_to_free(self, db, gemini_on):
        # A tier lookup error must never deny someone a diagnosis.
        with patch.object(db, "execute", side_effect=Exception("db down")):
            assert await resolve_tier(db, uuid.uuid4()) is ModelTier.free


class TestGeminiCallSuite:
    @pytest.mark.asyncio
    async def test_parses_a_valid_response(self, gemini_on):
        with patch("httpx.AsyncClient", return_value=_gemini_response(OLLAMA_DIAGNOSIS)):
            result = await _call_gemini("prompt")
        assert result["preliminary_diagnosis"] == OLLAMA_DIAGNOSIS["preliminary_diagnosis"]

    @pytest.mark.asyncio
    async def test_no_candidates_raises(self, gemini_on):
        from unittest.mock import AsyncMock, MagicMock
        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        resp.json = MagicMock(return_value={"candidates": []})
        cm = AsyncMock()
        cm.__aenter__.return_value.post = AsyncMock(return_value=resp)
        cm.__aexit__.return_value = False
        with patch("httpx.AsyncClient", return_value=cm):
            with pytest.raises(Exception):
                await _call_gemini("prompt")

    @pytest.mark.asyncio
    async def test_empty_text_raises(self, gemini_on):
        from unittest.mock import AsyncMock, MagicMock
        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        resp.json = MagicMock(return_value={
            "candidates": [{"content": {"parts": [{"text": ""}]}}]
        })
        cm = AsyncMock()
        cm.__aenter__.return_value.post = AsyncMock(return_value=resp)
        cm.__aexit__.return_value = False
        with patch("httpx.AsyncClient", return_value=cm):
            with pytest.raises(Exception):
                await _call_gemini("prompt")


class TestTieredDiagnosisSuite:
    _ARGS = dict(
        manufacturer="Maruti Suzuki", model="Swift", variant=None, model_year=2022,
        fuel_type="Petrol", transmission="Manual", odometer_km=45000,
        problem_description="Knocking sound when accelerating hard uphill",
        warning_lights=[], when_occurs=[], severity="high",
    )

    @pytest.mark.asyncio
    async def test_free_tier_uses_ollama(self, gemini_on):
        with patch("services.diagnosis._call_gemini") as gem:
            with patch("httpx.AsyncClient", return_value=_mock_ollama(OLLAMA_DIAGNOSIS)):
                r = await run_diagnosis(**self._ARGS, model_tier="free")
        gem.assert_not_called()
        assert r["engine"] == "ollama"
        assert r["model_tier"] == "free"

    @pytest.mark.asyncio
    async def test_premium_tier_uses_gemini(self, gemini_on):
        premium = dict(OLLAMA_DIAGNOSIS, preliminary_diagnosis="Gemini analysis")
        with patch("httpx.AsyncClient", return_value=_gemini_response(premium)):
            r = await run_diagnosis(**self._ARGS, model_tier="premium")
        assert r["engine"] == "gemini"
        assert r["preliminary_diagnosis"] == "Gemini analysis"

    @pytest.mark.asyncio
    async def test_gemini_failure_falls_back_to_ollama(self, gemini_on):
        # The paid user gets a slightly worse answer, never no answer.
        with patch("services.diagnosis._call_gemini", side_effect=Exception("gemini 500")):
            with patch("httpx.AsyncClient", return_value=_mock_ollama(OLLAMA_DIAGNOSIS)):
                r = await run_diagnosis(**self._ARGS, model_tier="premium")
        assert r["engine"] == "ollama"
        assert r["preliminary_diagnosis"] == OLLAMA_DIAGNOSIS["preliminary_diagnosis"]

    @pytest.mark.asyncio
    async def test_both_engines_down_falls_back_to_heuristic(self, gemini_on):
        with patch("services.diagnosis._call_gemini", side_effect=Exception("gemini down")):
            with patch("httpx.AsyncClient", side_effect=httpx.TimeoutException("ollama down")):
                r = await run_diagnosis(**self._ARGS, model_tier="premium")
        assert r["engine"] == "heuristic"
        assert r["preliminary_diagnosis"]
        assert r["disclaimer"]

    @pytest.mark.asyncio
    async def test_premium_result_still_gets_safety_normalisation(self, gemini_on):
        # Gemini output goes through the same follow-up gating as Ollama.
        low = dict(OLLAMA_DIAGNOSIS, analysis_confidence=30, follow_up_questions=[])
        with patch("httpx.AsyncClient", return_value=_gemini_response(low)):
            r = await run_diagnosis(**self._ARGS, model_tier="premium")
        assert r["needs_more_info"] is True
        assert r["follow_up_questions"]

    @pytest.mark.asyncio
    async def test_default_tier_is_free(self, gemini_on):
        with patch("services.diagnosis._call_gemini") as gem:
            with patch("httpx.AsyncClient", return_value=_mock_ollama(OLLAMA_DIAGNOSIS)):
                await run_diagnosis(**self._ARGS)
        gem.assert_not_called()


class TestTierCannotBeSelfSelectedSuite:
    @pytest.mark.asyncio
    async def test_anonymous_request_is_served_free(self, client, gemini_on):
        with patch("services.diagnosis._call_gemini") as gem:
            with patch("httpx.AsyncClient", return_value=_mock_ollama(OLLAMA_DIAGNOSIS)):
                r = await client.post("/diagnosis/analyse", json=VALID_PAYLOAD)
        assert r.status_code == 201
        assert r.json()["model_tier"] == "free"
        gem.assert_not_called()

    @pytest.mark.asyncio
    async def test_request_body_cannot_request_premium(self, client, gemini_on):
        # An unknown field must not influence routing.
        payload = {**VALID_PAYLOAD, "model_tier": "premium", "engine": "gemini"}
        with patch("services.diagnosis._call_gemini") as gem:
            with patch("httpx.AsyncClient", return_value=_mock_ollama(OLLAMA_DIAGNOSIS)):
                r = await client.post("/diagnosis/analyse", json=payload)
        assert r.status_code == 201
        assert r.json()["model_tier"] == "free"
        gem.assert_not_called()

    @pytest.mark.asyncio
    async def test_paid_user_is_routed_to_premium(self, client, db, gemini_on):
        uid = await _make_user(db, tier=SubscriptionTier.pro)
        premium = dict(OLLAMA_DIAGNOSIS, preliminary_diagnosis="Gemini analysis")
        with patch("httpx.AsyncClient", return_value=_gemini_response(premium)):
            r = await client.post(
                "/diagnosis/analyse", json={**VALID_PAYLOAD, "user_id": str(uid)}
            )
        assert r.status_code == 201
        body = r.json()
        assert body["model_tier"] == "premium"
        assert body["engine"] == "gemini"
