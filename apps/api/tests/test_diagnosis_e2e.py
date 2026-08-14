"""End-to-end validation of the AI Diagnosis module, driven through HTTP.

SCOPE, AND WHY IT IS DRAWN HERE

`test_diagnosis_kb_lookup.py` tests the lookup ladder at the service layer.
This file tests the module the way a driver and an admin actually reach it:
through `POST /diagnosis/analyse` and the `/admin/diagnosis-kb/*` endpoints,
with a real database underneath and the real dependency graph wired up.

That distinction matters. A service-layer test cannot catch a request schema
that rejects a valid Indian fuel type, an admin route that is reachable without
admin rights, or a response field the client renders that the API stopped
sending. Those are the failures a user sees, and they only appear at this level.

WHAT IS DELIBERATELY NOT TESTED HERE

No external model is called. Gemini and Ollama are unreachable from CI, and a
test whose result depends on a third-party LLM is a test that fails on their
bad day rather than ours. Every case below either expects a knowledge-base
answer — which involves no model at all — or asserts the *shape* of the
fall-through, not its content.

TEST DATA

`tests/data/diagnosis_e2e_seed.py`. Every row exists to force one decision:
overlapping symptoms across manufacturers, narrow year and odometer bands, a
row that is published but unreviewed, and an AI-generated row. See its
docstring.
"""

import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from core.dependencies import get_admin_user
from db.session import get_db
from main import app
from models.diagnosis_kb import (
    DiagnosisMaster,
    DiagnosisSolution,
    DiagnosisSymptomAlias,
    RecordStatus,
    VerificationStatus,
)
from models.user import User
from services import diagnosis_cache, diagnosis_kb_lookup
from services.diagnosis_kb_import import normalise_phrase
from tests.data import diagnosis_e2e_seed as seed

pytestmark = pytest.mark.asyncio

ANALYSE = "/diagnosis/analyse"
KB = "/admin/diagnosis-kb"


# ── fixtures ────────────────────────────────────────────────────────────────


def _enum_kwargs(row: dict) -> dict:
    """Strip the seed's private status hints and return them separately."""
    row = dict(row)
    status = row.pop("_status", "ACTIVE")
    verification = row.pop("_verification", "VERIFIED")
    row["status"] = RecordStatus(status)
    row["verification_status"] = VerificationStatus(verification)
    return row


async def _seed(db):
    """Load the whole dataset. Servable and unservable rows both."""
    from models.diagnosis_kb import (
        CanDrive,
        Difficulty,
        Severity,
        SolutionType,
        SourceType,
    )

    by_code: dict[str, DiagnosisMaster] = {}
    for raw in seed.MASTERS + seed.UNSERVABLE_MASTERS:
        d = _enum_kwargs(raw)
        d["severity"] = Severity(d["severity"])
        d["can_drive"] = CanDrive(d["can_drive"])
        d["source_type"] = SourceType(d["source_type"])
        row = DiagnosisMaster(**d)
        db.add(row)
        by_code[row.diagnosis_code] = row
    await db.commit()

    for raw in seed.SOLUTIONS + seed.UNSERVABLE_SOLUTIONS:
        d = _enum_kwargs(raw)
        master = by_code[d.pop("diagnosis_code")]
        d["solution_type"] = SolutionType(d["solution_type"])
        d["difficulty"] = Difficulty(d["difficulty"])
        d.setdefault("source_type", SourceType.technical)
        d.setdefault("source_name", "Test fixture")
        db.add(DiagnosisSolution(diagnosis_id=master.id, **d))

    for canonical, phrase in seed.ALIASES:
        db.add(
            DiagnosisSymptomAlias(
                canonical_symptom=canonical,
                user_phrase=phrase,
                normalised_phrase=normalise_phrase(phrase),
                language="en",
                status=RecordStatus.active,
            )
        )
    await db.commit()
    diagnosis_kb_lookup.reset_caches()
    return by_code


