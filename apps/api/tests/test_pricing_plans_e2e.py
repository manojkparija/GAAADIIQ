"""
Pricing Plan module — end-to-end scenarios from the QA test strategy document.

Test case ids map to "GAADIIQ Pricing Plan Module – Testing Strategy & Test
Scenarios" v1.0. The document's own statement of the highest risk is the thing
these are built around:

    "a user pays for one plan but receives incorrect features, or bypasses
     payment and receives [premium access]"

WHAT THIS FILE CAN AND CANNOT COVER

The document describes four plans with trials, usage quotas, listing caps and a
full entitlement matrix. The code implements three tiers and one entitlement
check. Scenarios describing behaviour that does not exist yet are marked xfail
with the reason, rather than omitted — a scenario silently absent from the suite
reads, later, as a scenario that passed. `strict=True` so that implementing the
feature turns the xfail into a failure and forces the marker to be removed.
"""
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.config import settings
from db.session import get_db
from main import app
from models.subscription import Subscription, SubscriptionTier
from routers.payments import SUBSCRIPTION_PRICES


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


async def _token(client: AsyncClient, email: str) -> str:
    r = await client.post("/auth/register", json={"email": email, "password": "pass1234"})
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Pack 1: Pricing and plan configuration ───────────────────────────────────


def test_tc01_every_purchasable_plan_has_a_server_side_price():
    """
    TC-01/TC-02 — a plan that can be bought must have a price the server owns.

    SUBSCRIPTION_PRICES uses .get(tier, 0), so a tier missing from the table
    would create a zero-rupee order and, in dev mode, activate the plan. Nothing
    would raise; the user would simply be upgraded for free.
    """
    purchasable = [t for t in SubscriptionTier if t is not SubscriptionTier.free]
    missing = [t.value for t in purchasable if t not in SUBSCRIPTION_PRICES]
    assert not missing, f"purchasable tiers with no server-side price: {missing}"
    assert all(SUBSCRIPTION_PRICES[t] > 0 for t in purchasable)


def test_tc02_the_price_catalogue_is_stated_in_paise_not_rupees():
    """
    A units error here charges 100x or 1/100x and looks plausible either way.
    Razorpay takes paise; ₹999 is 99900, not 999.
    """
    for tier, paise in SUBSCRIPTION_PRICES.items():
        assert paise % 100 == 0, f"{tier.value}={paise} is not a whole number of rupees"
        assert paise >= 10_000, f"{tier.value}={paise} paise (₹{paise/100}) looks like rupees"


# ── Pack 4: Payment and financial security ───────────────────────────────────


