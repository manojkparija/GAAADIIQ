"""Answer a diagnosis request from the knowledge base, before any model runs.

THE POINT OF THIS MODULE

`services/diagnosis.py` sends every request to an LLM. The hundredth driver to
report an overheating Swift costs exactly what the first one did, and gets an
answer nobody has reviewed. This module is the cheap path in front of that: a
curated row, written by a person and checked by a second person, returned with
no model involved.

THE LADDER, AND WHY IT IS ORDERED THIS WAY

    1. alias      an exact phrase the KB already knows       (index hit)
    2. exact      canonical symptom + vehicle scope          (index hit)
    3. semantic   embeddings, for phrasings nobody listed    (in-memory)

Cheapest and most certain first. Alias before semantic matters: an editor who
wrote "engine cranks but won't start" → HARD_START made a deliberate mapping,
and a similarity score should not be allowed to overrule it.

A miss at every rung returns None, and the caller falls through to the model.
Returning a weak match would be worse than returning nothing — the model at
least knows it is guessing, whereas a KB answer is presented as curated fact.

WHAT IS DELIBERATELY NOT HERE

No hedging language, no "this might be". A row that reaches a driver has passed
two human gates; if it needs hedging it should not have been verified. The
uncertainty is expressed by *not matching*, not by softening the answer.

SAFETY ORDERING

`safety_critical` is read before confidence is considered anywhere in this
module. A high-severity finding with a mediocre confidence score still gets
served, because the failure mode of withholding "your brakes may fail" to
protect a precision metric is not one worth having.
"""

from __future__ import annotations

import logging
import math
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.diagnosis_kb import (
    ANY_VEHICLE,
    CanDrive,
    DiagnosisMaster,
    DiagnosisSolution,
    DiagnosisSymptomAlias,
    RecordStatus,
    Severity,
    VerificationStatus,
)
from services.diagnosis_kb_import import normalise_phrase

logger = logging.getLogger("gaadiiq.kb_lookup")

# Below this cosine similarity a semantic "match" is noise. Set higher than the
# 0.25 used for the 12-row JSON KB: that file is tiny and a loose match there
# only nudged a prompt, whereas a match here is served to a driver as fact.
MIN_SEMANTIC_SIMILARITY = 0.62

# How long the alias table and the embedding index stay cached in-process.
# Aliases change only on import, so a short TTL costs nothing and means an
# import is reflected without a restart.
_INDEX_TTL_SECONDS = 300


class KbUnavailable(RuntimeError):
    """The KB could not be consulted — table missing, DB error, etc.

    Distinct from 'no match': the caller treats both as a fall-through to the
    model, but only this one is worth logging as a fault.
    """


@dataclass
class KbAnswer:
    """A knowledge-base answer, ready to be shaped into the API response."""

    master: DiagnosisMaster
    solutions: list[DiagnosisSolution]
    match_method: str          # alias | exact | dtc | semantic
    match_confidence: float    # 0..1, how sure the *match* is, not the content
    matched_on: str            # the phrase or code that matched, for logging

    @property
    def safety_critical(self) -> bool:
        return bool(self.master.safety_critical)


@dataclass
class _AliasIndex:
    """Normalised phrase → canonical symptom, plus the phrases sorted long-first.

    Longest-first matters: "brake warning light" and "warning light" may both be
    aliases, and the longer one is the more specific mapping.
    """

    exact: dict[str, str] = field(default_factory=dict)
    phrases: list[tuple[str, str]] = field(default_factory=list)
    built_at: float = 0.0


_alias_index: _AliasIndex | None = None
_vector_index: tuple[list[list[float]], list[str], float] | None = None


def reset_caches() -> None:
    """Drop the in-process indexes. Called after an import, and by tests."""
    global _alias_index, _vector_index
    _alias_index = None
    _vector_index = None


# ── step 1: aliases ─────────────────────────────────────────────────────────

async def _load_alias_index(db: AsyncSession) -> _AliasIndex:
    global _alias_index
    now = time.monotonic()
    if _alias_index is not None and now - _alias_index.built_at < _INDEX_TTL_SECONDS:
        return _alias_index

    rows = (
        await db.execute(
            select(
                DiagnosisSymptomAlias.normalised_phrase,
                DiagnosisSymptomAlias.canonical_symptom,
            ).where(DiagnosisSymptomAlias.status == RecordStatus.active)
        )
    ).all()

    exact = {phrase: canonical for phrase, canonical in rows if phrase}
    phrases = sorted(exact.items(), key=lambda kv: len(kv[0]), reverse=True)
    _alias_index = _AliasIndex(exact=exact, phrases=phrases, built_at=now)
    logger.info("Alias index built over %d phrases", len(exact))
    return _alias_index


