"""
GET /admin/diagnosis-kb/coverage.

`/stats` counts rows, which answers "how big is the corpus". It cannot answer
the question that decides what to curate next: which vehicles are falling
through to a model? These tests pin that distinction — most of them would pass
against a row-counting endpoint, so the ones that matter are the ones about
*demand*: a vehicle with no rows and no requests needs nothing, and must not
outrank a vehicle with no rows and two hundred requests.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

from models.diagnosis_kb import (
    DiagnosisMaster,
    RecordStatus,
    Severity,
    SourceType,
    VerificationStatus,
)
from models.vehicle_diagnosis import VehicleDiagnosis

# `db_session` comes from conftest; these two are worth sharing rather than
# duplicating — `client` in particular restores the rate limiter to whatever it
# found, which a copy would get wrong.
from .test_diagnosis_e2e import admin_client, client  # noqa: F401


def _master(manufacturer: str, model: str, *, servable: bool, code: str) -> DiagnosisMaster:
    return DiagnosisMaster(
        id=uuid.uuid4(),
        diagnosis_code=code,
        manufacturer=manufacturer,
        model=model,
        model_year_from=2015,
        model_year_to=2024,
        fuel_type="Petrol",
        system="Brakes",
        canonical_symptom="brake_squeal",
        symptom="Squealing on braking",
        user_keywords="squeal, screech",
        possible_cause="Worn pads",
        diagnostic_steps="Inspect pads",
        severity=Severity.medium,
        recommended_action="Replace pads",
        source_type=SourceType.technical,
        source_name="Workshop manual",
        confidence_score=0.9,
        status=RecordStatus.active if servable else RecordStatus.draft,
        verification_status=(
            VerificationStatus.verified if servable else VerificationStatus.pending_review
        ),
    )


def _request(manufacturer: str, model: str, engine: str | None, *, days_ago: int = 1):
    return VehicleDiagnosis(
        id=uuid.uuid4(),
        manufacturer=manufacturer,
        model=model,
        model_year=2019,
        fuel_type="Petrol",
        transmission="Manual",
        problem_description="Squealing when braking",
        severity="medium",
        engine=engine,
        created_at=datetime.now(timezone.utc) - timedelta(days=days_ago),
    )


@pytest_asyncio.fixture
async def corpus(db_session):
    db_session.add_all(
        [
            # Well covered and answered from the KB.
            _master("Maruti Suzuki", "Swift", servable=True, code="DX-SWIFT-1"),
            # Rows written but stuck in review — a backlog, not a gap.
            _master("Hyundai", "Creta", servable=False, code="DX-CRETA-1"),
            # Tata Nexon: no rows at all, and lots of demand.
        ]
    )
    db_session.add_all(
        [
            _request("Maruti Suzuki", "Swift", "knowledge_base"),
            _request("Maruti Suzuki", "Swift", "knowledge_base"),
            _request("Maruti Suzuki", "Swift", "openai"),
            _request("Hyundai", "Creta", "openai"),
            *[_request("Tata", "Nexon", "openai") for _ in range(5)],
            _request("Tata", "Nexon", "heuristic"),
        ]
    )
    await db_session.commit()


async def _coverage(admin_client, **params):
    res = await admin_client.get("/admin/diagnosis-kb/coverage", params=params)
    assert res.status_code == 200, res.text
    return res.json()


class TestKbCoverageSuite:
    @pytest.mark.asyncio
    async def test_ranks_the_biggest_gap_first(self, admin_client, corpus):
        # The whole point. Nexon has no rows and the most unanswered requests,
        # so it is what to curate next — ahead of Swift, which has more total
        # requests answered from the KB.
        body = await _coverage(admin_client)
        assert [(r["manufacturer"], r["model"]) for r in body["rows"]][0] == ("Tata", "Nexon")

    @pytest.mark.asyncio
    async def test_separates_a_review_backlog_from_a_curation_gap(self, admin_client, corpus):
        # Creta HAS a row; it is just not approved. That is fixed by a
        # reviewer, not by an author, so the report must not present it as
        # missing content.
        creta = next(r for r in (await _coverage(admin_client))["rows"] if r["model"] == "Creta")
        assert creta["verified_rows"] == 0
        assert creta["pending_rows"] == 1

    @pytest.mark.asyncio
    async def test_counts_which_rung_answered(self, admin_client, corpus):
        swift = next(r for r in (await _coverage(admin_client))["rows"] if r["model"] == "Swift")
        assert swift["requests"] == 3
        assert swift["kb_answers"] == 2
        assert swift["model_answers"] == 1
        assert swift["heuristic_answers"] == 0
        assert swift["fallthrough_rate"] == round(1 / 3, 3)

    @pytest.mark.asyncio
    async def test_heuristic_answers_are_counted_separately_from_model_answers(
        self, admin_client, corpus
    ):
        # A heuristic answer is keyword overlap, not a diagnosis. Folding it in
        # with GPT-4o would hide the worst outcome inside the acceptable one.
        nexon = next(r for r in (await _coverage(admin_client))["rows"] if r["model"] == "Nexon")
        assert nexon["model_answers"] == 5
        assert nexon["heuristic_answers"] == 1

    @pytest.mark.asyncio
    async def test_reports_the_overall_rate(self, admin_client, corpus):
        body = await _coverage(admin_client)
        assert body["total_requests"] == 10
        assert body["kb_answers"] == 2
        assert body["overall_fallthrough_rate"] == 0.8

    @pytest.mark.asyncio
    async def test_excludes_rows_from_before_the_engine_column_existed(
        self, admin_client, db_session, corpus
    ):
        # engine IS NULL means "we did not record it", not "the model answered
        # it". Guessing would report a fall-through rate that never happened.
        db_session.add(_request("Kia", "Seltos", None))
        await db_session.commit()
        body = await _coverage(admin_client)
        assert all(r["model"] != "Seltos" for r in body["rows"])
        assert body["total_requests"] == 10

    @pytest.mark.asyncio
    async def test_honours_the_window(self, admin_client, db_session, corpus):
        db_session.add(_request("Honda", "City", "openai", days_ago=200))
        await db_session.commit()

        recent = await _coverage(admin_client, window_days=30)
        assert all(r["model"] != "City" for r in recent["rows"])

        wide = await _coverage(admin_client, window_days=365)
        assert any(r["model"] == "City" for r in wide["rows"])

    @pytest.mark.asyncio
    async def test_matches_supply_to_demand_case_insensitively(
        self, admin_client, db_session, corpus
    ):
        # The KB row says "Maruti Suzuki"; a request could arrive as "maruti
        # suzuki". Matching on the raw string would report a covered vehicle as
        # having no rows — the same class of bug as the media library's
        # exact-match join.
        db_session.add(_request("maruti suzuki", "swift", "openai"))
        await db_session.commit()
        rows = (await _coverage(admin_client))["rows"]
        lower = next(r for r in rows if r["manufacturer"] == "maruti suzuki")
        assert lower["verified_rows"] == 1

    @pytest.mark.asyncio
    async def test_empty_history_does_not_divide_by_zero(self, admin_client):
        body = await _coverage(admin_client)
        assert body["total_requests"] == 0
        assert body["overall_fallthrough_rate"] == 0.0
        assert body["rows"] == []

    @pytest.mark.asyncio
    async def test_requires_an_admin(self, client, corpus, monkeypatch):
        # Production mode forced deliberately. `get_admin_user` has a
        # documented development bypass that fabricates a Dev Admin when there
        # are no credentials, so asserting against a dev-mode app would either
        # prove nothing or enshrine the bypass as the contract.
        from core.config import settings

        monkeypatch.setattr(settings, "environment", "production")
        res = await client.get("/admin/diagnosis-kb/coverage")
        assert res.status_code in (401, 403)
