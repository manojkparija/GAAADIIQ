"""Car loan applications: eligibility, pricing, ranking, and what we refuse to guess.

The rules under test are the ones a borrower would be harmed by getting wrong —
which lender is cheapest, how much they will actually lend, and whether a score
we never checked is presented as though we had.
"""

import pytest

from models.lending_partner import (
    CreditBand,
    EmploymentType,
    LenderRateSlab,
    LendingPartner,
)
from services import credit_bureau, loan_offers


def _partner(slug: str, **kwargs) -> LendingPartner:
    """A lender with sane defaults, overridable per test."""
    defaults = dict(
        name=slug.upper(),
        slug=slug,
        min_loan_amount=100000,
        max_loan_amount=5000000,
        min_tenure_months=12,
        max_tenure_months=84,
        min_monthly_income=25000,
        min_credit_score=700,
        max_ltv_pct=85,
        max_foir_pct=50,
        finances_used_cars=True,
        max_vehicle_age_years=10,
        processing_fee_pct=0.5,
        processing_fee_min=1000,
        processing_fee_max=10000,
        sort_order=0,
    )
    defaults.update(kwargs)
    partner = LendingPartner(**defaults)
    partner.rate_slabs = []
    return partner


def _slab(partner, band, rate, employment=None, ltv=None) -> LenderRateSlab:
    slab = LenderRateSlab(
        credit_band=band, annual_rate_pct=rate, employment_type=employment, max_ltv_pct=ltv
    )
    partner.rate_slabs.append(slab)
    return slab


def _quote(partner, **kwargs):
    args = dict(
        vehicle_price=1000000,
        loan_amount=800000,
        tenure_months=60,
        monthly_income=80000,
        existing_emi=0,
        band=CreditBand.excellent,
        employment=EmploymentType.salaried,
        vehicle_condition_used=False,
        vehicle_age_years=None,
    )
    args.update(kwargs)
    return loan_offers.quote(partner, **args)


# ── Credit bands ─────────────────────────────────────────────────────────────

def test_bands_follow_the_published_cibil_cutoffs():
    assert credit_bureau.band_for_score(820) is CreditBand.excellent
    assert credit_bureau.band_for_score(750) is CreditBand.excellent
    assert credit_bureau.band_for_score(749) is CreditBand.good
    assert credit_bureau.band_for_score(700) is CreditBand.good
    assert credit_bureau.band_for_score(699) is CreditBand.fair
    assert credit_bureau.band_for_score(650) is CreditBand.fair
    assert credit_bureau.band_for_score(649) is CreditBand.poor

def test_a_thin_file_is_unknown_not_poor():
    """
    -1 and 0 mean "no credit history", which is the normal state of a
    first-time borrower. Pricing them as `poor` would be wrong on the facts
    and would quietly penalise younger applicants.
    """
    assert credit_bureau.band_for_score(-1) is CreditBand.unknown
    assert credit_bureau.band_for_score(0) is CreditBand.unknown
    assert credit_bureau.band_for_score(None) is CreditBand.unknown

@pytest.mark.asyncio
async def test_no_score_is_ever_invented():
    """
    The one behaviour this module must never acquire. A generated score
    looks exactly like a real one at the call site and would be believed by
    the applicant right up until the lender's own check contradicted it.
    """
    assert credit_bureau.is_bureau_configured() is False
    with pytest.raises(credit_bureau.BureauUnavailable):
        await credit_bureau.fetch_score("ABCDE1234F")


# ── Rate selection ───────────────────────────────────────────────────────────

def test_employment_specific_slab_beats_the_general_one():
    p = _partner("hdfc")
    _slab(p, CreditBand.excellent, 8.75)
    _slab(p, CreditBand.excellent, 9.25, employment=EmploymentType.self_employed)

    salaried = loan_offers.rate_for(p, CreditBand.excellent, EmploymentType.salaried)
    self_emp = loan_offers.rate_for(p, CreditBand.excellent, EmploymentType.self_employed)
    assert float(salaried.annual_rate_pct) == 8.75
    assert float(self_emp.annual_rate_pct) == 9.25