def _contains_phrase(haystack: str, needle: str) -> bool:
    """Word-boundary containment on already-normalised text.

    Substring matching would fire "ac" inside "acceleration". Both strings are
    space-delimited words by the time they get here, so padding with spaces is
    enough and costs nothing.
    """
    return f" {needle} " in f" {haystack} "


async def _match_aliases(db: AsyncSession, normalised: str) -> tuple[list[str], str, float]:
    """Return (canonical symptoms, matched phrase, confidence).

    An exact whole-string match is confidence 1.0 — the driver typed precisely
    what an editor listed. A phrase found inside a longer sentence is 0.85: it
    is still a deliberate mapping, but the rest of the sentence is unexamined.
    """
    index = await _load_alias_index(db)
    if not index.exact:
        return [], "", 0.0

    hit = index.exact.get(normalised)
    if hit:
        return [hit], normalised, 1.0

    found: list[str] = []
    matched = ""
    for phrase, canonical in index.phrases:
        if _contains_phrase(normalised, phrase):
            if canonical not in found:
                found.append(canonical)
            if not matched:
                matched = phrase
        # Two distinct symptoms is already ambiguous; a third is noise.
        if len(found) >= 2:
            break
    return found, matched, 0.85 if found else 0.0


# ── step 2: exact lookup ────────────────────────────────────────────────────

def _scope_clause(column, value: str | None):
    """A vehicle-scope column matches its literal value or the ANY sentinel."""
    if not value:
        return column == ANY_VEHICLE
    return or_(func.lower(column) == value.strip().lower(), column == ANY_VEHICLE)


def _servable(model) -> Any:
    return (model.status == RecordStatus.active) & (
        model.verification_status == VerificationStatus.verified
    )


def _specificity(row: DiagnosisMaster) -> tuple:
    """Rank a match: the more precisely it is scoped, the better it fits.

    A row written for this exact model beats a row written for ANY vehicle, even
    if the generic row carries a higher confidence score — the generic row's
    confidence describes how sure we are of generic advice.
    """
    return (
        row.manufacturer != ANY_VEHICLE,
        row.model != ANY_VEHICLE,
        bool(row.engine_code),
        row.fuel_type != ANY_VEHICLE,
        row.confidence_score or 0.0,
    )


def _vehicle_scope_clauses(
    *,
    manufacturer: str | None,
    model: str | None,
    fuel_type: str | None,
    model_year: int | None,
    odometer_km: int | None,
) -> list:
    """Every predicate that decides whether a row applies to *this* car.

    Shared by the exact and semantic rungs, and shared deliberately. When the
    semantic rung had its own (absent) scoping, it answered a Maruti Swift with
    a Tata Nexon row and a 2023 car with a 2015-2018 row: the exact rung refused
    correctly, and then similarity served the same row anyway. A plausible
    answer for the wrong engine is the exact failure this module exists to
    prevent, so there is now one definition of scope rather than two.
    """
    clauses = [
        _scope_clause(DiagnosisMaster.manufacturer, manufacturer),
        _scope_clause(DiagnosisMaster.model, model),
        _scope_clause(DiagnosisMaster.fuel_type, fuel_type),
    ]
    # Year and odometer are ranges, not sentinels: a row that claims 2015-2020
    # must not answer for a 2023 car.
    if model_year:
        clauses += [
            DiagnosisMaster.model_year_from <= model_year,
            DiagnosisMaster.model_year_to >= model_year,
        ]
    if odometer_km is not None:
        clauses += [
            or_(DiagnosisMaster.odometer_from_km.is_(None),
                DiagnosisMaster.odometer_from_km <= odometer_km),
            or_(DiagnosisMaster.odometer_to_km.is_(None),
                DiagnosisMaster.odometer_to_km >= odometer_km),
        ]
    return clauses