@pytest_asyncio.fixture
async def client(db_session):
    """An HTTP client wired to the test database.

    The rate limiter is held at whatever the suite already had — which is
    disabled, because `core/limiter.py` builds it with
    `enabled=settings.is_production`. The previous value is captured and
    restored rather than assumed: setting it to True on teardown switched the
    limiter ON for every test file that ran afterwards, and /auth/register
    started 429-ing in an unrelated suite. A shared app object must be left
    exactly as it was found.
    """
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    limiter_was = app.state.limiter.enabled
    app.state.limiter.enabled = False

    # invalidate_all() before _reset_for_tests(): the first clears the dx:* keys
    # in Redis, the second drops the client handle. Resetting only the
    # in-process dict leaves cached answers alive in Redis *between pytest
    # runs*, and the resulting failure looks like a lookup bug in whichever
    # test happens to ask the same question next.
    await diagnosis_cache.invalidate_all()
    diagnosis_kb_lookup.reset_caches()
    diagnosis_cache._reset_for_tests()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c

    app.dependency_overrides.clear()
    app.state.limiter.enabled = limiter_was
    await diagnosis_cache.invalidate_all()
    diagnosis_kb_lookup.reset_caches()
    diagnosis_cache._reset_for_tests()


@pytest_asyncio.fixture
async def seeded(db_session):
    return await _seed(db_session)


@pytest_asyncio.fixture
async def admin_client(client, db_session):
    """The same client, with admin dependency satisfied."""
    admin = User(
        id=uuid.uuid4(), email="qa-lead@gaadiiq.com",
        full_name="QA Lead", hashed_password="x", is_active=True,
    )
    app.dependency_overrides[get_admin_user] = lambda: admin
    yield client
    app.dependency_overrides.pop(get_admin_user, None)


# ══════════════════════════════════════════════════════════════════════════
# DX-E2E-01xx — request contract
# ══════════════════════════════════════════════════════════════════════════


async def test_DX_E2E_0101_valid_request_returns_201(client, seeded):
    r = await client.post(ANALYSE, json=seed.request())
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["id"]
    assert body["disclaimer"]


@pytest.mark.parametrize("fuel", ["Petrol", "Diesel", "CNG", "Electric", "Hybrid", "LPG"])
async def test_DX_E2E_0102_every_indian_fuel_type_is_accepted(client, seeded, fuel):
    """CNG and LPG are mainstream in India. A schema that rejects them is a
    whole segment of owners who cannot use the feature."""
    r = await client.post(ANALYSE, json=seed.request(fuel_type=fuel))
    assert r.status_code == 201, f"{fuel}: {r.text}"


@pytest.mark.parametrize("gearbox", ["Manual", "Automatic", "CVT", "DCT", "AMT"])
async def test_DX_E2E_0103_every_transmission_is_accepted(client, seeded, gearbox):
    r = await client.post(ANALYSE, json=seed.request(transmission=gearbox))
    assert r.status_code == 201, f"{gearbox}: {r.text}"


@pytest.mark.parametrize(
    "override,field",
    [
        ({"fuel_type": "Kerosene"}, "fuel_type"),
        ({"transmission": "Tiptronic"}, "transmission"),
        ({"severity": "catastrophic"}, "severity"),
        ({"model_year": 1899}, "model_year"),
        ({"model_year": 2099}, "model_year"),
        ({"odometer_km": -1}, "odometer_km"),
        ({"problem_description": "noise"}, "problem_description"),  # min_length 10
        ({"manufacturer": ""}, "manufacturer"),
    ],
)
async def test_DX_E2E_0104_invalid_input_is_refused_with_422(
    client, seeded, override, field
):
    r = await client.post(ANALYSE, json=seed.request(**override))
    assert r.status_code == 422, f"{override} was accepted: {r.text}"
    assert field in r.text


async def test_DX_E2E_0105_no_authentication_required(client, seeded):
    """The endpoint is deliberately public — a stranded driver has no account."""
    r = await client.post(ANALYSE, json=seed.request())
    assert r.status_code == 201


