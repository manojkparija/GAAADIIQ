"""
Model tier selection tests.

Paid subscribers and admins get GPT-4o; everyone else gets Gemini Flash-Lite.
The three properties that matter:

  1. The tier cannot be self-selected — it is resolved from the caller's role
     and subscription, never from the request body.
  2. Every failure degrades downward. GPT-4o → Gemini → Ollama → heuristic. A
     paid user may get a worse answer; they must never get no answer.
  3. The free tier reaches a real model. It used to go straight to Ollama,
     whose host is unset in every deployed environment, which meant a free
     user who missed the knowledge base got the heuristic fallback.
"""
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.config import settings
from db.session import get_db
from main import app
from models.subscription import Subscription, SubscriptionTier
from models.user import User, UserRole
from services.diagnosis import _call_gemini, run_diagnosis
from services.llm_tier import (
    ModelTier,
    VerifiedCaller,
    gemini_available,
    resolve_tier,
    verify_caller,
)
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


def _caller(user_id=None, email=None, source="api") -> VerifiedCaller:
    return VerifiedCaller(user_id=user_id, email=email, source=source)


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
        assert await resolve_tier(db, _caller(uid)) is ModelTier.free

    @pytest.mark.asyncio
    async def test_user_without_subscription_gets_free(self, db, gemini_on):
        uid = await _make_user(db)
        assert await resolve_tier(db, _caller(uid)) is ModelTier.free

    @pytest.mark.asyncio
    async def test_pro_subscriber_gets_premium(self, db, gemini_on):
        uid = await _make_user(db, tier=SubscriptionTier.pro)
        assert await resolve_tier(db, _caller(uid)) is ModelTier.premium

    @pytest.mark.asyncio
    async def test_dealer_subscriber_gets_premium(self, db, gemini_on):
        uid = await _make_user(db, tier=SubscriptionTier.dealer)
        assert await resolve_tier(db, _caller(uid)) is ModelTier.premium

    @pytest.mark.asyncio
    async def test_admin_gets_premium_without_a_subscription(self, db, gemini_on):
        uid = await _make_user(db, role=UserRole.admin)
        assert await resolve_tier(db, _caller(uid)) is ModelTier.premium

    @pytest.mark.asyncio
    async def test_expired_subscription_is_free(self, db, gemini_on):
        past = datetime.now(timezone.utc) - timedelta(days=1)
        uid = await _make_user(db, tier=SubscriptionTier.pro, valid_until=past)
        assert await resolve_tier(db, _caller(uid)) is ModelTier.free

    @pytest.mark.asyncio
    async def test_unexpired_subscription_is_premium(self, db, gemini_on):
        future = datetime.now(timezone.utc) + timedelta(days=30)
        uid = await _make_user(db, tier=SubscriptionTier.pro, valid_until=future)
        assert await resolve_tier(db, _caller(uid)) is ModelTier.premium

    @pytest.mark.asyncio
    async def test_no_gemini_key_means_everyone_is_free(self, db, monkeypatch):
        # Without a key the premium path cannot work, so nobody is routed to it.
        monkeypatch.setattr(settings, "gemini_api_key", "")
        uid = await _make_user(db, role=UserRole.admin, tier=SubscriptionTier.pro)
        assert await resolve_tier(db, _caller(uid)) is ModelTier.free
        assert gemini_available() is False

    @pytest.mark.asyncio
    async def test_unknown_user_id_is_free(self, db, gemini_on):
        assert await resolve_tier(db, _caller(uuid.uuid4())) is ModelTier.free

    @pytest.mark.asyncio
    async def test_lookup_failure_degrades_to_free(self, db, gemini_on):
        # A tier lookup error must never deny someone a diagnosis.
        with patch.object(db, "execute", side_effect=Exception("db down")):
            assert await resolve_tier(db, _caller(uuid.uuid4())) is ModelTier.free


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
    async def test_free_tier_gets_gemini_not_gpt4o(self, gemini_on):
        """The free tier reaches a hosted model, but not the expensive one.

        This used to assert the free tier went straight to Ollama. That was the
        bug: OLLAMA_BASE_URL is unset in every deployed environment, so a free
        user who missed the knowledge base fell through to the heuristic — an
        answer assembled from keyword overlap. Gemini Flash-Lite is cheap
        enough to serve everyone, so it does; GPT-4o stays the paid advantage.
        """
        with patch("services.diagnosis._call_openai") as gpt:
            with patch("httpx.AsyncClient", return_value=_gemini_response(OLLAMA_DIAGNOSIS)):
                r = await run_diagnosis(**self._ARGS, model_tier="free")
        gpt.assert_not_called()
        assert r["engine"] == "gemini"
        assert r["model_tier"] == "free"

    @pytest.mark.asyncio
    async def test_free_tier_still_reaches_ollama_when_gemini_fails(self, gemini_on):
        with patch("services.diagnosis._call_gemini", side_effect=Exception("gemini 500")):
            with patch("httpx.AsyncClient", return_value=_mock_ollama(OLLAMA_DIAGNOSIS)):
                r = await run_diagnosis(**self._ARGS, model_tier="free")
        assert r["engine"] == "ollama"

    @pytest.mark.asyncio
    async def test_premium_tier_uses_gpt4o_first(self, gemini_on):
        premium = dict(OLLAMA_DIAGNOSIS, preliminary_diagnosis="GPT-4o analysis")
        with patch("services.diagnosis._call_openai", return_value=premium):
            with patch("services.diagnosis._call_gemini") as gem:
                r = await run_diagnosis(**self._ARGS, model_tier="premium")
        gem.assert_not_called()
        assert r["engine"] == "openai"
        assert r["preliminary_diagnosis"] == "GPT-4o analysis"

    @pytest.mark.asyncio
    async def test_premium_falls_back_to_gemini_when_gpt4o_fails(self, gemini_on):
        premium = dict(OLLAMA_DIAGNOSIS, preliminary_diagnosis="Gemini analysis")
        with patch("services.diagnosis._call_openai", side_effect=Exception("openai 503")):
            with patch("httpx.AsyncClient", return_value=_gemini_response(premium)):
                r = await run_diagnosis(**self._ARGS, model_tier="premium")
        assert r["engine"] == "gemini"
        assert r["preliminary_diagnosis"] == "Gemini analysis"

    @pytest.mark.asyncio
    async def test_gemini_failure_falls_back_to_ollama(self, gemini_on):
        # The paid user gets a slightly worse answer, never no answer.
        with patch("services.diagnosis._call_openai", side_effect=Exception("openai 503")), \
             patch("services.diagnosis._call_gemini", side_effect=Exception("gemini 500")):
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
        # Free means "no GPT-4o", not "no model" — the default must not
        # quietly hand an unauthenticated caller the paid engine.
        with patch("services.diagnosis._call_openai") as gpt:
            with patch("httpx.AsyncClient", return_value=_gemini_response(OLLAMA_DIAGNOSIS)):
                r = await run_diagnosis(**self._ARGS)
        gpt.assert_not_called()
        assert r["model_tier"] == "free"


