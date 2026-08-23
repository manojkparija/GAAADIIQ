"""
Insurance router and partner orchestration.

WHAT HAPPENED TO THE OLD TESTS IN THIS FILE

Three of them asserted the behaviour of fabricated data:

  * `test_insurance_quotes_returns_sorted_quotes` asserted that at least one
    quote came back and that premiums were ascending;
  * `test_insurance_quotes_ev_discount` asserted an electric vehicle was
    cheaper than a petrol one.

Both passed, and both were measuring arithmetic this codebase invented —
`premium = idv * 0.025`, with a hardcoded 0.9 multiplier for EVs. The EV test
is the clearest case: it looks like a check on real-world pricing and is in
fact a check that a constant is still 0.9. Tests over fabricated numbers are
worse than no tests, because a green suite is then evidence for a claim nobody
should be making.

They are replaced by tests of what is actually true: with no partner, nothing
is quoted and the refusal is explicit; with a partner, exactly what that
partner returned is what comes back.

THE FAKE ADAPTER BELOW IS NOT A SIMULATED INSURER

It returns one obviously-synthetic plan from "Test Insurer" with a round
number, and exists only to prove the orchestration and persistence path. It is
registered inside tests and never at import time, so no code path in a running
application can reach it.
"""
import re

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from db.session import get_db
from main import app
from models.insurance import (
    InsuranceLead,
    InsuranceLeadStatus,
    InsurancePartner,
    InsurancePartnerType,
    InsuranceQuote,
    QuoteStatus,
)
from services.insurance import PartnerQuote, PartnerUnavailable
from services.insurance import registry as registry_module


@pytest_asyncio.fixture
async def session_factory(db_engine):
    return async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)


@pytest_asyncio.fixture
async def client(session_factory):
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
def clean_registry():
    """The adapter registry is module state; leaking one breaks later tests."""
    saved = dict(registry_module._ADAPTERS)
    registry_module._ADAPTERS.clear()
    yield registry_module._ADAPTERS
    registry_module._ADAPTERS.clear()
    registry_module._ADAPTERS.update(saved)


class FakeAdapter:
    key = "fake"

    def __init__(self, quotes=None, raises=None):
        self._quotes = quotes or []
        self._raises = raises
        self.seen: list = []

    async def fetch_quotes(self, request):
        self.seen.append(request)
        if self._raises:
            raise self._raises
        return self._quotes


async def _make_partner(session_factory, *, active=True, adapter_key="fake"):
    async with session_factory() as s:
        partner = InsurancePartner(
            name="Test Insurance Partner",
            partner_type=InsurancePartnerType.broker,
            registration_no="IRDAI/TEST/000",
            adapter_key=adapter_key,
            is_active=active,
        )
        s.add(partner)
        await s.commit()
        return partner.id


VEHICLE = {"make": "Tata", "model": "Nexon", "manufacturing_year": 2022, "fuel_type": "petrol"}


# ── No partner: the launch state ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_quotes_refuse_when_no_partner_is_configured(client, clean_registry):
    """The state on the day this ships. Nothing is quoted, and the client is
    told why in a form it can branch on."""
    resp = await client.post("/insurance/quotes", json=VEHICLE)
    assert resp.status_code == 503
    detail = resp.json()["detail"]
    assert detail["reason"] == PartnerUnavailable.NOT_CONFIGURED


@pytest.mark.asyncio
async def test_no_premium_figure_appears_anywhere_in_a_refusal(client, clean_registry):
    """The point of the whole exercise, asserted directly.

    A refusal must not carry a number that could be read as a price. This
    catches the specific regression of someone re-adding an "indicative"
    premium to soften the 503.
    """
    resp = await client.post("/insurance/quotes", json=VEHICLE)
    body = resp.text
    assert not re.search(r"(?:₹|Rs\.?|INR)\s*[\d,]+", body), body
    for word in ("premium", "idv"):
        assert word not in body.lower(), body


@pytest.mark.asyncio
async def test_inactive_partner_is_not_used(client, clean_registry, session_factory):
    """`is_active` is the switch. A partner row that exists but is off must be
    indistinguishable from no partner at all — otherwise onboarding a partner
    starts sending them traffic before anyone confirmed the agreement."""
    await _make_partner(session_factory, active=False)
    registry_module.register_adapter(FakeAdapter(quotes=[]))

    resp = await client.post("/insurance/quotes", json=VEHICLE)
    assert resp.status_code == 503
    assert resp.json()["detail"]["reason"] == PartnerUnavailable.NOT_CONFIGURED


@pytest.mark.asyncio
async def test_active_partner_without_an_adapter_is_a_distinct_failure(
    client, clean_registry, session_factory
):
    """Configured but unimplemented is an operator error, not an absence, and
    the two need different responses from whoever is on call."""
    await _make_partner(session_factory, adapter_key="not-registered")

    resp = await client.post("/insurance/quotes", json=VEHICLE)
    assert resp.status_code == 503
    assert resp.json()["detail"]["reason"] == PartnerUnavailable.UPSTREAM_ERROR