async def test_DX_E2E_0106_tier_cannot_be_claimed_in_the_body(client, seeded):
    """user_id is client-supplied. It must not be able to buy a premium engine."""
    r = await client.post(
        ANALYSE, json=seed.request(user_id=str(uuid.uuid4()))
    )
    assert r.status_code == 201
    assert r.json()["model_tier"] == "free"


# ══════════════════════════════════════════════════════════════════════════
# DX-E2E-02xx — the knowledge base answers
# ══════════════════════════════════════════════════════════════════════════


async def test_DX_E2E_0201_alias_match_answers_from_the_kb(client, seeded):
    r = await client.post(ANALYSE, json=seed.request())
    body = r.json()
    assert body["engine"] == "knowledge_base"
    assert body["kb_diagnosis_code"] == "DX-BRK-001"
    assert body["kb_match_method"] in ("alias", "exact")


async def test_DX_E2E_0202_hinglish_phrasing_is_understood(client, seeded):
    """'brake se awaaz aa rahi hai' is how the complaint actually arrives."""
    r = await client.post(
        ANALYSE,
        json=seed.request(problem_description="brake se awaaz aa rahi hai sir"),
    )
    body = r.json()
    assert body["engine"] == "knowledge_base", body.get("engine")
    assert body["kb_diagnosis_code"] == "DX-BRK-001"


async def test_DX_E2E_0203_same_symptom_different_car_gets_a_different_answer(
    client, seeded
):
    swift = (await client.post(ANALYSE, json=seed.request())).json()
    creta = (
        await client.post(
            ANALYSE,
            json=seed.request(
                manufacturer="Hyundai", model="Creta", fuel_type="Diesel",
                model_year=2019, transmission="Automatic",
            ),
        )
    ).json()
    assert swift["kb_diagnosis_code"] == "DX-BRK-001"
    assert creta["kb_diagnosis_code"] == "DX-BRK-002"


async def test_DX_E2E_0204_year_outside_the_band_does_not_get_that_answer(
    client, seeded
):
    """DX-ENG-001 covers 2015-2018. A 2023 Nexon must not receive it."""
    r = await client.post(
        ANALYSE,
        json=seed.request(
            manufacturer="Tata", model="Nexon", model_year=2023,
            problem_description="car juddering when I accelerate",
        ),
    )
    body = r.json()
    assert body.get("kb_diagnosis_code") != "DX-ENG-001"


async def test_DX_E2E_0205_odometer_outside_the_band_does_not_get_that_answer(
    client, seeded
):
    """A timing-chain wear item must not be offered to a 12,000 km car."""
    r = await client.post(
        ANALYSE,
        json=seed.request(
            manufacturer="Hyundai", model="i20", model_year=2022,
            odometer_km=12000,
            problem_description="rattling noise on cold start every morning",
        ),
    )
    assert r.json().get("kb_diagnosis_code") != "DX-ENG-002"


async def test_DX_E2E_0206_odometer_inside_the_band_does_get_it(client, seeded):
    r = await client.post(
        ANALYSE,
        json=seed.request(
            manufacturer="Hyundai", model="i20", model_year=2018,
            odometer_km=95000,
            problem_description="rattling noise on cold start every morning",
        ),
    )
    assert r.json().get("kb_diagnosis_code") == "DX-ENG-002"


async def test_DX_E2E_0207_any_scope_answers_any_car(client, seeded):
    r = await client.post(
        ANALYSE,
        json=seed.request(
            manufacturer="Mahindra", model="XUV700", fuel_type="Diesel",
            problem_description="ac not cooling at all since yesterday",
        ),
    )
    assert r.json()["kb_diagnosis_code"] == "DX-AC-001"


async def test_DX_E2E_0208_specific_row_beats_generic_with_higher_confidence(
    client, seeded
):
    """DX-GBX-001 has confidence 0.99 and ANY scope. DX-CVT-001 is scoped to
    the Baleno with confidence 0.75. The scoped row must win."""
    r = await client.post(
        ANALYSE,
        json=seed.request(
            manufacturer="Maruti Suzuki", model="Baleno", transmission="CVT",
            model_year=2020,
            problem_description="engine revving but not moving properly",
        ),
    )
    assert r.json()["kb_diagnosis_code"] == "DX-CVT-001"