async def _exact_lookup(
    db: AsyncSession,
    *,
    canonical_symptoms: list[str],
    manufacturer: str | None,
    model: str | None,
    fuel_type: str | None,
    model_year: int | None,
    odometer_km: int | None,
    error_codes: list[str] | None = None,
) -> DiagnosisMaster | None:
    """The narrow query: canonical symptom (or DTC) within the vehicle's scope."""
    if not canonical_symptoms and not error_codes:
        return None

    stmt = select(DiagnosisMaster).where(_servable(DiagnosisMaster))

    if error_codes:
        stmt = stmt.where(
            func.upper(DiagnosisMaster.error_code).in_([c.strip().upper() for c in error_codes])
        )
    else:
        stmt = stmt.where(DiagnosisMaster.canonical_symptom.in_(canonical_symptoms))

    stmt = stmt.where(
        *_vehicle_scope_clauses(
            manufacturer=manufacturer,
            model=model,
            fuel_type=fuel_type,
            model_year=model_year,
            odometer_km=odometer_km,
        )
    )

    rows = (await db.execute(stmt.limit(25))).scalars().all()
    if not rows:
        return None
    return max(rows, key=_specificity)


# ── step 3: semantic ────────────────────────────────────────────────────────

def _master_text(row: DiagnosisMaster) -> str:
    return " ".join(
        p for p in (row.symptom, row.user_keywords, row.possible_cause) if p
    ).strip()


async def _load_vector_index(
    db: AsyncSession,
) -> tuple[list[list[float]], list[uuid.UUID]] | None:
    """Embed every servable row once. None means semantic search is off.

    Embeddings are an optional dependency (`services/embeddings.py` imports
    fastembed lazily). Its absence must degrade to 'no semantic step', never to
    a failed diagnosis.
    """
    global _vector_index
    now = time.monotonic()
    if _vector_index is not None and now - _vector_index[2] < _INDEX_TTL_SECONDS:
        return _vector_index[0], _vector_index[1]

    rows = (
        await db.execute(
            select(DiagnosisMaster.id, DiagnosisMaster.symptom,
                   DiagnosisMaster.user_keywords, DiagnosisMaster.possible_cause)
            .where(_servable(DiagnosisMaster))
            .limit(5000)
        )
    ).all()
    if not rows:
        _vector_index = ([], [], now)
        return None

    texts = [" ".join(p for p in (r[1], r[2], r[3]) if p).strip() for r in rows]
    # UUID objects, not their string form: the primary key is a Uuid column and
    # comparing it to a str fails on SQLite. The broad except below would have
    # turned that into a silent fall-through to the model.
    ids = [r[0] for r in rows]

    try:
        from services.embeddings import embed_texts

        vectors = embed_texts(texts)
    except Exception as exc:
        logger.info("KB semantic index unavailable (%s); alias and exact only", exc)
        vectors = None

    if not vectors or len(vectors) != len(ids):
        # Cache the negative result too, so a missing model is not re-probed on
        # every single request.
        _vector_index = ([], [], now)
        return None

    _vector_index = (vectors, ids, now)
    logger.info("KB semantic index built over %d rows", len(ids))
    return vectors, ids


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


# How many similar rows to consider before giving up. The most similar row may
# be scoped to a different car, and the second may be the right one — but a
# query that has to walk far down the ranking is not really a match at all.
_SEMANTIC_CANDIDATES = 10


async def _semantic_lookup(
    db: AsyncSession,
    query: str,
    *,
    manufacturer: str | None = None,
    model: str | None = None,
    fuel_type: str | None = None,
    model_year: int | None = None,
    odometer_km: int | None = None,
) -> tuple[DiagnosisMaster | None, float]:
    """Similarity, then scope. Both, in that order, and never only the first."""
    index = await _load_vector_index(db)
    if not index:
        return None, 0.0
    vectors, ids = index

    try:
        from services.embeddings import embed_one

        qv = embed_one(query)
    except Exception:
        return None, 0.0
    if not qv:
        return None, 0.0

    scored = sorted(
        ((float(_cosine(qv, vec)), row_id) for vec, row_id in zip(vectors, ids)),
        key=lambda pair: pair[0],
        reverse=True,
    )
    candidates = [
        (score, row_id) for score, row_id in scored if score >= MIN_SEMANTIC_SIMILARITY
    ][:_SEMANTIC_CANDIDATES]
    if not candidates:
        return None, scored[0][0] if scored else 0.0

    # Similarity ranks; scope decides. A row that reads like the right answer
    # for a car it was never written about is worse than no answer, because it
    # is served with no hedging and the driver has no way to tell.
    in_scope = {
        row.id: row
        for row in (
            await db.execute(
                select(DiagnosisMaster).where(
                    DiagnosisMaster.id.in_([row_id for _, row_id in candidates]),
                    _servable(DiagnosisMaster),
                    *_vehicle_scope_clauses(
                        manufacturer=manufacturer,
                        model=model,
                        fuel_type=fuel_type,
                        model_year=model_year,
                        odometer_km=odometer_km,
                    ),
                )
            )
        ).scalars().all()
    }

    for score, row_id in candidates:
        if row_id in in_scope:
            return in_scope[row_id], score

    return None, candidates[0][0]


