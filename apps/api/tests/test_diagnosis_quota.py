"""
Who may run an AI Diagnosis, and how many times a month.

Every test here drives the real endpoint rather than calling
`services.diagnosis_quota` directly, because the thing worth pinning is the
HTTP contract: a 401 with `code: sign_in_required` and a 403 with
`code: diagnosis_quota_exhausted` are what the Angular app switches on, and a
service-level test would keep passing if the router stopped returning them.

Ollama is mocked throughout — a quota test that needs a running model is a
quota test that fails on someone else's bad day.
"""
import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from db.session import get_db
from main import app
from models.subscription import Subscription, SubscriptionTier
from models.user import User
from services import diagnosis_quota as quota
from tests.conftest import diagnosis_auth_headers

pytestmark = pytest.mark.asyncio

ANALYSE = "/diagnosis/analyse"
QUOTA = "/diagnosis/quota"

PAYLOAD = {
    "manufacturer": "Maruti Suzuki",
    "model": "Swift",
    "model_year": 2022,
    "fuel_type": "Petrol",
    "transmission": "Manual",
    "odometer_km": 45000,
    "problem_description": "Knocking sound when accelerating and the light is on",
    "warning_lights": [],
    "when_occurs": ["Acceleration"],
    "severity": "high",
}

ANSWER = {
    "preliminary_diagnosis": "Likely pre-ignition knock.",
    "possible_causes": [{"cause": "Low octane fuel", "confidence": 70, "explanation": "x"}],
    "repair_complexity": "Moderate",
    "cost_min_inr": 2000,
    "cost_max_inr": 15000,
    "repair_time_estimate": "2-4 hours",
    "safe_to_drive": False,
    "risk_level": "High",
    "recommended_steps": ["Book a diagnostic scan"],
    "diy_fixes": [],
    "immediate_service_required": True,
    "preventive_maintenance": [],
    "analysis_confidence": 72,
}


def _mock_ollama():
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json = MagicMock(return_value={"response": json.dumps(ANSWER)})
    cm = AsyncMock()
    cm.__aenter__.return_value.post = AsyncMock(return_value=resp)
    cm.__aexit__.return_value = False
    return cm


@pytest_asyncio.fixture
async def client(db_engine):
    """A client with no default credentials — each test says who it is."""
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


@pytest_asyncio.fixture
def session_factory(db_engine):
    return async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)


async def _subscribed(session_factory, email: str, tier: SubscriptionTier) -> None:
    """Give `email` a local user row holding `tier`, valid indefinitely."""
    async with session_factory() as s:
        user = User(
            id=uuid.uuid4(), email=email, full_name="Test",
            hashed_password="x", is_active=True,
        )
        s.add(user)
        await s.commit()
        s.add(Subscription(user_id=user.id, tier=tier, valid_until=None))
        await s.commit()


async def _analyse(client, headers=None, payload=None):
    with patch("httpx.AsyncClient", return_value=_mock_ollama()):
        return await client.post(ANALYSE, json=payload or PAYLOAD, headers=headers or {})


# ── anonymous ────────────────────────────────────────────────────────────────


async def test_anonymous_analyse_is_refused_with_a_sign_in_code(client):
    r = await _analyse(client)
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == quota.CODE_SIGN_IN_REQUIRED


async def test_anonymous_analyse_does_not_reach_a_model(client):
    """The refusal has to happen before the spend, or it saves nothing."""
    with patch("services.diagnosis.run_diagnosis", new=AsyncMock()) as run:
        await client.post(ANALYSE, json=PAYLOAD)
    run.assert_not_called()


async def test_quota_endpoint_answers_anonymous_callers_rather_than_401ing(client):
    """
    The page needs the numbers to render "sign in to run a diagnosis" *with*
    the plan it would get. A 401 here would leave it nothing to show.
    """
    r = await client.get(QUOTA)
    assert r.status_code == 200
    body = r.json()
    assert body["signed_in"] is False
    assert body["allowed"] is False
    assert body["plan"] == "anonymous"


# ── free plan: three a month ─────────────────────────────────────────────────


async def test_a_free_caller_gets_exactly_three_runs_a_month(client):
    headers = diagnosis_auth_headers("free-user@example.com")
    for n in range(3):
        r = await _analyse(client, headers)
        assert r.status_code == 201, f"run {n + 1} of 3 was refused: {r.text}"

    r = await _analyse(client, headers)
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == quota.CODE_QUOTA_EXHAUSTED


async def test_the_fourth_run_does_not_reach_a_model(client):
    """
    The point of the cap is the spend, not the message. This is the test that
    would fail if the check were moved below the `run_diagnosis` call — where
    it would still return the right status code and still cost the money.
    """
    headers = diagnosis_auth_headers("spender@example.com")
    for _ in range(3):
        assert (await _analyse(client, headers)).status_code == 201

    with patch("routers.diagnosis.run_diagnosis", new=AsyncMock()) as run:
        r = await client.post(ANALYSE, json=PAYLOAD, headers=headers)
    assert r.status_code == 403
    run.assert_not_called()


async def test_one_callers_usage_does_not_spend_anothers(client):
    a = diagnosis_auth_headers("a@example.com")
    b = diagnosis_auth_headers("b@example.com")
    for _ in range(3):
        assert (await _analyse(client, a)).status_code == 201
    assert (await _analyse(client, a)).status_code == 403
    assert (await _analyse(client, b)).status_code == 201


async def test_the_same_caller_is_one_subject_across_two_tokens(client):
    """
    Two sign-ins are two tokens with two random `sub` claims but one email.
    Keying on anything else would hand out a fresh allowance per login, which
    is the same as having no cap at all.
    """
    for _ in range(3):
        assert (
            await _analyse(client, diagnosis_auth_headers("same@example.com"))
        ).status_code == 201
    r = await _analyse(client, diagnosis_auth_headers("same@example.com"))
    assert r.status_code == 403