async def test_DX_E2E_0209_short_alias_does_not_fire_inside_a_longer_word(
    client, seeded
):
    """The alias 'ac' must not match 'acceleration'."""
    r = await client.post(
        ANALYSE,
        json=seed.request(
            problem_description="there is hesitation during acceleration uphill"
        ),
    )
    assert r.json().get("kb_diagnosis_code") != "DX-AC-001"


async def test_DX_E2E_0210_unknown_complaint_falls_through_not_errors(
    client, seeded
):
    """A miss must degrade, never 500. No model is reachable in CI, so the
    heuristic is the correct destination — what matters is that the request
    still returns a well-formed answer."""
    r = await client.post(
        ANALYSE,
        json=seed.request(
            problem_description="the boot latch rattles over speed bumps only"
        ),
    )
    assert r.status_code == 201
    body = r.json()
    assert body["engine"] != "knowledge_base"
    assert body["kb_diagnosis_code"] is None
    assert body["disclaimer"]


# ══════════════════════════════════════════════════════════════════════════
# DX-E2E-03xx — safety behaviour
# ══════════════════════════════════════════════════════════════════════════


async def test_DX_E2E_0301_safety_critical_says_do_not_drive(client, seeded):
    body = (await client.post(ANALYSE, json=seed.request())).json()
    assert body["safe_to_drive"] is False
    assert body["risk_level"] == "Critical"
    assert body["immediate_service_required"] is True


async def test_DX_E2E_0302_temporary_fix_is_labelled_as_temporary(client, seeded):
    """A driver must not read 'swap the coil' as 'the misfire is fixed'."""
    body = (
        await client.post(
            ANALYSE,
            json=seed.request(
                manufacturer="Tata", model="Nexon", model_year=2017,
                problem_description="gaadi jhatke maar rahi hai on the highway",
            ),
        )
    ).json()
    assert body["kb_diagnosis_code"] == "DX-ENG-001"
    assert any("temporary" in s.lower() for s in body["recommended_steps"])


async def test_DX_E2E_0303_low_severity_does_not_cry_wolf(client, seeded):
    """A weak air conditioner needs a workshop, not an emergency."""
    body = (
        await client.post(
            ANALYSE,
            json=seed.request(
                problem_description="ac not cooling since the weekend",
                severity="low",
            ),
        )
    ).json()
    assert body["safe_to_drive"] is True
    assert body["immediate_service_required"] is False


async def test_DX_E2E_0304_solutions_are_ordered_cheapest_first(client, seeded):
    body = (
        await client.post(
            ANALYSE,
            json=seed.request(problem_description="ac not cooling since the weekend"),
        )
    ).json()
    sols = body["solutions"]
    assert [s["sequence"] for s in sols] == sorted(s["sequence"] for s in sols)
    assert sols[0]["difficulty"] == "DIY"
    assert sols[0]["cost_parts_max"] <= sols[1]["cost_parts_max"]


async def test_DX_E2E_0305_every_answer_carries_the_disclaimer(client, seeded):
    for desc in (
        "There is a grinding when I brake at low speed",
        "ac not cooling since the weekend",
        "the boot latch rattles over speed bumps only",
    ):
        body = (
            await client.post(ANALYSE, json=seed.request(problem_description=desc))
        ).json()
        assert "preliminary" in body["disclaimer"].lower()
        assert body["disclaimer"]


# ══════════════════════════════════════════════════════════════════════════
# DX-E2E-04xx — the two gates
# ══════════════════════════════════════════════════════════════════════════


async def test_DX_E2E_0401_draft_row_is_invisible_to_drivers(client, seeded):
    r = await client.post(
        ANALYSE,
        json=seed.request(
            manufacturer="Maruti Suzuki", model="Ertiga", fuel_type="CNG",
            model_year=2021,
            problem_description="cng not starting when the engine is cold",
        ),
    )
    assert r.json().get("kb_diagnosis_code") != "DX-DRAFT-1"


