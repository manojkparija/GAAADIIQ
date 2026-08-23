"""
Challan verification.

The tests that matter most here are the ones asserting what happens when
nothing can be verified, because that is both the state today and the state
during any provider outage — and the failure it guards against is a vehicle
that could not be checked being recorded as clear.

THE FAKE PROVIDER IS NOT A SIMULATED PARIVAHAN

It returns records the test itself supplies, and is registered inside tests
only. Nothing in a running application can reach it, and it does not model any
real source's behaviour.
"""
import os

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from db.session import get_db
from main import app
from models.challan import (
    ChallanAuditEvent,
    ChallanRiskCategory,
    ChallanRuleAction,
    ChallanRuleType,
    ChallanVerificationRule,
    ChallanVerificationStatus,
    ListingDecision,
    VehicleChallanVerification,
)
from routers.challan import GATE_ENV, listing_publication_allowed
from services.challan import ChallanRecord, ChallanResult, ProviderUnavailable
from services.challan import registry as registry_module
from services.challan.plate import normalise_registration, state_code
from services.challan.rules import evaluate


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
def clean_env():
    """Provider selection and the gate are environment state; leaking either
    into another test makes failures depend on ordering."""
    saved = {k: os.environ.get(k) for k in ("CHALLAN_PROVIDER", GATE_ENV)}
    saved_providers = dict(registry_module._PROVIDERS)
    for k in saved:
        os.environ.pop(k, None)
    registry_module._PROVIDERS.clear()
    yield
    registry_module._PROVIDERS.clear()
    registry_module._PROVIDERS.update(saved_providers)
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


class FakeProvider:
    key = "fake"

    def __init__(self, result=None, raises=None):
        self._result = result
        self._raises = raises

    async def fetch(self, request):
        if self._raises:
            raise self._raises
        return self._result


def _use(provider):
    registry_module.register_provider(provider)
    os.environ["CHALLAN_PROVIDER"] = provider.key


# ── Registration normalisation (FR-02) ────────────────────────────────────────


def test_the_same_plate_written_differently_normalises_to_one_form():
    """Two spellings of one vehicle would defeat the lookup index and get the
    same car verified twice under different keys."""
    for written in ["WB02AB1234", "WB 02 AB 1234", "wb-02-ab-1234", " wb02ab1234 "]:
        assert normalise_registration(written) == "WB02AB1234", written


def test_plates_that_cannot_be_registrations_are_rejected():
    for bad in ["", "   ", "ABC", "12345678", "ABCDEFGH", "WB02AB1234!", None]:
        assert normalise_registration(bad) is None, bad


def test_unusual_but_real_plate_shapes_are_accepted():
    """The validator rejects only what cannot be a plate. BH-series and
    short older formats are real vehicles, and refusing them would leave
    those sellers with no way forward."""
    for good in ["22BH1234AA", "DL1CAB1234", "MH12A9999"]:
        assert normalise_registration(good) == good, good


def test_state_code_is_not_guessed_when_absent():
    assert state_code("WB02AB1234") == "WB"
    # BH-series starts with digits; guessing a state here would route the
    # lookup to the wrong source.
    assert state_code("22BH1234AA") is None


# ── No provider: the state today, and during any outage ───────────────────────


@pytest.mark.asyncio
async def test_no_provider_records_pending_and_never_clear(client, clean_env, session_factory):
    """The core guarantee. A vehicle that could not be checked must not come
    back as clear, or it would be published under a badge saying it was."""
    resp = await client.post("/challan/verify", json={"registration_number": "WB02AB1234"})
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["listing_decision"] == ListingDecision.verification_pending.value
    assert body["risk_category"] == ChallanRiskCategory.unknown.value
    assert body["verification_status"] == ChallanVerificationStatus.failed.value
    assert body["unavailable_reason"] == ProviderUnavailable.NOT_CONFIGURED
    # Nothing that could be read as "no challans".
    assert body["verified_at"] is None
    assert body["challans"] == []


@pytest.mark.asyncio
async def test_a_failed_lookup_is_still_recorded(client, clean_env, session_factory):
    """A run of failures against one provider is how an outage becomes
    visible. Discarding them would make it look like nobody was selling."""
    await client.post("/challan/verify", json={"registration_number": "WB02AB1234"})

    async with session_factory() as s:
        rows = (await s.execute(select(VehicleChallanVerification))).scalars().all()
        assert len(rows) == 1
        assert rows[0].registration_number == "WB02AB1234"
        assert rows[0].failure_reason

        events = (await s.execute(select(ChallanAuditEvent))).scalars().all()
        assert [e.event for e in events] == ["verification_requested"]


@pytest.mark.asyncio
async def test_a_configured_provider_with_no_adapter_is_a_distinct_failure(client, clean_env):
    os.environ["CHALLAN_PROVIDER"] = "not-registered"
    resp = await client.post("/challan/verify", json={"registration_number": "WB02AB1234"})
    assert resp.json()["unavailable_reason"] == ProviderUnavailable.UPSTREAM_ERROR


