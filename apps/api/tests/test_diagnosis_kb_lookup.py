"""The KB-first answer path: what gets served, and — mostly — what does not.

The assertions worth reading are the refusals. A knowledge base that returns a
curated answer for a question it understands is the easy half; the half that
matters is that it stays quiet when the row does not actually apply to the car
in front of it, because a stored answer is presented to a driver as fact and
carries no hedging.
"""

import uuid

import pytest
from sqlalchemy import select

from models.diagnosis_kb import (
    CanDrive,
    DiagnosisMaster,
    DiagnosisReviewEvent,
    DiagnosisSolution,
    DiagnosisSymptomAlias,
    Difficulty,
    RecordStatus,
    ReviewDecision,
    Severity,
    SolutionType,
    SourceType,
    VerificationStatus,
)
from services import diagnosis_cache, diagnosis_kb_lookup, diagnosis_kb_review
from services.diagnosis_kb_lookup import lookup, to_result
from services.diagnosis_kb_review import ReviewError

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _clean_module_state():
    """The lookup indexes and the cache are process-global by design.

    Without this, one test's alias table answers the next test's query and the
    failure looks like a lookup bug rather than shared state.
    """
    diagnosis_kb_lookup.reset_caches()
    diagnosis_cache._reset_for_tests()
    yield
    diagnosis_kb_lookup.reset_caches()
    diagnosis_cache._reset_for_tests()