class TestCallerVerificationSuite:
    """Only a cryptographically verified token establishes identity."""

    def test_no_token_is_anonymous(self):
        assert verify_caller(None) is None
        assert verify_caller("") is None

    def test_garbage_token_is_rejected(self):
        assert verify_caller("not-a-jwt") is None

    def test_api_token_is_accepted(self):
        from core.security import create_access_token
        uid = uuid.uuid4()
        caller = verify_caller(create_access_token(uid, "someone@test.com"))
        assert caller is not None
        assert caller.user_id == uid
        assert caller.email == "someone@test.com"
        assert caller.source == "api"

    def test_supabase_token_is_accepted_when_secret_configured(self, monkeypatch):
        from jose import jwt as jose_jwt
        monkeypatch.setattr(settings, "supabase_jwt_secret", "sb-secret")
        token = jose_jwt.encode(
            {"sub": str(uuid.uuid4()), "email": "Admin@GaadiiQ.com", "aud": "authenticated"},
            "sb-secret", algorithm="HS256",
        )
        caller = verify_caller(token)
        assert caller is not None
        assert caller.source == "supabase"
        # Normalised, so an allowlist comparison is case-insensitive.
        assert caller.email == "admin@gaadiiq.com"
        # The Supabase id is not this backend's users.id, so it is not carried.
        assert caller.user_id is None

    def test_supabase_token_rejected_without_secret(self, monkeypatch):
        from jose import jwt as jose_jwt
        monkeypatch.setattr(settings, "supabase_jwt_secret", "")
        token = jose_jwt.encode({"email": "a@b.com"}, "sb-secret", algorithm="HS256")
        assert verify_caller(token) is None

    def test_supabase_token_with_wrong_signature_is_rejected(self, monkeypatch):
        from jose import jwt as jose_jwt
        monkeypatch.setattr(settings, "supabase_jwt_secret", "correct-secret")
        forged = jose_jwt.encode({"email": "admin@gaadiiq.com"}, "wrong-secret", algorithm="HS256")
        assert verify_caller(forged) is None