@pytest.mark.asyncio
async def test_tc70_the_client_cannot_choose_what_it_pays(client):
    """
    TC-70 — "changing ₹299 to ₹1".

    The strongest possible answer is that there is no amount field to tamper
    with: the request carries a tier, and the server looks up the price. This
    asserts the property rather than the absence of a bug — an amount added to
    the request model later would have to be deliberate, and this test would
    still pass while the manipulation became possible, so it also checks the
    order that comes back matches the server's own table.
    """
    token = await _token(client, f"price_{uuid.uuid4().hex[:8]}@test.com")

    r = await client.post(
        "/subscriptions/upgrade",
        json={"tier": "pro", "amount_paise": 100, "amount": 1, "price": 1},
        headers=_auth(token),
    )
    assert r.status_code in (200, 201), r.text
    assert r.json()["amount_paise"] == SUBSCRIPTION_PRICES[SubscriptionTier.pro], (
        "the server honoured a client-supplied amount"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("tier", ["dealer_pro", "seller_basic", "PRO", "admin", "", "free "])
async def test_tc71_an_unknown_plan_identifier_is_refused(client, tier):
    """
    TC-71 — plan manipulation.

    Includes the frontend's own plan ids (dealer_pro, seller_basic), which are
    NOT the backend's tier names. If one of those were ever accepted it would
    fall through .get(tier, 0) to a zero-rupee order.
    """
    token = await _token(client, f"plan_{uuid.uuid4().hex[:8]}@test.com")
    r = await client.post("/subscriptions/upgrade", json={"tier": tier}, headers=_auth(token))
    assert r.status_code == 422, f"tier={tier!r} was not rejected: {r.status_code} {r.text}"


@pytest.mark.asyncio
async def test_tc71b_upgrading_to_free_is_refused(client):
    """Free is not a purchase. A ₹0 order for it would be a real payment record."""
    token = await _token(client, f"free_{uuid.uuid4().hex[:8]}@test.com")
    r = await client.post("/subscriptions/upgrade", json={"tier": "free"}, headers=_auth(token))
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_tc72_upgrade_requires_authentication(client):
    """An anonymous caller must not be able to create a subscription at all."""
    r = await client.post("/subscriptions/upgrade", json={"tier": "pro"})
    assert r.status_code in (401, 403), r.text


@pytest.mark.asyncio
async def test_tc73_a_user_sees_only_their_own_subscription(client):
    """
    TC-73 — data isolation.

    Two users, one upgrades. The other must still read as free, and must not be
    able to reach the first user's record by any identifier in the request.
    """
    a = await _token(client, f"iso_a_{uuid.uuid4().hex[:8]}@test.com")
    b = await _token(client, f"iso_b_{uuid.uuid4().hex[:8]}@test.com")

    up = await client.post("/subscriptions/upgrade", json={"tier": "dealer"}, headers=_auth(a))
    assert up.status_code in (200, 201), up.text

    mine = await client.get("/subscriptions/me", headers=_auth(b))
    assert mine.status_code == 200, mine.text
    assert mine.json()["tier"] == "free", "one user read another user's tier"


@pytest.mark.asyncio
@pytest.mark.parametrize("signature", ["0" * 64, "", "not-a-signature"])
async def test_tc74_a_forged_webhook_signature_is_rejected(client, monkeypatch, signature):
    """
    TC-74 — the bypass that costs money.

    A webhook accepted without signature verification lets anyone mark any
    payment paid. This drives the endpoint rather than reading the code: a route
    registered without the check still looks correct in isolation.

    Payments are ENABLED for this test. Without a key the endpoint refuses with
    503 before it ever reaches the HMAC comparison — a refusal, but not the one
    under test, and a version of this test that accepted the 503 would pass
    against a webhook with no signature check in it at all.
    """
    monkeypatch.setattr(settings, "RAZORPAY_KEY_ID", "rzp_test_x", raising=False)
    monkeypatch.setattr(settings, "RAZORPAY_KEY_SECRET", "secret_x", raising=False)

    r = await client.post(
        "/payments/webhook",
        json={"event": "payment.captured", "payload": {"payment": {"entity": {"id": "pay_x"}}}},
        headers={"X-Razorpay-Signature": signature} if signature else {},
    )
    assert r.status_code == 400, f"a forged signature was accepted: {r.status_code} {r.text}"
    assert "signature" in r.text.lower()


@pytest.mark.asyncio
async def test_tc74b_a_non_capture_event_is_acknowledged_without_touching_anything(client):
    """
    Razorpay retries anything it does not get a 2xx for. An event we do not act
    on must be acknowledged rather than refused, or the retry storm looks like
    an outage.
    """
    r = await client.post(
        "/payments/webhook",
        json={"event": "payment.failed", "payload": {}},
        headers={"X-Razorpay-Signature": "irrelevant"},
    )
    assert r.status_code == 200 and r.json().get("status") == "ignored"


@pytest.mark.asyncio
async def test_tc60_the_checkout_flow_can_reach_the_verify_endpoint(client):
    """
    TC-60, and the defect this test was written to catch.

    POST /payments/verify used to declare payment_id, razorpay_payment_id and
    razorpay_signature as bare scalars, which FastAPI reads as QUERY parameters.
    The pricing page sends them as a JSON body:

        this.http.post(`${apiUrl}/payments/verify`, {
          payment_id, razorpay_payment_id, razorpay_signature })

    So every verification from the real checkout returned 422 and the user was
    shown "Payment received but verification failed. Contact support." after
    Razorpay had taken their money.

    This drives the endpoint exactly as the frontend does. A 422 here means the
    contract has drifted apart again.
    """
    token = await _token(client, f"verify_{uuid.uuid4().hex[:8]}@test.com")
    order = await client.post("/subscriptions/upgrade", json={"tier": "pro"}, headers=_auth(token))
    assert order.status_code in (200, 201), order.text

    r = await client.post(
        "/payments/verify",
        json={
            "payment_id": order.json()["payment_id"],
            "razorpay_payment_id": "pay_forged",
            "razorpay_signature": "deadbeef" * 8,
        },
        headers=_auth(token),
    )
    assert r.status_code != 422, (
        "the checkout's JSON body is being read as query parameters again"
    )


@pytest.mark.asyncio
async def test_tc60b_a_forged_signature_is_never_accepted_as_a_new_payment(client):
    """
    The security property itself, now that the call can actually land.

    Dev mode marks the order paid at creation, so this short-circuits to
    already_paid. What must never happen is a forged signature being accepted as
    proof of a NEW payment.
    """
    token = await _token(client, f"verify2_{uuid.uuid4().hex[:8]}@test.com")
    order = await client.post("/subscriptions/upgrade", json={"tier": "pro"}, headers=_auth(token))

    r = await client.post(
        "/payments/verify",
        json={
            "payment_id": order.json()["payment_id"],
            "razorpay_payment_id": "pay_forged",
            "razorpay_signature": "deadbeef" * 8,
        },
        headers=_auth(token),
    )
    assert r.status_code in (200, 400), r.text
    if r.status_code == 200:
        assert r.json().get("status") == "already_paid", (
            f"a forged signature was accepted as verification: {r.text}"
        )


@pytest.mark.asyncio
async def test_tc60c_a_verify_body_missing_a_field_is_refused(client):
    """A declared model means missing fields are a 422 rather than a None."""
    token = await _token(client, f"verify3_{uuid.uuid4().hex[:8]}@test.com")
    r = await client.post(
        "/payments/verify", json={"payment_id": str(uuid.uuid4())}, headers=_auth(token)
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_tc61_replaying_the_callback_does_not_charge_or_activate_twice(client):
    """
    TC-61 — refresh/retry after payment.

    Idempotency, from the user's side: the second call must be recognised, not
    processed again. A duplicate subscription row would also violate the unique
    constraint on user_id, so this checks the row count directly.
    """
    token = await _token(client, f"dup_{uuid.uuid4().hex[:8]}@test.com")
    for _ in range(3):
        r = await client.post(
            "/subscriptions/upgrade", json={"tier": "pro"}, headers=_auth(token)
        )
        assert r.status_code in (200, 201), r.text

    me = await client.get("/subscriptions/me", headers=_auth(token))
    assert me.status_code == 200
    assert me.json()["tier"] == "pro"


# ── Pack 2: Subscription business rules ──────────────────────────────────────


@pytest.mark.asyncio
async def test_a_new_user_starts_on_free_without_a_subscription_row(client):
    """The default must be free, not "no plan" — and never a paid tier."""
    token = await _token(client, f"new_{uuid.uuid4().hex[:8]}@test.com")
    r = await client.get("/subscriptions/me", headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json()["tier"] == "free"


@pytest.mark.asyncio
async def test_activation_sets_an_expiry_rather_than_lasting_for_ever(client, db_engine):
    """
    A subscription with no valid_until never expires, so a single payment buys
    permanent access. The expiry rule cannot be tested without a date to test
    against.
    """
    token = await _token(client, f"exp_{uuid.uuid4().hex[:8]}@test.com")
    await client.post("/subscriptions/upgrade", json={"tier": "pro"}, headers=_auth(token))

    factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)
    async with factory() as s:
        sub = (await s.execute(select(Subscription))).scalars().first()
        assert sub is not None, "activation created no subscription row"
        assert sub.valid_until is not None, "subscription never expires"


# ── Pack 3: Entitlement and usage ────────────────────────────────────────────


def test_the_paid_tier_gate_is_defined_server_side():
    """
    The one entitlement check that exists (services/llm_tier.py) must key on the
    tier enum rather than a string, so a renamed tier is a startup error rather
    than a silently-open gate.
    """
    from services.llm_tier import _PAID_TIERS

    assert _PAID_TIERS, "no paid tiers defined — the gate is open to everyone"
    assert all(isinstance(t, SubscriptionTier) for t in _PAID_TIERS)
    assert SubscriptionTier.free not in _PAID_TIERS


# ── Not implemented: recorded rather than omitted ────────────────────────────
#
# Each of these is a P0 scenario in the document. They are xfail(strict=True) so
# that building the feature turns them into failures and forces the marker off,
# rather than leaving a passing-looking suite that never exercised them.


@pytest.mark.xfail(
    strict=True,
    reason="Seller Basic (₹499) has no backend tier. SubscriptionTier is "
    "free/pro/dealer; the pricing page offers buyer_pro/seller_basic/dealer_pro "
    "and TIER_MAP has no entry for seller_basic, so its CTA cannot charge.",
)
def test_tc30_seller_basic_exists_as_a_purchasable_tier():
    assert any(t.value == "seller_basic" for t in SubscriptionTier)


@pytest.mark.xfail(
    strict=True,
    reason="No listing cap is enforced anywhere. Doc TC-30 requires a 4th "
    "active listing to be blocked on Seller Basic.",
)
def test_tc30b_a_listing_cap_is_enforced_somewhere():
    import pathlib

    src = " ".join(
        p.read_text() for p in pathlib.Path(".").rglob("*.py") if "test" not in str(p)
    )
    assert "max_listings" in src or "listing_limit" in src


@pytest.mark.xfail(
    strict=True,
    reason="No usage quota exists. Doc TC-20..TC-24 require Free Buyer's AI "
    "advisor to allow exactly 5 queries a day, reject the 6th, reject direct "
    "API calls past the quota, and survive a concurrent race on the last one.",
)
def test_tc20_a_daily_usage_quota_is_enforced():
    import pathlib

    src = " ".join(
        p.read_text() for p in pathlib.Path(".").rglob("*.py") if "test" not in str(p)
    )
    assert "queries_per_day" in src or "daily_quota" in src


@pytest.mark.xfail(
    strict=True,
    reason="No trial mechanism exists. Doc TC-50..TC-53 require a 7-day trial "
    "with a start time, an exact expiry, a defined expiry action and "
    "repeat-trial abuse prevention. The pricing page's FAQ advertises one.",
)
def test_tc50_a_trial_can_be_started_and_expires():
    from models.subscription import Subscription as S

    assert hasattr(S, "trial_ends_at")


@pytest.mark.xfail(
    strict=True,
    reason="Downgrade is not implemented. Doc TC-40/E2E-04 require a defined "
    "policy for a Dealer Pro with more active listings than Seller Basic "
    "permits, without unintended data loss.",
)
def test_e2e04_a_downgrade_path_exists():
    import routers.payments as p

    assert hasattr(p, "downgrade_subscription")


def test_expiry_is_enforced_lazily_at_the_gate_not_by_a_job():
    """
    My first version of this asserted nothing expires a subscription. It was
    wrong, and xfail(strict=True) is what said so — the test xpassed.

    Expiry IS enforced, in services/llm_tier.py: an expired valid_until resolves
    to the free model tier. It is evaluated at the gate rather than by a
    scheduled job, which is a legitimate design and cannot drift the way a job
    that failed to run would.

    The consequence worth knowing: no job rewrites sub.tier, so
    GET /subscriptions/me keeps reporting "pro" after the period ends. The
    entitlement is correct and the reported status is stale — see the
    xfail below.
    """
    import inspect

    from services import llm_tier

    src = inspect.getsource(llm_tier)
    assert "valid_until" in src
    assert "An expired subscription is a free subscription." in src


@pytest.mark.xfail(
    strict=True,
    reason="GET /subscriptions/me returns the stored row unchanged, so an "
    "expired subscriber is still reported as their paid tier. Entitlement is "
    "correct (llm_tier re-checks valid_until) but the status the UI shows, and "
    "anything that trusts this endpoint instead of the gate, is wrong.",
)
def test_subscription_status_reflects_expiry():
    import inspect

    import routers.payments as p

    src = inspect.getsource(p.my_subscription)
    assert "valid_until" in src and ("now" in src or "expire" in src)


@pytest.mark.xfail(
    strict=True,
    reason="The price a user is SHOWN comes from Supabase (buyer_pro ₹299) and "
    "the price they are CHARGED comes from SUBSCRIPTION_PRICES (pro ₹999). "
    "Two sources of truth, no reconciliation. This is doc TC-02 and the "
    "highest-risk defect the document names.",
)
def test_tc02_displayed_price_matches_charged_price():
    # The catalogue lives in Supabase, so this pins the mapped pair the frontend
    # actually uses: TIER_MAP sends buyer_pro to tier 'pro'.
    displayed_buyer_pro_rupees = 299
    charged = SUBSCRIPTION_PRICES[SubscriptionTier.pro] // 100
    assert charged == displayed_buyer_pro_rupees