# ── With a partner ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_quotes_are_returned_exactly_as_the_partner_supplied_them(
    client, clean_registry, session_factory
):
    """No GAADIIQ-derived field, no re-ordering, no rounding."""
    await _make_partner(session_factory)
    adapter = FakeAdapter(
        quotes=[
            PartnerQuote(
                insurer_name="Test Insurer",
                plan_name="Plan B",
                policy_type="comprehensive",
                premium=20000.0,
                idv=500000.0,
                coverages=["Own Damage"],
                purchase_url="https://partner.example/buy/2",
            ),
            PartnerQuote(
                insurer_name="Test Insurer",
                plan_name="Plan A",
                policy_type="comprehensive",
                premium=10000.0,
            ),
        ]
    )
    registry_module.register_adapter(adapter)

    resp = await client.post("/insurance/quotes", json=VEHICLE)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # Order is the partner's. The old code sorted by premium, which is a
    # ranking — and BRD §9 requires any ranking's criteria be defined and
    # auditable rather than applied silently.
    assert [q["plan_name"] for q in body["quotes"]] == ["Plan B", "Plan A"]
    assert [q["premium"] for q in body["quotes"]] == [20000.0, 10000.0]

    # The accountable party is named alongside the numbers.
    assert body["partner_name"] == "Test Insurance Partner"
    assert body["partner_registration_no"] == "IRDAI/TEST/000"
    assert "does not price, underwrite or issue" in body["disclaimer"]


@pytest.mark.asyncio
async def test_the_reference_reaches_the_partner_and_the_database(
    client, clean_registry, session_factory
):
    """Attribution (BRD §12): without this the partner cannot tell us which
    journey a policy came from, and the payout cannot be claimed."""
    await _make_partner(session_factory)
    adapter = FakeAdapter(
        quotes=[
            PartnerQuote(
                insurer_name="Test Insurer",
                plan_name="Plan A",
                policy_type="comprehensive",
                premium=10000.0,
            )
        ]
    )
    registry_module.register_adapter(adapter)

    resp = await client.post("/insurance/quotes", json=VEHICLE)
    reference = resp.json()["reference"]
    assert re.fullmatch(r"GIQ-INS-\d{4}-\d{8}", reference), reference

    # Handed to the partner, not merely stored.
    assert adapter.seen[0].reference == reference

    async with session_factory() as s:
        quote = (
            await s.execute(select(InsuranceQuote).where(InsuranceQuote.reference == reference))
        ).scalar_one()
        assert quote.quote_status == QuoteStatus.returned
        # Kept verbatim so the displayed figure stays answerable later.
        assert quote.raw_response["plans"][0]["premium"] == 10000.0


@pytest.mark.asyncio
async def test_references_are_unique_across_requests(
    client, clean_registry, session_factory
):
    await _make_partner(session_factory)
    registry_module.register_adapter(FakeAdapter(quotes=[]))

    refs = set()
    for _ in range(3):
        resp = await client.post("/insurance/quotes", json=VEHICLE)
        assert resp.status_code == 200, resp.text
        refs.add(resp.json()["reference"])
    assert len(refs) == 3


@pytest.mark.asyncio
async def test_a_partner_failure_is_recorded_not_discarded(
    client, clean_registry, session_factory
):
    """An outage must be visible in the data. If failed attempts were rolled
    back, a partner that stopped answering would look like an absence of
    demand."""
    await _make_partner(session_factory)
    registry_module.register_adapter(
        FakeAdapter(raises=PartnerUnavailable(PartnerUnavailable.UPSTREAM_ERROR, "timeout"))
    )

    resp = await client.post("/insurance/quotes", json=VEHICLE)
    assert resp.status_code == 503
    assert resp.json()["detail"]["reason"] == PartnerUnavailable.UPSTREAM_ERROR

    async with session_factory() as s:
        quotes = (await s.execute(select(InsuranceQuote))).scalars().all()
        assert len(quotes) == 1
        assert quotes[0].quote_status == QuoteStatus.failed
        assert "timeout" in quotes[0].failure_reason


# ── Interest capture: the journey that works with no partner ──────────────────


@pytest.mark.asyncio
async def test_interest_requires_consent(client):
    resp = await client.post(
        "/insurance/interest", json={**VEHICLE, "phone": "+919876543210", "consent": False}
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_interest_is_persisted_with_dated_consent(client, session_factory):
    """The old /enquiry returned an id and wrote nothing, so the callback it
    promised could never happen. This asserts the row exists."""
    resp = await client.post(
        "/insurance/interest",
        json={
            **VEHICLE,
            "name": "Test Buyer",
            "phone": "+919876543210",
            "city": "Bhubaneswar",
            "consent": True,
        },
    )
    assert resp.status_code == 201, resp.text

    async with session_factory() as s:
        leads = (await s.execute(select(InsuranceLead))).scalars().all()
        assert len(leads) == 1
        lead = leads[0]
        assert lead.phone == "+919876543210"
        assert lead.city == "Bhubaneswar"
        assert lead.make == "Tata"
        assert lead.lead_status == InsuranceLeadStatus.consented
        # Consent that cannot be dated cannot be shown to have preceded
        # anything.
        assert lead.consented_at is not None
        assert lead.consent_text
        # Nothing has been shared, because there is nobody to share it with.
        assert lead.shared_with_partner_at is None
        # An interest lead: no quote, no partner.
        assert lead.quote_id is None
        assert lead.partner_id is None


@pytest.mark.asyncio
async def test_interest_promises_only_what_can_be_delivered(client):
    """The old response said a partner would call within 24 hours. No partner
    existed, and none could."""
    resp = await client.post(
        "/insurance/interest", json={**VEHICLE, "phone": "+919876543210", "consent": True}
    )
    message = resp.json()["message"].lower()
    assert "24 hour" not in message
    assert "partner will contact" not in message


@pytest.mark.asyncio
async def test_interest_rejects_a_non_indian_number(client):
    resp = await client.post(
        "/insurance/interest", json={**VEHICLE, "phone": "+14155551234", "consent": True}
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_interest_rejects_an_unknown_fuel_type(client):
    resp = await client.post(
        "/insurance/interest",
        json={**VEHICLE, "fuel_type": "steam", "phone": "+919876543210", "consent": True},
    )
    assert resp.status_code == 422