class TestAdminAllowlistSuite:
    """Admin must work regardless of which user store holds the role."""

    @pytest.mark.asyncio
    async def test_allowlisted_email_gets_premium(self, db, gemini_on, monkeypatch):
        monkeypatch.setattr(settings, "admin_emails", "admin@gaadiiq.com,ops@gaadiiq.com")
        caller = _caller(email="admin@gaadiiq.com", source="supabase")
        assert await resolve_tier(db, caller) is ModelTier.premium

    @pytest.mark.asyncio
    async def test_allowlist_is_case_insensitive(self, db, gemini_on, monkeypatch):
        monkeypatch.setattr(settings, "admin_emails", "Admin@GaadiiQ.com")
        caller = _caller(email="admin@gaadiiq.com", source="supabase")
        assert await resolve_tier(db, caller) is ModelTier.premium

    @pytest.mark.asyncio
    async def test_non_allowlisted_email_is_free(self, db, gemini_on, monkeypatch):
        monkeypatch.setattr(settings, "admin_emails", "admin@gaadiiq.com")
        caller = _caller(email="someone.else@test.com", source="supabase")
        assert await resolve_tier(db, caller) is ModelTier.free

    @pytest.mark.asyncio
    async def test_supabase_caller_matched_by_email(self, db, gemini_on, monkeypatch):
        # The two user stores have unrelated IDs, so email is the only join.
        monkeypatch.setattr(settings, "admin_emails", "")
        user = User(email="pro@test.com", hashed_password="x", role=UserRole.buyer)
        db.add(user)
        await db.flush()
        db.add(Subscription(user_id=user.id, tier=SubscriptionTier.pro))
        await db.commit()

        caller = _caller(email="pro@test.com", source="supabase")
        assert await resolve_tier(db, caller) is ModelTier.premium