# ── the ladder ──────────────────────────────────────────────────────────────

async def lookup(
    db: AsyncSession,
    *,
    problem_description: str,
    warning_lights: list[str] | None = None,
    manufacturer: str | None = None,
    model: str | None = None,
    fuel_type: str | None = None,
    model_year: int | None = None,
    odometer_km: int | None = None,
    error_codes: list[str] | None = None,
) -> KbAnswer | None:
    """Try the knowledge base. None means 'ask the model'.

    Never raises for an empty or unreachable KB: an incomplete corpus is the
    normal state early on, and it must degrade to the existing behaviour rather
    than take the endpoint down.
    """
    normalised = normalise_phrase(
        " ".join([problem_description or "", " ".join(warning_lights or [])])
    )
    if not normalised:
        return None

    try:
        # A diagnostic trouble code is unambiguous — it identifies the fault
        # directly, so it outranks anything inferred from prose.
        if error_codes:
            row = await _exact_lookup(
                db,
                canonical_symptoms=[],
                error_codes=error_codes,
                manufacturer=manufacturer,
                model=model,
                fuel_type=fuel_type,
                model_year=model_year,
                odometer_km=odometer_km,
            )
            if row is not None:
                return await _with_solutions(db, row, "dtc", 1.0, ",".join(error_codes))

        canonical, matched_phrase, alias_conf = await _match_aliases(db, normalised)
        if canonical:
            row = await _exact_lookup(
                db,
                canonical_symptoms=canonical,
                manufacturer=manufacturer,
                model=model,
                fuel_type=fuel_type,
                model_year=model_year,
                odometer_km=odometer_km,
            )
            if row is not None:
                method = "alias" if alias_conf >= 1.0 else "exact"
                return await _with_solutions(db, row, method, alias_conf, matched_phrase)

        row, score = await _semantic_lookup(
            db,
            normalised,
            manufacturer=manufacturer,
            model=model,
            fuel_type=fuel_type,
            model_year=model_year,
            odometer_km=odometer_km,
        )
        if row is not None:
            return await _with_solutions(db, row, "semantic", round(score, 3), normalised)

    except Exception as exc:  # noqa: BLE001 — a KB fault must not fail the request
        logger.warning("KB lookup failed, falling through to the model: %s", exc)
        return None

    return None


async def _with_solutions(
    db: AsyncSession,
    master: DiagnosisMaster,
    method: str,
    confidence: float,
    matched_on: str,
) -> KbAnswer:
    """Attach the servable solutions, cheapest and safest first.

    Loaded explicitly rather than through the relationship: a lazy load on an
    async session raises MissingGreenlet, and the relationship would also return
    unreviewed rows.
    """
    solutions = (
        (
            await db.execute(
                select(DiagnosisSolution)
                .where(
                    DiagnosisSolution.diagnosis_id == master.id,
                    _servable(DiagnosisSolution),
                )
                .order_by(DiagnosisSolution.sequence)
            )
        )
        .scalars()
        .all()
    )
    return KbAnswer(
        master=master,
        solutions=list(solutions),
        match_method=method,
        match_confidence=confidence,
        matched_on=matched_on,
    )


# ── shaping the answer for the API ──────────────────────────────────────────

_SEVERITY_TO_RISK = {
    Severity.low: "Low",
    Severity.medium: "Medium",
    Severity.high: "High",
    Severity.critical: "Critical",
}

_CAN_DRIVE_TO_SAFE = {
    CanDrive.yes: True,
    CanDrive.no: False,
    CanDrive.limited: False,
    # UNKNOWN maps to False, not None: the response field is a boolean and the
    # caller renders it as advice. "We don't know" has to read as "don't risk
    # it", because the alternative renders as "safe to drive".
    CanDrive.unknown: False,
}

_DIFFICULTY_TO_COMPLEXITY = {
    "DIY": "Easy",
    "MECHANIC": "Moderate",
    "SPECIALIST": "Complex",
    "DEALER_ONLY": "Complex",
}