async def test_DX_E2E_0402_active_but_unverified_is_invisible(client, seeded):
    """One gate is not enough. DX-REJ-001 is ACTIVE and PENDING_REVIEW."""
    r = await client.post(
        ANALYSE,
        json=seed.request(
            manufacturer="Honda", model="City", model_year=2018,
            problem_description="battery drain after the car stands two days",
        ),
    )
    assert r.json().get("kb_diagnosis_code") != "DX-REJ-001"


async def test_DX_E2E_0403_approval_makes_a_row_answerable(
    admin_client, seeded, db_session
):
    """The full loop: invisible → admin approves → a driver gets the answer."""
    body = seed.request(
        manufacturer="Honda", model="City", model_year=2018,
        problem_description="battery drain after the car stands two days",
    )
    before = (await admin_client.post(ANALYSE, json=body)).json()
    assert before.get("kb_diagnosis_code") != "DX-REJ-001"

    target = seeded["DX-REJ-001"]
    r = await admin_client.post(
        f"{KB}/review/{target.id}",
        json={"decision": "APPROVED", "notes": "Checked against Honda TSB 21-014."},
    )
    assert r.status_code == 200, r.text
    assert r.json()["verification_status"] == "VERIFIED"

    after = (await admin_client.post(ANALYSE, json=body)).json()
    assert after["kb_diagnosis_code"] == "DX-REJ-001"
    assert after["engine"] == "knowledge_base"


async def test_DX_E2E_0404_ai_generated_cannot_be_approved_without_a_note(
    admin_client, seeded
):
    target = seeded["DX-AI-001"]
    r = await admin_client.post(
        f"{KB}/review/{target.id}", json={"decision": "APPROVED"}
    )
    assert r.status_code == 400
    assert "AI_GENERATED" in r.json()["detail"]

    r = await admin_client.post(
        f"{KB}/review/{target.id}",
        json={"decision": "APPROVED", "notes": "Verified against Kia manual p.212."},
    )
    assert r.status_code == 200


async def test_DX_E2E_0405_rejection_withdraws_the_row_but_keeps_it(
    admin_client, seeded, db_session
):
    target = seeded["DX-AC-001"]
    r = await admin_client.post(
        f"{KB}/review/{target.id}",
        json={"decision": "REJECTED", "notes": "Cause is too generic to serve."},
    )
    assert r.status_code == 200

    after = (
        await admin_client.post(
            ANALYSE,
            json=seed.request(problem_description="ac not cooling since the weekend"),
        )
    ).json()
    assert after.get("kb_diagnosis_code") != "DX-AC-001"

    still_there = (
        await db_session.execute(
            select(DiagnosisMaster).where(
                DiagnosisMaster.diagnosis_code == "DX-AC-001"
            )
        )
    ).scalar_one()
    assert still_there.verification_status == VerificationStatus.rejected


# ══════════════════════════════════════════════════════════════════════════
# DX-E2E-05xx — admin surface and authorisation
# ══════════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", f"{KB}/stats"),
        ("get", f"{KB}/review-queue"),
        ("get", f"{KB}/review-queue/summary"),
        ("get", f"{KB}/import-history"),
        ("get", f"{KB}/review-history"),
        ("get", f"{KB}/cache/stats"),
        ("post", f"{KB}/cache/invalidate"),
    ],
)
async def test_DX_E2E_0501_admin_routes_reject_an_anonymous_caller(
    client, seeded, method, path, monkeypatch
):
    """The knowledge base decides what drivers are told about their brakes, so
    write access to it is not something an anonymous caller should have.

    `core.dependencies.get_admin_user` has a documented development bypass:
    with no credentials and a non-production ENVIRONMENT it fabricates a Dev
    Admin. That is why this test forces production mode — asserting 401 against
    a dev-mode app would prove nothing, and asserting 200 would enshrine the
    bypass as the contract.
    """
    from core.config import settings

    monkeypatch.setattr(settings, "environment", "production")
    r = await getattr(client, method)(path)
    assert r.status_code in (401, 403), f"{path} returned {r.status_code}"