@pytest.mark.asyncio
async def test_an_invalid_registration_is_refused_before_any_lookup(client, clean_env):
    resp = await client.post("/challan/verify", json={"registration_number": "!!!!"})
    assert resp.status_code == 422


# ── With a provider ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_no_records_found_is_verified_but_dated(client, clean_env):
    """BRD §16: the claim is "checked on this date", never "this vehicle has
    never had a challan"."""
    _use(FakeProvider(ChallanResult(provider="fake", found_records=False)))
    resp = await client.post("/challan/verify", json={"registration_number": "WB02AB1234"})
    body = resp.json()

    assert body["verification_status"] == ChallanVerificationStatus.no_record_found.value
    assert body["listing_decision"] == ListingDecision.verified.value
    assert body["risk_category"] == ChallanRiskCategory.clear.value
    assert body["verified_at"] is not None
    assert body["verification_expiry_at"] is not None


@pytest.mark.asyncio
async def test_amount_over_the_configured_threshold_blocks(client, clean_env, session_factory):
    async with session_factory() as s:
        s.add(
            ChallanVerificationRule(
                rule_name="Max outstanding",
                rule_type=ChallanRuleType.max_outstanding_amount,
                configured_value="5000",
                action=ChallanRuleAction.block,
            )
        )
        await s.commit()

    _use(
        FakeProvider(
            ChallanResult(
                provider="fake",
                found_records=True,
                records=[ChallanRecord(challan_number="C1", outstanding_amount=18500.0)],
            )
        )
    )
    body = (
        await client.post("/challan/verify", json={"registration_number": "WB02AB1234"})
    ).json()

    assert body["listing_decision"] == ListingDecision.blocked.value
    assert body["risk_category"] == ChallanRiskCategory.high.value
    assert body["total_outstanding_amount"] == 18500.0


@pytest.mark.asyncio
async def test_the_threshold_comes_from_the_row_not_from_code(
    client, clean_env, session_factory
):
    """The point of BRD §9. The same vehicle passes or blocks depending on a
    row an administrator set, with no deploy."""
    async with session_factory() as s:
        s.add(
            ChallanVerificationRule(
                rule_name="Generous limit",
                rule_type=ChallanRuleType.max_outstanding_amount,
                configured_value="25000",
                action=ChallanRuleAction.block,
            )
        )
        await s.commit()

    _use(
        FakeProvider(
            ChallanResult(
                provider="fake",
                found_records=True,
                records=[ChallanRecord(challan_number="C1", outstanding_amount=18500.0)],
            )
        )
    )
    body = (
        await client.post("/challan/verify", json={"registration_number": "WB02AB1234"})
    ).json()

    # Same ₹18,500 that blocked above.
    assert body["listing_decision"] == ListingDecision.verified.value
    assert body["risk_category"] == ChallanRiskCategory.low.value


@pytest.mark.asyncio
async def test_a_court_case_goes_to_manual_review_even_when_under_the_limit(
    client, clean_env
):
    """Ordered above the amount test on purpose: a court matter may be
    contested in ways a rupee threshold cannot express."""
    _use(
        FakeProvider(
            ChallanResult(
                provider="fake",
                found_records=True,
                records=[
                    ChallanRecord(
                        challan_number="C1",
                        outstanding_amount=200.0,
                        court_status="Sent to court",
                        is_court_case=True,
                    )
                ],
            )
        )
    )
    body = (
        await client.post("/challan/verify", json={"registration_number": "WB02AB1234"})
    ).json()

    assert body["listing_decision"] == ListingDecision.manual_review.value
    assert body["risk_category"] == ChallanRiskCategory.court_review.value


@pytest.mark.asyncio
async def test_too_many_outstanding_challans_goes_to_review(client, clean_env, session_factory):
    async with session_factory() as s:
        s.add(
            ChallanVerificationRule(
                rule_name="Max count",
                rule_type=ChallanRuleType.max_outstanding_count,
                configured_value="2",
                action=ChallanRuleAction.manual_review,
            )
        )
        await s.commit()

    _use(
        FakeProvider(
            ChallanResult(
                provider="fake",
                found_records=True,
                records=[ChallanRecord(challan_number=f"C{i}", outstanding_amount=100.0)
                         for i in range(3)],
            )
        )
    )
    body = (
        await client.post("/challan/verify", json={"registration_number": "WB02AB1234"})
    ).json()

    assert body["listing_decision"] == ListingDecision.manual_review.value
    assert body["outstanding_challan_count"] == 3


@pytest.mark.asyncio
async def test_a_provider_error_is_pending_not_clear(client, clean_env):
    _use(FakeProvider(raises=ProviderUnavailable(ProviderUnavailable.UPSTREAM_ERROR, "timeout")))
    body = (
        await client.post("/challan/verify", json={"registration_number": "WB02AB1234"})
    ).json()

    assert body["listing_decision"] == ListingDecision.verification_pending.value
    assert body["risk_category"] == ChallanRiskCategory.unknown.value