async def test_case_differences_in_an_email_are_the_same_subject(client):
    for _ in range(3):
        assert (await _analyse(client, diagnosis_auth_headers("Mixed@Example.com"))).status_code == 201
    assert (await _analyse(client, diagnosis_auth_headers("mixed@example.com"))).status_code == 403


async def test_a_refused_run_is_not_charged(client):
    """Being told no must not itself cost a run, or the cap ratchets down."""
    headers = diagnosis_auth_headers("counted@example.com")
    for _ in range(3):
        await _analyse(client, headers)
    for _ in range(4):
        await _analyse(client, headers)
    used = (await client.get(QUOTA, headers=headers)).json()["used"]
    assert used == 3


async def test_quota_endpoint_reports_what_is_left(client):
    headers = diagnosis_auth_headers("counting@example.com")
    before = (await client.get(QUOTA, headers=headers)).json()
    assert before == {
        **before,
        "plan": "free", "plan_label": "Free", "limit": 3,
        "used": 0, "remaining": 3, "unlimited": False,
        "allowed": True, "signed_in": True,
    }

    await _analyse(client, headers)
    after = (await client.get(QUOTA, headers=headers)).json()
    assert (after["used"], after["remaining"]) == (1, 2)


async def test_reading_the_quota_does_not_spend_it(client):
    headers = diagnosis_auth_headers("peeker@example.com")
    for _ in range(5):
        await client.get(QUOTA, headers=headers)
    assert (await client.get(QUOTA, headers=headers)).json()["used"] == 0
    assert (await _analyse(client, headers)).status_code == 201


# ── paid plans ───────────────────────────────────────────────────────────────


async def test_buyer_pro_is_not_capped(client, session_factory):
    email = "buyer-pro@example.com"
    await _subscribed(session_factory, email, SubscriptionTier.pro)
    headers = diagnosis_auth_headers(email)

    q = (await client.get(QUOTA, headers=headers)).json()
    assert (q["plan"], q["unlimited"], q["limit"]) == ("pro", True, None)

    for _ in range(5):
        assert (await _analyse(client, headers)).status_code == 201


async def test_dealer_pro_is_not_capped(client, session_factory):
    email = "dealer-pro@example.com"
    await _subscribed(session_factory, email, SubscriptionTier.dealer)
    headers = diagnosis_auth_headers(email)
    assert (await client.get(QUOTA, headers=headers)).json()["unlimited"] is True
    for _ in range(5):
        assert (await _analyse(client, headers)).status_code == 201


async def test_seller_basic_gets_ten_a_month(client, session_factory):
    """
    Seller Basic pays and is still capped — ten, not unlimited. The number
    lives in one place; this asserts the endpoint honours it rather than
    restating it, so raising the cap does not need this test edited.
    """
    email = "seller-basic@example.com"
    await _subscribed(session_factory, email, SubscriptionTier.seller_basic)
    headers = diagnosis_auth_headers(email)

    q = (await client.get(QUOTA, headers=headers)).json()
    limit = quota.MONTHLY_QUOTA["seller_basic"]
    assert (q["plan"], q["limit"], q["unlimited"]) == ("seller_basic", limit, False)

    for n in range(limit):
        assert (await _analyse(client, headers)).status_code == 201, f"run {n + 1}"
    assert (await _analyse(client, headers)).status_code == 403


async def test_seller_basic_gets_more_than_free(client):
    """The paid tier being no better than free would make it worth nothing."""
    assert quota.MONTHLY_QUOTA["seller_basic"] > quota.MONTHLY_QUOTA["free"]


async def test_an_expired_subscription_is_a_free_subscription(client, session_factory):
    """
    A lapsed payer keeping an unlimited allowance is the expensive direction of
    this bug, and nothing in the request distinguishes them from a live one.
    """
    from datetime import datetime, timedelta, timezone

    email = "lapsed@example.com"
    async with session_factory() as s:
        user = User(
            id=uuid.uuid4(), email=email, full_name="Lapsed",
            hashed_password="x", is_active=True,
        )
        s.add(user)
        await s.commit()
        s.add(Subscription(
            user_id=user.id,
            tier=SubscriptionTier.pro,
            valid_until=datetime.now(timezone.utc) - timedelta(days=1),
        ))
        await s.commit()

    headers = diagnosis_auth_headers(email)
    q = (await client.get(QUOTA, headers=headers)).json()
    assert q["plan"] == "free"
    assert q["unlimited"] is False


# ── the plan cannot be self-selected ─────────────────────────────────────────


async def test_the_request_body_cannot_buy_a_bigger_allowance(client, session_factory):
    """
    `body.user_id` is client-supplied. Sending a Dealer Pro's id must not lift
    a free caller's cap — the plan comes from the token, the same rule the
    model tier already follows.
    """
    paid = "rich@example.com"
    await _subscribed(session_factory, paid, SubscriptionTier.dealer)
    async with session_factory() as s:
        from sqlalchemy import select
        paid_id = await s.scalar(select(User.id).where(User.email == paid))

    headers = diagnosis_auth_headers("poor@example.com")
    payload = {**PAYLOAD, "user_id": str(paid_id)}
    for _ in range(3):
        assert (await _analyse(client, headers, payload)).status_code == 201
    assert (await _analyse(client, headers, payload)).status_code == 403


async def test_an_unverifiable_token_is_anonymous_not_free(client):
    r = await _analyse(client, {"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == quota.CODE_SIGN_IN_REQUIRED