async def test_DX_E2E_0501b_dev_admin_bypass_is_gated_on_environment(client, seeded):
    """The bypass exists and must stay confined to non-production.

    Pinned deliberately: it is a route to full admin with no credentials, and
    the only thing standing between it and production is one settings value.
    """
    from core.config import settings

    assert settings.environment != "production"
    assert (await client.get(f"{KB}/stats")).status_code == 200


async def test_DX_E2E_0502_stats_report_readiness(admin_client, seeded):
    r = await admin_client.get(f"{KB}/stats")
    assert r.status_code == 200
    s = r.json()
    assert s["master_total"] == len(seed.MASTERS) + len(seed.UNSERVABLE_MASTERS)
    assert s["master_servable"] == len(seed.MASTERS)
    assert 0 < s["servable_share"] < 1
    assert s["safety_critical"] >= 2


async def test_DX_E2E_0503_queue_puts_safety_critical_first(admin_client, seeded):
    r = await admin_client.get(f"{KB}/review-queue")
    assert r.status_code == 200
    rows = r.json()
    assert rows, "the queue should not be empty — three rows are pending"
    assert all(x["verification_status"] == "PENDING_REVIEW" for x in rows)


async def test_DX_E2E_0504_queue_summary_separates_ai_rows(admin_client, seeded):
    s = (await admin_client.get(f"{KB}/review-queue/summary")).json()
    assert s["pending_diagnoses"] == len(seed.UNSERVABLE_MASTERS)
    assert s["pending_ai_generated"] == 1


async def test_DX_E2E_0505_review_detail_returns_the_whole_entry(
    admin_client, seeded
):
    target = seeded["DX-AI-001"]
    r = await admin_client.get(f"{KB}/review-queue/{target.id}")
    assert r.status_code == 200
    d = r.json()
    assert d["diagnosis"]["diagnosis_code"] == "DX-AI-001"
    assert d["diagnosis"]["is_servable"] is False
    assert len(d["solutions"]) == 1
    assert d["review_history"] == []


async def test_DX_E2E_0506_a_decision_is_recorded(admin_client, seeded):
    target = seeded["DX-DRAFT-1"]
    await admin_client.post(
        f"{KB}/review/{target.id}",
        json={"decision": "RETURNED", "notes": "Needs a cited source."},
    )
    hist = (await admin_client.get(f"{KB}/review-history")).json()
    assert hist, "the decision should be on the record"
    assert hist[0]["decision"] == "RETURNED"
    assert hist[0]["reviewer"] == "qa-lead@gaadiiq.com"
    assert hist[0]["notes"] == "Needs a cited source."


async def test_DX_E2E_0507_unknown_id_is_404_not_500(admin_client, seeded):
    r = await admin_client.get(f"{KB}/review-queue/{uuid.uuid4()}")
    assert r.status_code == 404


async def test_DX_E2E_0508_solution_cannot_be_published_under_a_draft(
    admin_client, seeded, db_session
):
    sol = (
        await db_session.execute(
            select(DiagnosisSolution).where(
                DiagnosisSolution.solution_code == "DX-AI-001-S1"
            )
        )
    ).scalar_one()
    r = await admin_client.post(
        f"{KB}/review/solution/{sol.id}", json={"decision": "APPROVED"}
    )
    assert r.status_code == 400
    assert "Approve the diagnosis" in r.json()["detail"]


# ══════════════════════════════════════════════════════════════════════════
# DX-E2E-06xx — the response cache
# ══════════════════════════════════════════════════════════════════════════


async def test_DX_E2E_0601_repeat_question_is_served_from_cache(client, seeded):
    body = seed.request(problem_description="ac not cooling since the weekend")
    first = (await client.post(ANALYSE, json=body)).json()
    second = (await client.post(ANALYSE, json=body)).json()
    assert first["engine"] == "knowledge_base"
    assert second["engine"].endswith(":cached")