class TestTierCannotBeSelfSelectedSuite:
    @pytest.mark.asyncio
    async def test_anonymous_request_is_served_free(self, client, gemini_on):
        with patch("services.diagnosis._call_openai") as gpt:
            with patch("httpx.AsyncClient", return_value=_gemini_response(OLLAMA_DIAGNOSIS)):
                r = await client.post("/diagnosis/analyse", json=VALID_PAYLOAD)
        assert r.status_code == 201
        assert r.json()["model_tier"] == "free"
        gpt.assert_not_called()

    @pytest.mark.asyncio
    async def test_request_body_cannot_request_premium(self, client, gemini_on):
        payload = {**VALID_PAYLOAD, "model_tier": "premium", "engine": "openai"}
        with patch("services.diagnosis._call_openai") as gpt:
            with patch("httpx.AsyncClient", return_value=_gemini_response(OLLAMA_DIAGNOSIS)):
                r = await client.post("/diagnosis/analyse", json=payload)
        assert r.status_code == 201
        assert r.json()["model_tier"] == "free"
        gpt.assert_not_called()

    @pytest.mark.asyncio
    async def test_body_user_id_does_not_grant_premium(self, client, db, gemini_on):
        # The security property: knowing a paid user's UUID must not upgrade
        # an unauthenticated caller. body.user_id is for record ownership only.
        uid = await _make_user(db, tier=SubscriptionTier.pro)
        with patch("services.diagnosis._call_openai") as gpt:
            with patch("httpx.AsyncClient", return_value=_gemini_response(OLLAMA_DIAGNOSIS)):
                r = await client.post(
                    "/diagnosis/analyse", json={**VALID_PAYLOAD, "user_id": str(uid)}
                )
        assert r.status_code == 201
        assert r.json()["model_tier"] == "free"
        gpt.assert_not_called()

    @pytest.mark.asyncio
    async def test_authenticated_paid_user_gets_premium(self, client, db, gemini_on):
        from core.security import create_access_token
        uid = await _make_user(db, tier=SubscriptionTier.pro)
        q = await db.execute(select(User).where(User.id == uid))
        token = create_access_token(uid, q.scalar_one().email)

        premium = dict(OLLAMA_DIAGNOSIS, preliminary_diagnosis="Gemini analysis")
        with patch("httpx.AsyncClient", return_value=_gemini_response(premium)):
            r = await client.post(
                "/diagnosis/analyse", json=VALID_PAYLOAD,
                headers={"Authorization": f"Bearer {token}"},
            )
        assert r.status_code == 201
        body = r.json()
        assert body["model_tier"] == "premium"
        assert body["engine"] == "gemini"

    @pytest.mark.asyncio
    async def test_supabase_admin_gets_premium(self, client, gemini_on, monkeypatch):
        # The real-world path: the UI signs in via Supabase, not this backend.
        from jose import jwt as jose_jwt
        monkeypatch.setattr(settings, "supabase_jwt_secret", "sb-secret")
        monkeypatch.setattr(settings, "admin_emails", "admin@gaadiiq.com")
        token = jose_jwt.encode(
            {"sub": str(uuid.uuid4()), "email": "admin@gaadiiq.com"},
            "sb-secret", algorithm="HS256",
        )

        premium = dict(OLLAMA_DIAGNOSIS, preliminary_diagnosis="Gemini analysis")
        with patch("httpx.AsyncClient", return_value=_gemini_response(premium)):
            r = await client.post(
                "/diagnosis/analyse", json=VALID_PAYLOAD,
                headers={"Authorization": f"Bearer {token}"},
            )
        assert r.status_code == 201
        assert r.json()["model_tier"] == "premium"

    @pytest.mark.asyncio
    async def test_forged_token_does_not_grant_premium(self, client, gemini_on, monkeypatch):
        from jose import jwt as jose_jwt
        monkeypatch.setattr(settings, "supabase_jwt_secret", "correct-secret")
        monkeypatch.setattr(settings, "admin_emails", "admin@gaadiiq.com")
        forged = jose_jwt.encode(
            {"email": "admin@gaadiiq.com"}, "attacker-secret", algorithm="HS256"
        )
        with patch("services.diagnosis._call_openai") as gpt:
            with patch("httpx.AsyncClient", return_value=_gemini_response(OLLAMA_DIAGNOSIS)):
                r = await client.post(
                    "/diagnosis/analyse", json=VALID_PAYLOAD,
                    headers={"Authorization": f"Bearer {forged}"},
                )
        assert r.json()["model_tier"] == "free"
        gpt.assert_not_called()