async def make_master(db, *, servable=True, **over):
    row = DiagnosisMaster(
        diagnosis_code=over.pop("diagnosis_code", f"T-{uuid.uuid4().hex[:8]}"),
        manufacturer=over.pop("manufacturer", "Tata"),
        model=over.pop("model", "Nexon"),
        model_year_from=over.pop("model_year_from", 2017),
        model_year_to=over.pop("model_year_to", 2023),
        fuel_type=over.pop("fuel_type", "Petrol"),
        system=over.pop("system", "Engine"),
        canonical_symptom=over.pop("canonical_symptom", "ENGINE_MISFIRE"),
        symptom=over.pop("symptom", "Engine misfires under load"),
        user_keywords=over.pop("user_keywords", "misfire|juddering"),
        possible_cause=over.pop("possible_cause", "Worn ignition coil"),
        diagnostic_steps=over.pop("diagnostic_steps", "Read the DTC, swap coils"),
        severity=over.pop("severity", Severity.medium),
        safety_critical=over.pop("safety_critical", False),
        can_drive=over.pop("can_drive", CanDrive.limited),
        recommended_action=over.pop("recommended_action", "Book a workshop visit"),
        requires_professional=over.pop("requires_professional", True),
        source_type=over.pop("source_type", SourceType.technical),
        source_name=over.pop("source_name", "Workshop manual"),
        confidence_score=over.pop("confidence_score", 0.8),
        status=over.pop(
            "status", RecordStatus.active if servable else RecordStatus.draft
        ),
        verification_status=over.pop(
            "verification_status",
            VerificationStatus.verified if servable else VerificationStatus.pending_review,
        ),
        **over,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def make_solution(db, master, *, servable=True, **over):
    sol = DiagnosisSolution(
        solution_code=over.pop("solution_code", f"S-{uuid.uuid4().hex[:8]}"),
        diagnosis_id=master.id,
        sequence=over.pop("sequence", 1),
        solution_title=over.pop("solution_title", "Replace the ignition coil"),
        solution_type=over.pop("solution_type", SolutionType.part_replacement),
        difficulty=over.pop("difficulty", Difficulty.mechanic),
        is_temporary_fix=over.pop("is_temporary_fix", False),
        resolves_root_cause=over.pop("resolves_root_cause", True),
        steps=over.pop("steps", "Unclip the coil\nFit the new one"),
        source_type=over.pop("source_type", SourceType.technical),
        source_name=over.pop("source_name", "Workshop manual"),
        status=RecordStatus.active if servable else RecordStatus.draft,
        verification_status=(
            VerificationStatus.verified if servable else VerificationStatus.pending_review
        ),
        **over,
    )
    db.add(sol)
    await db.commit()
    await db.refresh(sol)
    return sol


async def make_alias(db, phrase, canonical="ENGINE_MISFIRE"):
    from services.diagnosis_kb_import import normalise_phrase

    row = DiagnosisSymptomAlias(
        canonical_symptom=canonical,
        user_phrase=phrase,
        normalised_phrase=normalise_phrase(phrase),
        language="en",
        status=RecordStatus.active,
    )
    db.add(row)
    await db.commit()
    return row


# ── the ladder ──────────────────────────────────────────────────────────────


async def test_alias_exact_match_answers_without_a_model(db_session):
    master = await make_master(db_session)
    await make_solution(db_session, master)
    await make_alias(db_session, "car juddering")

    answer = await lookup(
        db_session,
        problem_description="Car juddering",
        manufacturer="Tata",
        model="Nexon",
        fuel_type="Petrol",
        model_year=2020,
    )

    assert answer is not None
    assert answer.master.diagnosis_code == master.diagnosis_code
    assert answer.match_method == "alias"
    assert answer.match_confidence == 1.0
    assert len(answer.solutions) == 1


async def test_alias_found_inside_a_sentence(db_session):
    master = await make_master(db_session)
    await make_alias(db_session, "car juddering")

    answer = await lookup(
        db_session,
        problem_description="Since Tuesday my car juddering when I go uphill",
        manufacturer="Tata",
        model="Nexon",
        fuel_type="Petrol",
        model_year=2020,
    )

    assert answer is not None
    assert answer.master.diagnosis_code == master.diagnosis_code
    # Lower than an exact phrase match: the rest of the sentence is unexamined.
    assert answer.match_confidence == 0.85


async def test_alias_does_not_match_inside_a_longer_word(db_session):
    """'ac' must not fire on 'acceleration'."""
    await make_master(db_session, canonical_symptom="AC_WEAK")
    await make_alias(db_session, "ac", canonical="AC_WEAK")

    answer = await lookup(
        db_session,
        problem_description="hesitation during acceleration",
        manufacturer="Tata",
        model="Nexon",
        fuel_type="Petrol",
        model_year=2020,
    )
    assert answer is None


async def test_a_draft_row_is_never_served(db_session):
    await make_master(db_session, servable=False)
    await make_alias(db_session, "car juddering")

    answer = await lookup(
        db_session,
        problem_description="car juddering",
        manufacturer="Tata",
        model="Nexon",
        fuel_type="Petrol",
        model_year=2020,
    )
    assert answer is None


async def test_active_but_unverified_is_not_served(db_session):
    """Both gates, independently. One is not enough."""
    await make_master(
        db_session,
        servable=False,
        status=RecordStatus.active,
        verification_status=VerificationStatus.pending_review,
    )
    await make_alias(db_session, "car juddering")

    assert await lookup(
        db_session,
        problem_description="car juddering",
        manufacturer="Tata",
        model="Nexon",
        fuel_type="Petrol",
        model_year=2020,
    ) is None


async def test_wrong_manufacturer_is_not_answered(db_session):
    await make_master(db_session, manufacturer="Tata", model="Nexon")
    await make_alias(db_session, "car juddering")

    assert await lookup(
        db_session,
        problem_description="car juddering",
        manufacturer="Maruti",
        model="Swift",
        fuel_type="Petrol",
        model_year=2020,
    ) is None


async def test_year_outside_the_row_range_is_not_answered(db_session):
    await make_master(db_session, model_year_from=2015, model_year_to=2018)
    await make_alias(db_session, "car juddering")

    assert await lookup(
        db_session,
        problem_description="car juddering",
        manufacturer="Tata",
        model="Nexon",
        fuel_type="Petrol",
        model_year=2023,
    ) is None


async def test_any_scope_matches_every_vehicle(db_session):
    await make_master(db_session, manufacturer="ANY", model="ANY", fuel_type="ANY")
    await make_alias(db_session, "car juddering")

    answer = await lookup(
        db_session,
        problem_description="car juddering",
        manufacturer="Kia",
        model="Seltos",
        fuel_type="Diesel",
        model_year=2021,
    )
    assert answer is not None


async def test_specific_row_beats_generic_even_with_lower_confidence(db_session):
    await make_master(
        db_session,
        diagnosis_code="GENERIC",
        manufacturer="ANY",
        model="ANY",
        fuel_type="ANY",
        confidence_score=0.99,
    )
    await make_master(
        db_session,
        diagnosis_code="SPECIFIC",
        manufacturer="Tata",
        model="Nexon",
        confidence_score=0.4,
    )
    await make_alias(db_session, "car juddering")

    answer = await lookup(
        db_session,
        problem_description="car juddering",
        manufacturer="Tata",
        model="Nexon",
        fuel_type="Petrol",
        model_year=2020,
    )
    assert answer is not None
    assert answer.master.diagnosis_code == "SPECIFIC"


async def test_dtc_outranks_the_prose(db_session):
    await make_master(db_session, diagnosis_code="BY-PROSE")
    await make_master(
        db_session, diagnosis_code="BY-CODE", error_code="P0301",
        canonical_symptom="SOMETHING_ELSE",
    )
    await make_alias(db_session, "car juddering")

    answer = await lookup(
        db_session,
        problem_description="car juddering",
        manufacturer="Tata",
        model="Nexon",
        fuel_type="Petrol",
        model_year=2020,
        error_codes=["P0301"],
    )
    assert answer is not None
    assert answer.master.diagnosis_code == "BY-CODE"
    assert answer.match_method == "dtc"


async def test_unknown_symptom_falls_through(db_session):
    await make_master(db_session)
    await make_alias(db_session, "car juddering")

    assert await lookup(
        db_session,
        problem_description="the boot latch rattles",
        manufacturer="Tata",
        model="Nexon",
        fuel_type="Petrol",
        model_year=2020,
    ) is None


async def test_empty_knowledge_base_falls_through_quietly(db_session):
    assert await lookup(
        db_session, problem_description="anything at all", manufacturer="Tata"
    ) is None


async def test_only_servable_solutions_are_attached(db_session):
    master = await make_master(db_session)
    await make_solution(db_session, master, sequence=1, solution_title="Approved fix")
    await make_solution(
        db_session, master, sequence=2, solution_title="Draft fix", servable=False
    )
    await make_alias(db_session, "car juddering")

    answer = await lookup(
        db_session,
        problem_description="car juddering",
        manufacturer="Tata",
        model="Nexon",
        fuel_type="Petrol",
        model_year=2020,
    )
    assert [s.solution_title for s in answer.solutions] == ["Approved fix"]


# ── shaping the response ────────────────────────────────────────────────────


async def test_unknown_drivability_reads_as_do_not_drive(db_session):
    """The response field is a boolean. 'We don't know' must not render as safe."""
    master = await make_master(db_session, can_drive=CanDrive.unknown)
    await make_alias(db_session, "car juddering")
    answer = await lookup(
        db_session, problem_description="car juddering", manufacturer="Tata",
        model="Nexon", fuel_type="Petrol", model_year=2020,
    )
    result = to_result(answer, disclaimer="x")
    assert result["safe_to_drive"] is False
    assert master.can_drive == CanDrive.unknown


async def test_temporary_fix_is_labelled_in_the_steps(db_session):
    master = await make_master(db_session)
    await make_solution(
        db_session, master, sequence=1, solution_title="Top up coolant",
        is_temporary_fix=True, resolves_root_cause=False,
        solution_type=SolutionType.temporary_fix, difficulty=Difficulty.diy,
    )
    await make_solution(
        db_session, master, sequence=2, solution_title="Replace the hose",
    )
    await make_alias(db_session, "car juddering")

    answer = await lookup(
        db_session, problem_description="car juddering", manufacturer="Tata",
        model="Nexon", fuel_type="Petrol", model_year=2020,
    )
    result = to_result(answer, disclaimer="x")
    assert "temporary" in result["recommended_steps"][0].lower()
    assert result["diy_fixes"] == ["Top up coolant"]
    assert result["engine"] == "knowledge_base"


async def test_safety_critical_forces_immediate_service(db_session):
    master = await make_master(
        db_session, safety_critical=True, severity=Severity.critical,
        can_drive=CanDrive.no, requires_professional=False,
    )
    await make_alias(db_session, "car juddering")
    answer = await lookup(
        db_session, problem_description="car juddering", manufacturer="Tata",
        model="Nexon", fuel_type="Petrol", model_year=2020,
    )
    result = to_result(answer, disclaimer="x")
    assert answer.safety_critical is True
    assert result["immediate_service_required"] is True
    assert result["risk_level"] == "Critical"
    assert master.safety_critical


# ── the cache ───────────────────────────────────────────────────────────────


async def test_cache_key_separates_two_different_cars():
    a = diagnosis_cache.build_key(
        normalised_question="loud knocking on startup", manufacturer="Tata",
        model="Nexon", model_year=2012, fuel_type="Diesel",
    )
    b = diagnosis_cache.build_key(
        normalised_question="loud knocking on startup", manufacturer="Tata",
        model="Nexon", model_year=2022, fuel_type="Petrol",
    )
    assert a != b


async def test_cache_round_trip():
    key = diagnosis_cache.build_key(
        normalised_question="q", manufacturer="Tata", model="Nexon",
        model_year=2020, fuel_type="Petrol",
    )
    assert await diagnosis_cache.get(key) is None
    await diagnosis_cache.put(key, {"engine": "gemini", "risk_level": "Low"})
    assert (await diagnosis_cache.get(key))["engine"] == "gemini"


async def test_heuristic_answers_are_never_cached():
    assert diagnosis_cache.is_cacheable({"engine": "heuristic"}, has_images=False) is False


async def test_critical_answers_are_never_cached():
    assert diagnosis_cache.is_cacheable(
        {"engine": "gemini", "risk_level": "Critical"}, has_images=False
    ) is False
    assert diagnosis_cache.is_cacheable(
        {"engine": "gemini", "immediate_service_required": True}, has_images=False
    ) is False


async def test_photo_requests_are_never_cached():
    assert diagnosis_cache.is_cacheable({"engine": "gemini"}, has_images=True) is False


async def test_invalidate_clears_everything():
    key = diagnosis_cache.build_key(
        normalised_question="q", manufacturer="a", model="b",
        model_year=2020, fuel_type="Petrol",
    )
    await diagnosis_cache.put(key, {"engine": "gemini"})
    await diagnosis_cache.invalidate_all()
    assert await diagnosis_cache.get(key) is None


# ── the review queue ────────────────────────────────────────────────────────


async def test_approval_sets_both_gates_and_the_solutions(db_session):
    master = await make_master(db_session, servable=False)
    await make_solution(db_session, master, servable=False)

    outcome = await diagnosis_kb_review.review_diagnosis(
        db_session,
        diagnosis_id=master.id,
        decision=ReviewDecision.approved,
        reviewer="reviewer@gaadiiq.com",
    )
    assert outcome.status == "ACTIVE"
    assert outcome.verification_status == "VERIFIED"
    assert outcome.solutions_affected == 1

    await db_session.refresh(master)
    assert master.is_servable
    assert master.reviewed_by == "reviewer@gaadiiq.com"
    assert master.reviewed_at is not None

    sol = (await db_session.execute(select(DiagnosisSolution))).scalar_one()
    assert sol.is_servable


async def test_approved_row_becomes_answerable(db_session):
    """The whole point: approval is what makes a row reachable by a driver."""
    master = await make_master(db_session, servable=False)
    await make_alias(db_session, "car juddering")

    assert await lookup(
        db_session, problem_description="car juddering", manufacturer="Tata",
        model="Nexon", fuel_type="Petrol", model_year=2020,
    ) is None

    await diagnosis_kb_review.review_diagnosis(
        db_session, diagnosis_id=master.id,
        decision=ReviewDecision.approved, reviewer="r@x.com",
    )
    diagnosis_kb_lookup.reset_caches()

    answer = await lookup(
        db_session, problem_description="car juddering", manufacturer="Tata",
        model="Nexon", fuel_type="Petrol", model_year=2020,
    )
    assert answer is not None


async def test_rejection_keeps_the_row_and_records_why(db_session):
    master = await make_master(db_session, servable=False)

    await diagnosis_kb_review.review_diagnosis(
        db_session, diagnosis_id=master.id, decision=ReviewDecision.rejected,
        reviewer="r@x.com", notes="Cause does not match the symptom.",
    )
    await db_session.refresh(master)

    assert master.verification_status == VerificationStatus.rejected
    assert master.status == RecordStatus.inactive
    assert not master.is_servable
    # Still there — a deletion would destroy the evidence of what was proposed.
    assert (await db_session.execute(select(DiagnosisMaster))).scalars().all()

    event = (await db_session.execute(select(DiagnosisReviewEvent))).scalar_one()
    assert event.decision == ReviewDecision.rejected
    assert event.notes == "Cause does not match the symptom."
    assert event.previous_verification == "PENDING_REVIEW"


async def test_ai_generated_rows_cannot_be_approved_silently(db_session):
    master = await make_master(
        db_session, servable=False, source_type=SourceType.ai_generated
    )
    with pytest.raises(ReviewError, match="AI_GENERATED"):
        await diagnosis_kb_review.review_diagnosis(
            db_session, diagnosis_id=master.id,
            decision=ReviewDecision.approved, reviewer="r@x.com",
        )

    # With a note saying what it was checked against, it goes through.
    outcome = await diagnosis_kb_review.review_diagnosis(
        db_session, diagnosis_id=master.id, decision=ReviewDecision.approved,
        reviewer="r@x.com", notes="Checked against the 2021 workshop manual, p.114.",
    )
    assert outcome.verification_status == "VERIFIED"


async def test_a_solution_cannot_outrank_its_diagnosis(db_session):
    master = await make_master(db_session, servable=False)
    sol = await make_solution(db_session, master, servable=False)

    with pytest.raises(ReviewError, match="Approve the diagnosis"):
        await diagnosis_kb_review.review_solution(
            db_session, solution_id=sol.id,
            decision=ReviewDecision.approved, reviewer="r@x.com",
        )


async def test_returning_a_row_puts_it_back_in_the_queue(db_session):
    master = await make_master(db_session)  # already servable

    await diagnosis_kb_review.review_diagnosis(
        db_session, diagnosis_id=master.id, decision=ReviewDecision.returned,
        reviewer="r@x.com", notes="Needs a source.",
    )
    await db_session.refresh(master)
    assert not master.is_servable
    assert master.verification_status == VerificationStatus.pending_review


async def test_queue_counts_separate_ai_rows_and_safety_rows(db_session):
    await make_master(db_session, servable=False)
    await make_master(db_session, servable=False, source_type=SourceType.ai_generated)
    await make_master(db_session, servable=False, safety_critical=True)
    await make_master(db_session)  # verified, should not be counted

    counts = await diagnosis_kb_review.queue_counts(db_session)
    assert counts["pending_diagnoses"] == 3
    assert counts["pending_ai_generated"] == 1
    assert counts["pending_safety_critical"] == 1


async def test_queue_puts_safety_critical_first(db_session):
    await make_master(db_session, servable=False, diagnosis_code="ORDINARY")
    await make_master(db_session, servable=False, diagnosis_code="DANGEROUS",
                      safety_critical=True)

    rows = await diagnosis_kb_review.list_queue(db_session)
    assert rows[0].diagnosis_code == "DANGEROUS"


async def test_cannot_approve_a_row_with_nothing_in_it(db_session):
    master = await make_master(db_session, servable=False, recommended_action="   ")
    with pytest.raises(ReviewError, match="empty"):
        await diagnosis_kb_review.review_diagnosis(
            db_session, diagnosis_id=master.id,
            decision=ReviewDecision.approved, reviewer="r@x.com",
        )


# ── the semantic rung ───────────────────────────────────────────────────────
#
# fastembed is an optional dependency and is not installed in CI, so these
# tests inject a stand-in. That is enough to test what this module is actually
# responsible for: the ordering of the rungs, the similarity floor, and the
# fall-through — not the quality of somebody else's embedding model.


class _FakeEmbeddings:
    """Bag-of-words vectors over a fixed vocabulary. Crude, and deterministic."""

    VOCAB = ["brake", "grind", "juddering", "misfire", "boot", "latch", "rattle"]

    @staticmethod
    def _vec(text: str) -> list[float]:
        words = set(text.lower().split())
        return [1.0 if w in words else 0.0 for w in _FakeEmbeddings.VOCAB]

    @classmethod
    def embed_texts(cls, texts):
        return [cls._vec(t) for t in texts]

    @classmethod
    def embed_one(cls, text):
        return cls._vec(text)


@pytest.fixture
def fake_embeddings(monkeypatch):
    import sys
    import types

    module = types.ModuleType("services.embeddings")
    module.embed_texts = _FakeEmbeddings.embed_texts
    module.embed_one = _FakeEmbeddings.embed_one
    monkeypatch.setitem(sys.modules, "services.embeddings", module)
    diagnosis_kb_lookup.reset_caches()
    yield
    diagnosis_kb_lookup.reset_caches()


async def test_semantic_catches_a_phrasing_no_alias_covers(db_session, fake_embeddings):
    await make_master(
        db_session,
        diagnosis_code="SEM-1",
        symptom="brake grind",
        user_keywords="brake grind",
        possible_cause="brake pads worn",
    )
    # No alias at all — the only way to reach this row is the semantic rung.
    answer = await lookup(
        db_session,
        problem_description="brake grind",
        manufacturer="Tata",
        model="Nexon",
        fuel_type="Petrol",
        model_year=2020,
    )
    assert answer is not None
    assert answer.match_method == "semantic"
    assert answer.match_confidence >= diagnosis_kb_lookup.MIN_SEMANTIC_SIMILARITY


async def test_semantic_stays_quiet_below_the_floor(db_session, fake_embeddings):
    await make_master(
        db_session, diagnosis_code="SEM-2", symptom="brake grind",
        user_keywords="brake grind", possible_cause="pads",
    )
    # Shares no vocabulary at all, so similarity is 0.
    assert await lookup(
        db_session,
        problem_description="boot latch rattle",
        manufacturer="Tata",
        model="Nexon",
        fuel_type="Petrol",
        model_year=2020,
    ) is None


async def test_an_editors_alias_outranks_a_similarity_score(db_session, fake_embeddings):
    """A deliberate mapping must not be overruled by a vector."""
    await make_master(
        db_session, diagnosis_code="BY-SIMILARITY", canonical_symptom="OTHER",
        symptom="brake grind", user_keywords="brake grind", possible_cause="x",
    )
    await make_master(
        db_session, diagnosis_code="BY-ALIAS", canonical_symptom="BRAKE_NOISE",
        symptom="unrelated words", user_keywords="unrelated", possible_cause="y",
    )
    await make_alias(db_session, "brake grind", canonical="BRAKE_NOISE")

    answer = await lookup(
        db_session,
        problem_description="brake grind",
        manufacturer="Tata",
        model="Nexon",
        fuel_type="Petrol",
        model_year=2020,
    )
    assert answer.master.diagnosis_code == "BY-ALIAS"
    assert answer.match_method == "alias"


async def test_missing_embeddings_degrades_to_no_semantic_step(db_session, monkeypatch):
    """The library is optional. Its absence must not fail a diagnosis."""
    import sys

    monkeypatch.setitem(sys.modules, "services.embeddings", None)
    diagnosis_kb_lookup.reset_caches()

    await make_master(db_session, symptom="brake grind", user_keywords="brake grind")
    # No alias, no exact match, and no embeddings — a clean fall-through, not a
    # traceback.
    assert await lookup(
        db_session, problem_description="brake grind", manufacturer="Tata",
        model="Nexon", fuel_type="Petrol", model_year=2020,
    ) is None


async def test_needing_a_mechanic_is_not_an_emergency(db_session):
    """`requires_professional` must not read as 'immediate service required'.

    A weak air conditioner needs a workshop and does not need one today. Marking
    it urgent both alarms the driver and makes the answer uncacheable.
    """
    await make_master(
        db_session,
        canonical_symptom="AC_WEAK",
        severity=Severity.low,
        safety_critical=False,
        can_drive=CanDrive.yes,
        requires_professional=True,
    )
    await make_alias(db_session, "ac not cooling", canonical="AC_WEAK")

    answer = await lookup(
        db_session, problem_description="ac not cooling", manufacturer="Tata",
        model="Nexon", fuel_type="Petrol", model_year=2020,
    )
    result = to_result(answer, disclaimer="x")
    assert result["immediate_service_required"] is False
    assert result["safe_to_drive"] is True
    assert diagnosis_cache.is_cacheable(result, has_images=False) is True


async def test_semantic_will_not_answer_for_the_wrong_car(db_session, fake_embeddings):
    """Similarity ranks; scope decides.

    This is a regression test for a real defect. The semantic rung applied no
    vehicle scope at all, so the exact rung would correctly refuse a Tata row
    for a Maruti — and similarity would then serve the very same row. It was
    invisible locally because the embedding model could not be downloaded, and
    only appeared in CI, where it is installed.
    """
    await make_master(
        db_session,
        diagnosis_code="TATA-ONLY",
        manufacturer="Tata",
        model="Nexon",
        symptom="brake grind",
        user_keywords="brake grind",
        possible_cause="brake pads",
    )
    assert await lookup(
        db_session,
        problem_description="brake grind",
        manufacturer="Maruti",
        model="Swift",
        fuel_type="Petrol",
        model_year=2020,
    ) is None


async def test_semantic_respects_the_year_range(db_session, fake_embeddings):
    await make_master(
        db_session,
        diagnosis_code="OLD-CARS-ONLY",
        model_year_from=2015,
        model_year_to=2018,
        symptom="brake grind",
        user_keywords="brake grind",
        possible_cause="brake pads",
    )
    assert await lookup(
        db_session,
        problem_description="brake grind",
        manufacturer="Tata",
        model="Nexon",
        fuel_type="Petrol",
        model_year=2023,
    ) is None


async def test_semantic_walks_past_an_out_of_scope_row(db_session, fake_embeddings):
    """The closest row may be for another car; the next one may be right."""
    await make_master(
        db_session,
        diagnosis_code="CLOSER-BUT-WRONG-CAR",
        manufacturer="Maruti",
        model="Swift",
        symptom="brake grind misfire",
        user_keywords="brake grind misfire",
        possible_cause="pads",
    )
    await make_master(
        db_session,
        diagnosis_code="RIGHT-CAR",
        manufacturer="Tata",
        model="Nexon",
        symptom="brake grind",
        user_keywords="brake grind",
        possible_cause="pads",
    )

    answer = await lookup(
        db_session,
        problem_description="brake grind misfire",
        manufacturer="Tata",
        model="Nexon",
        fuel_type="Petrol",
        model_year=2020,
    )
    assert answer is not None
    assert answer.master.diagnosis_code == "RIGHT-CAR"