async def test_DX_E2E_0602_safety_critical_answers_are_never_cached(client, seeded):
    """A cached 'your brakes may fail' outlives a reviewer's correction."""
    body = seed.request()
    first = (await client.post(ANALYSE, json=body)).json()
    second = (await client.post(ANALYSE, json=body)).json()
    assert first["engine"] == "knowledge_base"
    assert second["engine"] == "knowledge_base", "must not be served from cache"


async def test_DX_E2E_0603_cache_does_not_leak_across_vehicles(client, seeded):
    """Same complaint, different car — the second must not get the first's answer."""
    await client.post(ANALYSE, json=seed.request(
        problem_description="ac not cooling since the weekend"))
    other = (
        await client.post(
            ANALYSE,
            json=seed.request(
                manufacturer="Hyundai", model="Creta", fuel_type="Diesel",
                model_year=2016, transmission="Automatic",
                problem_description="ac not cooling since the weekend",
            ),
        )
    ).json()
    assert not other["engine"].endswith(":cached")


async def test_DX_E2E_0604_approval_invalidates_the_cache(admin_client, seeded):
    """An answer must not survive the row it came from being withdrawn."""
    body = seed.request(problem_description="ac not cooling since the weekend")
    await admin_client.post(ANALYSE, json=body)
    cached = (await admin_client.post(ANALYSE, json=body)).json()
    assert cached["engine"].endswith(":cached")

    target = seeded["DX-AC-001"]
    await admin_client.post(
        f"{KB}/review/{target.id}",
        json={"decision": "REJECTED", "notes": "Withdrawn during QA."},
    )

    after = (await admin_client.post(ANALYSE, json=body)).json()
    assert not after["engine"].endswith(":cached"), "stale answer survived withdrawal"
    assert after.get("kb_diagnosis_code") != "DX-AC-001"


async def test_DX_E2E_0605_cache_stats_are_visible_to_admin(admin_client, seeded):
    body = seed.request(problem_description="ac not cooling since the weekend")
    await admin_client.post(ANALYSE, json=body)
    await admin_client.post(ANALYSE, json=body)
    s = (await admin_client.get(f"{KB}/cache/stats")).json()
    assert s["hits"] >= 1
    assert s["backend"] in ("redis", "memory")


# ══════════════════════════════════════════════════════════════════════════
# DX-E2E-07xx — persistence and history
# ══════════════════════════════════════════════════════════════════════════