def test_an_unknown_band_falls_back_to_the_lenders_worst_published_rate():
    """Not excluded, and not given the benefit of the doubt."""
    p = _partner("sbi")
    _slab(p, CreditBand.excellent, 8.45)
    _slab(p, CreditBand.unknown, 10.50)

    slab = loan_offers.rate_for(p, CreditBand.unknown, EmploymentType.salaried)
    assert float(slab.annual_rate_pct) == 10.50


# ── Eligibility ──────────────────────────────────────────────────────────────

def test_income_below_the_floor_is_declined_with_the_number():
    p = _partner("hdfc", min_monthly_income=25000)
    _slab(p, CreditBand.excellent, 8.75)

    q = _quote(p, monthly_income=18000)
    assert not q.is_eligible
    assert "25,000" in q.ineligible_reason

def test_a_new_car_lender_declines_a_used_one():
    p = _partner("maruti-finance", finances_used_cars=False)
    _slab(p, CreditBand.excellent, 8.90)

    q = _quote(p, vehicle_condition_used=True, vehicle_age_years=3)
    assert not q.is_eligible
    assert "new cars only" in q.ineligible_reason

def test_a_vehicle_older_than_the_cap_is_declined():
    p = _partner("hdfc", max_vehicle_age_years=8)
    _slab(p, CreditBand.excellent, 8.75)

    assert _quote(p, vehicle_condition_used=True, vehicle_age_years=12).is_eligible is False
    assert _quote(p, vehicle_condition_used=True, vehicle_age_years=5).is_eligible is True

def test_existing_emis_consuming_the_income_are_declined_not_priced():
    p = _partner("hdfc", max_foir_pct=50)
    _slab(p, CreditBand.excellent, 8.75)

    q = _quote(p, monthly_income=50000, existing_emi=30000)
    assert not q.is_eligible
    assert "Existing EMIs" in q.ineligible_reason


# ── How much is actually lent ────────────────────────────────────────────────

def test_ltv_caps_the_loan_against_the_car():
    """A buyer asking for 100% of the price on an 85% LTV gets 85%."""
    p = _partner("hdfc", max_ltv_pct=85)
    _slab(p, CreditBand.excellent, 8.75)

    q = _quote(p, vehicle_price=1000000, loan_amount=1000000, monthly_income=500000)
    assert q.is_eligible
    assert q.approved_amount == pytest.approx(850000)

def test_foir_caps_the_emi_against_the_income():
    """
    The tighter of the two caps wins, and here it is income. ₹8 lakh at 9% over
    60 months is an EMI of about ₹16,600; half of a ₹30,000 income leaves
    ₹15,000, so the loan has to come down to fit.

    (LTV would allow ₹9 lakh on this car, so it is not what binds.)
    """
    p = _partner("hdfc", max_ltv_pct=90, max_foir_pct=50, min_monthly_income=20000)
    _slab(p, CreditBand.excellent, 9.0)

    q = _quote(p, vehicle_price=1000000, loan_amount=800000, monthly_income=30000)
    assert q.is_eligible
    assert q.approved_amount < 800000
    # The resulting EMI must fit the headroom it was derived from.
    assert q.emi <= 15000 + 1

def test_a_band_specific_ltv_override_wins_over_the_partner_default():
    p = _partner("sbi", max_ltv_pct=90)
    _slab(p, CreditBand.poor, 11.25, ltv=70)

    q = _quote(p, band=CreditBand.poor, vehicle_price=1000000,
               loan_amount=900000, monthly_income=500000)
    assert q.approved_amount == pytest.approx(700000)


# ── Ranking: what "best bank" means ──────────────────────────────────────────

def test_the_cheapest_loan_wins_not_the_lowest_rate():
    """
    The reason ranking is by total cost of credit. A headline 8.45% with a
    ₹10,000 fee loses to 8.60% with a ₹1,000 fee on a small, short loan —
    and a page that called the first one "best" would be misleading.
    """
    cheap_rate_high_fee = _partner(
        "cheap-rate", processing_fee_pct=5, processing_fee_min=10000, processing_fee_max=10000,
    )
    _slab(cheap_rate_high_fee, CreditBand.excellent, 8.45)

    higher_rate_low_fee = _partner(
        "low-fee", processing_fee_pct=0.1, processing_fee_min=1000, processing_fee_max=1000,
    )
    _slab(higher_rate_low_fee, CreditBand.excellent, 8.60)

    quotes = [
        _quote(cheap_rate_high_fee, loan_amount=200000, tenure_months=12, monthly_income=200000),
        _quote(higher_rate_low_fee, loan_amount=200000, tenure_months=12, monthly_income=200000),
    ]
    ranked = loan_offers.rank(quotes)

    assert ranked[0].partner.slug == "low-fee"
    assert ranked[0].annual_rate_pct > ranked[1].annual_rate_pct
    assert ranked[0].total_cost < ranked[1].total_cost