# ── The rule engine directly ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_malformed_rule_value_falls_back_rather_than_raising(session_factory):
    """An administrator typing "5,000" must not take verification down for
    every seller."""
    async with session_factory() as s:
        s.add(
            ChallanVerificationRule(
                rule_name="Typo",
                rule_type=ChallanRuleType.max_outstanding_amount,
                configured_value="five thousand",
                action=ChallanRuleAction.block,
            )
        )
        await s.commit()

    async with session_factory() as s:
        outcome = await evaluate(
            s,
            ChallanResult(
                provider="fake",
                found_records=True,
                records=[ChallanRecord(outstanding_amount=100.0)],
            ),
        )
        assert outcome.decision is ListingDecision.verified


@pytest.mark.asyncio
async def test_a_rule_not_yet_in_force_is_not_applied(session_factory):
    """`is_active` alone is not enough: a rule scheduled for next month would
    otherwise block vehicles under a threshold nobody has agreed to yet."""
    from datetime import datetime, timedelta, timezone

    async with session_factory() as s:
        s.add(
            ChallanVerificationRule(
                rule_name="Future strictness",
                rule_type=ChallanRuleType.max_outstanding_amount,
                configured_value="10",
                action=ChallanRuleAction.block,
                effective_from=datetime.now(timezone.utc) + timedelta(days=30),
            )
        )
        await s.commit()

    async with session_factory() as s:
        outcome = await evaluate(
            s,
            ChallanResult(
                provider="fake",
                found_records=True,
                records=[ChallanRecord(outstanding_amount=100.0)],
            ),
        )
        # Falls back to the documented default, not to the future rule's 10.
        assert outcome.decision is ListingDecision.verified


@pytest.mark.asyncio
async def test_outstanding_falls_back_to_amount_when_the_source_gives_no_split():
    """Many sources report only an amount. Treating those as ₹0 outstanding
    would understate liability, which is the error that matters here."""
    result = ChallanResult(
        provider="fake",
        found_records=True,
        records=[ChallanRecord(amount=1200.0), ChallanRecord(outstanding_amount=300.0)],
    )
    assert result.outstanding_total == 1500.0
    assert result.outstanding_count == 2


# ── The publication gate (FR-06, AC-08, AC-09) ────────────────────────────────


@pytest.mark.asyncio
async def test_the_gate_is_off_by_default(clean_env, session_factory):
    """With no provider every vehicle is VERIFICATION_PENDING, so a gate on by
    default would block every used-car listing on the platform."""
    async with session_factory() as s:
        allowed, _ = await listing_publication_allowed(s, "WB02AB1234")
        assert allowed is True


@pytest.mark.asyncio
async def test_the_gate_blocks_an_unverified_vehicle_when_enabled(clean_env, session_factory):
    os.environ[GATE_ENV] = "true"
    async with session_factory() as s:
        allowed, reason = await listing_publication_allowed(s, "WB02AB1234")
        assert allowed is False
        assert "not been checked" in reason


@pytest.mark.asyncio
async def test_the_gate_blocks_an_expired_pass(clean_env, session_factory):
    """AC-09. A PASS that has aged out is not a PASS, and the check has to
    happen at publication rather than when the row was written."""
    from datetime import datetime, timedelta, timezone

    os.environ[GATE_ENV] = "true"
    async with session_factory() as s:
        s.add(
            VehicleChallanVerification(
                registration_number="WB02AB1234",
                verification_status=ChallanVerificationStatus.no_record_found,
                risk_category=ChallanRiskCategory.clear,
                listing_decision=ListingDecision.verified,
                verified_at=datetime.now(timezone.utc) - timedelta(days=30),
                verification_expiry_at=datetime.now(timezone.utc) - timedelta(days=23),
            )
        )
        await s.commit()

    async with session_factory() as s:
        allowed, reason = await listing_publication_allowed(s, "WB02AB1234")
        assert allowed is False
        assert "expired" in reason.lower()


@pytest.mark.asyncio
async def test_the_gate_allows_a_current_pass(clean_env, session_factory):
    from datetime import datetime, timedelta, timezone

    os.environ[GATE_ENV] = "true"
    async with session_factory() as s:
        s.add(
            VehicleChallanVerification(
                registration_number="WB02AB1234",
                verification_status=ChallanVerificationStatus.no_record_found,
                risk_category=ChallanRiskCategory.clear,
                listing_decision=ListingDecision.verified,
                verified_at=datetime.now(timezone.utc),
                verification_expiry_at=datetime.now(timezone.utc) + timedelta(days=7),
            )
        )
        await s.commit()

    async with session_factory() as s:
        # Written unnormalised on purpose: the gate must not be bypassable by
        # spelling the plate differently.
        allowed, _ = await listing_publication_allowed(s, "wb 02 ab 1234")
        assert allowed is True