def _lines(text: str | None) -> list[str]:
    """Split a stored multi-line field into a list, dropping blanks."""
    if not text:
        return []
    return [ln.strip(" -•\t") for ln in text.splitlines() if ln.strip(" -•\t")]


def to_result(answer: KbAnswer, *, disclaimer: str) -> dict:
    """Render a KbAnswer into the same dict shape run_diagnosis returns.

    Same keys, same types, so the router and every client are unchanged. The
    only new information is `engine="knowledge_base"` and the match metadata,
    which is what makes the two paths distinguishable in logs and in the UI.
    """
    m = answer.master
    sols = answer.solutions

    diy = [s for s in sols if (s.difficulty.value if s.difficulty else "") == "DIY"]
    root = [s for s in sols if s.resolves_root_cause]
    primary = root[0] if root else (sols[0] if sols else None)

    cost_min = m.estimated_cost_min
    cost_max = m.estimated_cost_max
    if cost_min is None and cost_max is None and primary is not None:
        parts_min = (primary.cost_parts_min or 0) + (primary.cost_labour_min or 0)
        parts_max = (primary.cost_parts_max or 0) + (primary.cost_labour_max or 0)
        cost_min = parts_min or None
        cost_max = parts_max or None

    steps: list[str] = []
    for s in sols:
        head = s.solution_title
        if s.is_temporary_fix:
            head = f"{head} (temporary — does not fix the cause)"
        steps.append(head)

    return {
        "preliminary_diagnosis": m.symptom,
        "possible_causes": [
            {
                "cause": m.possible_cause,
                "likelihood": "High" if m.confidence_score >= 0.7 else "Medium",
                "explanation": m.diagnostic_steps or "",
            }
        ],
        "repair_complexity": (
            _DIFFICULTY_TO_COMPLEXITY.get(primary.difficulty.value, "Moderate")
            if primary is not None and primary.difficulty
            else "Moderate"
        ),
        "cost_min_inr": cost_min or 0,
        "cost_max_inr": cost_max or 0,
        "repair_time_estimate": (
            f"{primary.labour_hours_est:g} hours"
            if primary is not None and primary.labour_hours_est
            else "Unknown"
        ),
        # Read straight off the row. Not derived from confidence, and not
        # softened by the match method.
        "safe_to_drive": _CAN_DRIVE_TO_SAFE.get(m.can_drive, False),
        "risk_level": _SEVERITY_TO_RISK.get(m.severity, "Unknown"),
        "recommended_steps": steps or _lines(m.recommended_action),
        "diy_fixes": [s.solution_title for s in diy],
        # Needing a mechanic is not the same as needing one *now*. A weak air
        # conditioner requires a professional and is not urgent; folding
        # `requires_professional` in here marked every such row as immediate,
        # which both alarmed the driver and — because urgent answers are never
        # cached — meant nothing was ever cacheable.
        "immediate_service_required": bool(
            m.safety_critical or m.can_drive == CanDrive.no or m.severity == Severity.critical
        ),
        "preventive_maintenance": _lines(m.rule_out),
        "retrieved_sources": [m.source_name] if m.source_name else [],
        "ollama_used": False,
        "analysis_confidence": int(round((m.confidence_score or 0.0) * 100)),
        "disclaimer": disclaimer,
        "engine": "knowledge_base",
        "kb_diagnosis_code": m.diagnosis_code,
        "kb_match_method": answer.match_method,
        "kb_match_confidence": answer.match_confidence,
        "follow_up_questions": [],
        "needs_more_info": False,
        "solutions": [
            {
                "code": s.solution_code,
                "sequence": s.sequence,
                "title": s.solution_title,
                "type": s.solution_type.value if s.solution_type else None,
                "difficulty": s.difficulty.value if s.difficulty else None,
                "is_temporary_fix": s.is_temporary_fix,
                "resolves_root_cause": s.resolves_root_cause,
                "steps": _lines(s.steps),
                "safety_warning": s.safety_warning,
                "do_not_attempt_if": s.do_not_attempt_if,
                "cost_parts_min": s.cost_parts_min,
                "cost_parts_max": s.cost_parts_max,
                "cost_labour_min": s.cost_labour_min,
                "cost_labour_max": s.cost_labour_max,
                "success_rate_pct": s.success_rate_pct,
            }
            for s in sols
        ],
    }