def test_ineligible_lenders_sort_last_but_are_not_dropped():
    """
    "Why isn't SBI here?" is a worse page than "SBI needs ₹25,000 a month".
    """
    ok = _partner("ok")
    _slab(ok, CreditBand.excellent, 9.0)
    too_strict = _partner("too-strict", min_monthly_income=500000)
    _slab(too_strict, CreditBand.excellent, 8.0)

    ranked = loan_offers.rank([_quote(too_strict), _quote(ok)])
    assert [q.partner.slug for q in ranked] == ["ok", "too-strict"]
    assert ranked[-1].ineligible_reason


# ── EMI arithmetic ───────────────────────────────────────────────────────────

def test_matches_the_sites_own_calculator():
    """
    ₹7,00,000 at 10% over 5 years is ₹14,872 — the figure in the screenshot
    this module was specified from. A quote that disagreed with the EMI
    calculator on the same page would be the first thing a buyer noticed.
    """
    assert loan_offers.monthly_emi(700000, 10.0, 60) == pytest.approx(14872, abs=1)

def test_a_zero_rate_is_the_principal_spread_evenly():
    """Zero-interest schemes exist at captive financiers; no division by zero."""
    assert loan_offers.monthly_emi(120000, 0, 12) == pytest.approx(10000)

def test_total_interest_is_consistent_with_the_emi():
    p = _partner("hdfc")
    _slab(p, CreditBand.excellent, 9.0)
    q = _quote(p, loan_amount=500000, tenure_months=36, monthly_income=200000)
    assert q.total_interest == pytest.approx(q.emi * 36 - q.approved_amount, abs=1)
    assert q.total_cost == pytest.approx(q.total_interest + q.processing_fee, abs=1)


# ── End to end, through the API ──────────────────────────────────────────────

import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker  # noqa: E402

from db.session import get_db  # noqa: E402
from main import app  # noqa: E402


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


@pytest_asyncio.fixture
async def session_factory(db_engine):
    return async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)


async def _token(client: AsyncClient, email: str) -> str:
    r = await client.post("/auth/register", json={"email": email, "password": "pass1234"})
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"]


async def _seed_partners(session_factory) -> None:
    """Two lenders far enough apart that the ranking has something to decide."""
    async with session_factory() as db:
        cheap = _partner("bank-cheap", processing_fee_pct=0.25,
                         processing_fee_min=1000, processing_fee_max=5000)
        _slab(cheap, CreditBand.excellent, 8.45)
        _slab(cheap, CreditBand.unknown, 10.50)

        dear = _partner("bank-dear", processing_fee_pct=1.0,
                        processing_fee_min=3000, processing_fee_max=15000)
        _slab(dear, CreditBand.excellent, 9.75)
        _slab(dear, CreditBand.unknown, 12.00)

        db.add_all([cheap, dear])
        await db.commit()


def _application_payload(**overrides) -> dict:
    payload = {
        "vehicle_condition": "new",
        "vehicle_description": "Maruti Suzuki S-Presso VXi",
        "vehicle_price": 600000,
        "applicant_name": "Manoj Kumar",
        "mobile": "9876500011",
        "pan_number": "ABCDE1234F",
        "employment_type": "salaried",
        "monthly_income": 90000,
        "existing_emi": 0,
        "down_payment": 100000,
        "loan_amount": 500000,
        "tenure_months": 60,
        "credit_score": 780,
    }
    payload.update(overrides)
    return payload