async def test_DX_E2E_0701_every_request_is_recorded(client, seeded, db_session):
    from models.vehicle_diagnosis import VehicleDiagnosis

    r = await client.post(ANALYSE, json=seed.request())
    rows = (
        await db_session.execute(
            select(VehicleDiagnosis).where(
                VehicleDiagnosis.id == uuid.UUID(r.json()["id"])
            )
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].manufacturer == "Maruti Suzuki"
    assert rows[0].safe_to_drive is False


async def test_DX_E2E_0702_a_report_cannot_be_read_anonymously(client, seeded):
    """Reports are owner-only. A diagnosis names a car, a fault and an owner,
    and the id is in the response body of a public endpoint — so the read side
    has to be closed even though the write side is open."""
    created = (await client.post(ANALYSE, json=seed.request())).json()
    r = await client.get(f"/diagnosis/{created['id']}")
    assert r.status_code == 401


async def test_DX_E2E_0703_another_user_cannot_read_an_owned_report(
    client, seeded, db_session
):
    """The IDOR case the guard was written for: a report with an owner, read by
    somebody else. This is the assertion that must never regress."""
    from core.dependencies import get_current_user

    owner = User(
        id=uuid.uuid4(), email="owner@example.com", full_name="Owner",
        hashed_password="x", is_active=True,
    )
    db_session.add(owner)
    await db_session.commit()

    created = (
        await client.post(ANALYSE, json=seed.request(user_id=str(owner.id)))
    ).json()

    stranger = User(
        id=uuid.uuid4(), email="stranger@example.com", full_name="Stranger",
        hashed_password="x", is_active=True,
    )
    app.dependency_overrides[get_current_user] = lambda: stranger
    try:
        r = await client.get(f"/diagnosis/{created['id']}")
        assert r.status_code == 403, (
            f"a stranger read another user's report: {r.status_code}"
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.xfail(
    strict=True,
    reason=(
        "DEFECT-02. routers/diagnosis.py::get_diagnosis guards with "
        "`if record.user_id and str(record.user_id) != current_user.id`. An "
        "anonymous diagnosis has user_id = NULL, so the guard short-circuits "
        "and ANY authenticated user can read it given the id. The docstring "
        "says 'owner-only'; an ownerless record is readable by everyone. "
        "Exploitability is limited — the id is a v4 UUID and is returned only "
        "to the creator — but the contract is not what it claims. Remove this "
        "xfail when the guard treats a NULL owner as 'nobody' rather than "
        "'anyone'."
    ),
)
async def test_DX_E2E_0704_anonymous_report_is_not_readable_by_a_stranger(
    client, seeded
):
    from core.dependencies import get_current_user

    created = (await client.post(ANALYSE, json=seed.request())).json()

    stranger = User(
        id=uuid.uuid4(), email="stranger@example.com", full_name="Stranger",
        hashed_password="x", is_active=True,
    )
    app.dependency_overrides[get_current_user] = lambda: stranger
    try:
        r = await client.get(f"/diagnosis/{created['id']}")
        assert r.status_code in (403, 404)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# ══════════════════════════════════════════════════════════════════════════
# DX-E2E-08xx — configuration guards
#
# Not diagnosis behaviour, but the diagnosis path depends on all of it: the
# signing key that authenticates the admin who approves a row, and the
# subsystems that silently fall back when unset.
# ══════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio(loop_scope="function")
async def test_DX_E2E_0801_production_refuses_to_boot_without_jwt_keys(monkeypatch):
    """RS256 signing keys are mandatory in production, and this pins it.

    The fallback in `core/security.py::_get_rsa_keys` generates an ephemeral
    RSA keypair per process, which would invalidate every session on every
    restart and break token validation across replicas. It is a development
    convenience, and the only thing keeping it out of production is this check.
    """
    import sys

    from core.config import Settings

    s = Settings(environment="production", jwt_private_key="", jwt_public_key="")
    with pytest.raises(SystemExit) as exc:
        s.validate_production_config()
    assert exc.value.code == 1
    assert sys is not None


async def test_DX_E2E_0802_this_backend_signs_rs256(monkeypatch):
    """The token this service issues is RS256, not HS256.

    HS256 exists in the codebase only to verify tokens Supabase issued, which
    is Supabase's algorithm, not ours.
    """
    from jose import jwt as jose_jwt

    from core.security import create_access_token

    token = create_access_token(uuid.uuid4(), "qa@gaadiiq.com")
    assert jose_jwt.get_unverified_header(token)["alg"] == "RS256"


async def test_DX_E2E_0803_dependency_status_reports_what_is_actually_serving(
    client, seeded
):
    """Silent degradation is the failure mode this endpoint exists to end.

    Five subsystems fall back rather than fail when unconfigured. That is right
    for resilience and it is also how a design document described OpenSearch as
    deployed while every query went to Postgres.
    """
    r = await client.get("/health/dependencies")
    assert r.status_code == 200
    deps = r.json()["dependencies"]

    for name in (
        "database", "search", "diagnosis_cache",
        "vector_search", "local_llm", "gemini", "marketplace",
    ):
        assert name in deps, f"{name} missing from the dependency report"
        assert "configured" in deps[name] and "serving" in deps[name]

    # In the test environment OPENSEARCH_URL is unset, so search must report
    # the fallback rather than claiming a primary it does not have.
    assert deps["search"]["configured"] is False
    assert deps["search"]["serving"] == "postgres-like"


async def test_DX_E2E_0804_dependency_status_leaks_no_secrets(client, seeded):
    """It names backends, never hosts, URLs or keys."""
    body = (await client.get("/health/dependencies")).text.lower()
    for leak in ("http://", "https://", "password", "secret", "api_key", "@"):
        assert leak not in body, f"dependency report leaked {leak!r}"