@pytest.mark.asyncio
async def test_applying_returns_ranked_offers_with_one_recommendation(client, session_factory):
    await _seed_partners(session_factory)
    token = await _token(client, "borrower@example.com")

    r = await client.post(
        "/loans/applications",
        json=_application_payload(),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201, r.text
    body = r.json()

    assert body["credit_band"] == "excellent"
    assert body["credit_source"] == "self_declared"
    offers = body["offers"]
    assert len(offers) == 2
    # Cheapest first, and exactly one carries the recommendation.
    assert offers[0]["partner"]["slug"] == "bank-cheap"
    assert [o["is_recommended"] for o in offers] == [True, False]
    assert offers[0]["total_cost"] < offers[1]["total_cost"]
    assert offers[0]["monthly_emi"] > 0


@pytest.mark.asyncio
async def test_the_pan_is_never_returned_in_full(client, session_factory):
    """
    The number is stored — a lender needs it — but it leaves the API masked
    from every endpoint, with no way to ask for the whole thing.
    """
    await _seed_partners(session_factory)
    token = await _token(client, "pan@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    created = await client.post("/loans/applications", json=_application_payload(), headers=headers)
    assert created.json()["pan_masked"] == "ABCDE****F"

    listed = await client.get("/loans/applications", headers=headers)
    fetched = await client.get(f"/loans/applications/{created.json()['id']}", headers=headers)
    for response in (created, listed, fetched):
        assert "ABCDE1234F" not in response.text
        assert "pan_number" not in response.text


@pytest.mark.asyncio
async def test_another_user_cannot_read_an_application(client, session_factory):
    """404, not 403 — confirming that a loan reference exists is a disclosure."""
    await _seed_partners(session_factory)
    mine = await _token(client, "owner@example.com")
    theirs = await _token(client, "stranger@example.com")

    created = await client.post(
        "/loans/applications", json=_application_payload(),
        headers={"Authorization": f"Bearer {mine}"},
    )
    application_id = created.json()["id"]

    r = await client.get(
        f"/loans/applications/{application_id}",
        headers={"Authorization": f"Bearer {theirs}"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_a_malformed_pan_is_rejected(client, session_factory):
    await _seed_partners(session_factory)
    token = await _token(client, "badpan@example.com")

    r = await client.post(
        "/loans/applications",
        json=_application_payload(pan_number="12345ABCDE"),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422
    assert "PAN" in r.json()["detail"]


@pytest.mark.asyncio
async def test_borrowing_more_than_the_car_costs_is_rejected(client, session_factory):
    await _seed_partners(session_factory)
    token = await _token(client, "overask@example.com")

    r = await client.post(
        "/loans/applications",
        json=_application_payload(vehicle_price=500000, loan_amount=600000),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_a_credit_check_says_the_band_was_declared_not_checked(client, session_factory):
    """
    With no bureau connected, the response has to be explicit that the band came
    from the applicant. Silence here would let a declared score be read as a
    verified one.
    """
    await _seed_partners(session_factory)
    token = await _token(client, "check@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    created = await client.post("/loans/applications", json=_application_payload(), headers=headers)
    application_id = created.json()["id"]

    r = await client.post(
        f"/loans/applications/{application_id}/credit-check",
        json={"credit_consent": True, "declared_score": 690},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"] == "self_declared"
    assert body["band"] == "fair"
    assert body["bureau"] is None
    assert "declared" in body["note"].lower()

    # And the offers are re-priced against the new band rather than left stale.
    offers = (await client.get(f"/loans/applications/{application_id}/offers", headers=headers)).json()
    assert offers[0]["annual_rate_pct"] > 8.45


@pytest.mark.asyncio
async def test_an_ineligible_lender_cannot_be_selected(client, session_factory):
    await _seed_partners(session_factory)
    token = await _token(client, "select@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    # Income under every seeded lender's floor, so nothing is eligible.
    created = await client.post(
        "/loans/applications",
        json=_application_payload(monthly_income=9000, loan_amount=200000),
        headers=headers,
    )
    application_id = created.json()["id"]
    offers = created.json()["offers"]
    assert all(not o["is_eligible"] for o in offers)
    # Still returned, each with a reason the applicant can act on.
    assert all(o["ineligible_reason"] for o in offers)

    r = await client.post(
        f"/loans/applications/{application_id}/select",
        json={"offer_id": offers[0]["id"]},
        headers=headers,
    )
    assert r.status_code == 409
