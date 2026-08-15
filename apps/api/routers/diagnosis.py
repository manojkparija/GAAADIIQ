"""
Vehicle Preliminary Diagnosis & AI Repair Advisor — public + auth endpoints.

POST /diagnosis/analyse   — submit symptoms, get AI diagnosis report
GET  /diagnosis/{id}      — retrieve a saved diagnosis report
GET  /diagnosis/history   — list the current user's past diagnoses (auth required)
"""
# NOTE: deliberately NOT using `from __future__ import annotations`.
# PEP 563 turns annotations into strings, and slowapi's @limiter.limit wrapper
# leaves FastAPI unable to resolve them — it then treats the Pydantic body and
# the DB dependency as query parameters, so every request 422s.

import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.dependencies import get_current_user
from core.limiter import limiter
from db.session import get_db
from models.user import User
from models.vehicle_diagnosis import VehicleDiagnosis
from services.diagnosis import _LANG_NAMES, extract_vehicle_info_from_transcript, run_diagnosis
from services.llm_tier import resolve_tier, verify_caller
from services.stt import (
    STTError,
    STTUnavailable,
    estimate_duration_seconds,
    stt_enabled,
    transcribe,
)
from services.tts import TTSError, TTSUnavailable, synthesize, tts_enabled
from services.voice_store import (
    EVENT_CONSENT_DECLINED,
    EVENT_CONSENT_GRANTED,
    EVENT_CONSENT_REVOKED,
    delete_diagnosis,
    delete_voice_data,
    record_audit_event,
)

logger = logging.getLogger("gaadiiq.diagnosis")

router = APIRouter(prefix="/diagnosis", tags=["diagnosis"])

# Formats MediaRecorder and native pickers realistically produce.
_STT_ALLOWED_TYPES = {
    "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4",
    "audio/wav", "audio/x-wav", "audio/aac", "audio/3gpp",
    "audio/webm;codecs=opus", "audio/ogg;codecs=opus",
}

DB = Annotated[AsyncSession, Depends(get_db)]
OptionalUser = Annotated[User | None, Depends(lambda: None)]


# ── Schemas ───────────────────────────────────────────────────────────────────

class DiagnoseRequest(BaseModel):
    # Vehicle details
    manufacturer: str = Field(..., min_length=1, max_length=100)
    model: str = Field(..., min_length=1, max_length=100)
    variant: str | None = Field(None, max_length=100)
    model_year: int = Field(..., ge=1990, le=2030)
    fuel_type: str = Field(..., pattern="^(Petrol|Diesel|CNG|Electric|Hybrid|LPG)$")
    transmission: str = Field(..., pattern="^(Manual|Automatic|CVT|DCT|AMT)$")
    odometer_km: int | None = Field(None, ge=0, le=2000000)

    # Symptoms
    problem_description: str = Field(..., min_length=10, max_length=2000)
    warning_lights: list[str] = Field(default_factory=list)
    when_occurs: list[str] = Field(default_factory=list)
    severity: str = Field(..., pattern="^(low|medium|high|critical)$")

    # Recent service/repair history (BR-IR-07)
    maintenance_history: list[dict] = Field(default_factory=list, max_length=20)

    # Optional media (URLs after client uploads to storage)
    image_urls: list[str] = Field(default_factory=list, max_length=5)
    audio_url: str | None = None
    video_url: str | None = None

    # Optional auth
    user_id: str | None = None

    # Language detected from user's voice input
    detected_language: str | None = None


class PossibleCause(BaseModel):
    cause: str
    confidence: float
    explanation: str


class DiagnoseResponse(BaseModel):
    id: str
    preliminary_diagnosis: str
    possible_causes: list[PossibleCause]
    repair_complexity: str
    cost_min_inr: int
    cost_max_inr: int
    repair_time_estimate: str
    safe_to_drive: bool
    risk_level: str
    recommended_steps: list[str]
    diy_fixes: list[str]
    immediate_service_required: bool
    preventive_maintenance: list[str]
    retrieved_sources: list[str]
    ollama_used: bool
    analysis_confidence: float
    disclaimer: str
    created_at: datetime
    vision_analysis: dict | None = None
    # Locally identified dashboard telltale, when a photo was supplied. Present
    # even with no vision model available, unlike vision_analysis.
    warning_light_match: dict | None = None
    # BR-AI-10 — populated only when confidence is below the threshold.
    follow_up_questions: list[str] = []
    needs_more_info: bool = False
    # BR-ML-04 — true when a non-English response was requested but the text
    # is still English, so the client can say so instead of silently misleading.
    translation_failed: bool = False
    # Which engine produced this: knowledge_base | openai | gemini | ollama
    # | heuristic. A ":cached" suffix means it was served from the response
    # cache, so the client can tell a fresh answer from a stored one.
    engine: str = "heuristic"
    model_tier: str = "free"
    # ── Knowledge-base answers only ─────────────────────────────────────────
    # Present when engine == "knowledge_base". The diagnosis code is what an
    # admin needs to find the row a driver was shown; the match method is what
    # tells you whether an editor's alias or a similarity score chose it, which
    # is the difference between a deliberate mapping and a guess.
    kb_diagnosis_code: str | None = None
    kb_match_method: str | None = None
    kb_match_confidence: float | None = None
    # Ordered repairs, cheapest and most reversible first. Knowledge-base
    # answers carry costed solutions with provenance; model answers carry the
    # model's own.
    solutions: list[dict] = []
    # The same repairs in the shape the report screen renders — title,
    # difficulty, steps. Every engine populates this.
    #
    # Until now only the browser's built-in table ever filled it, so the
    # "How to Fix or Bypass the Issue" card appeared exclusively on the canned
    # offline answer and vanished the moment a real diagnosis arrived. The
    # section had never once been populated by the API.
    fix_solutions: list[dict] = []


class DiagnosisHistoryItem(BaseModel):
    id: str
    manufacturer: str
    model: str
    model_year: int
    severity: str
    risk_level: str | None
    preliminary_diagnosis: str | None
    created_at: datetime
    # The history list renders a cost/complexity line; without these it showed
    # an empty "₹ – ₹ ·" row.
    cost_min_inr: int | None = None
    cost_max_inr: int | None = None
    repair_complexity: str | None = None


# ── Routes ────────────────────────────────────────────────────────────────────

def _as_text(value: object) -> str | None:
    """A string, or nothing. Anything else is not a value we can store."""
    return value if isinstance(value, str) and value else None


def _engine_name(value: object) -> str | None:
    """
    The engine name without its cache suffix.

    A cached answer is reported as `openai:cached` so the client can tell a
    fresh answer from a stored one, but the coverage report groups by engine
    and the suffix would split every provider into two categories.
    """
    text = _as_text(value)
    return text.split(":")[0] if text else None


async def _known_user_id(db: AsyncSession, raw: str | None) -> uuid.UUID | None:
    """
    `body.user_id`, but only if that user actually exists here.

    Sign-in is Supabase's; `users` is ours, and the two are not guaranteed to
    agree. A caller who signed in through Supabase but has no local row sent an
    id that satisfies the UUID cast and then failed the foreign key:

        ForeignKeyViolationError: insert or update on table "vehicle_diagnoses"
        violates foreign key constraint "vehicle_diagnoses_user_id_fkey"
        Key (user_id)=(…) is not present in table "users"

    The diagnosis survived that, because storing it is no longer allowed to
    fail the request — but the history row was lost every time, silently, for
    exactly the users who are signed in and would expect to see it.

    Storing NULL keeps the row. An anonymous diagnosis is a smaller loss than
    no diagnosis, and `GET /{id}` already treats a NULL owner as nobody rather
    than anybody, so this cannot widen who can read it.

    This is not an authorisation check — the tier still comes from the verified
    token, never from the body. It only decides whether the row can be linked.
    """
    if not raw:
        return None
    try:
        candidate = uuid.UUID(raw)
    except (ValueError, AttributeError, TypeError):
        return None

    exists = await db.execute(select(User.id).where(User.id == candidate))
    if exists.scalar_one_or_none() is None:
        logger.info(
            "Diagnosis user_id %s is not a known user; storing the report unowned",
            candidate,
        )
        return None
    return candidate


def _fix_solutions(result: dict) -> list[dict]:
    """
    The repair options in the shape the report screen renders.

    Two sources produce repairs and they do not agree on a shape. A
    knowledge-base answer carries `solutions` — costed, sequenced, with
    provenance — while a model answer carries `fix_solutions` because that is
    what the prompt asks for. The screen needs one list, so the KB shape is
    mapped onto it rather than teaching the template about both.

    `difficulty` is constrained to the three values the badge understands.
    Anything else renders as an unstyled label, so an unrecognised value
    becomes "Mechanic" — the middle option, and the safe way to be wrong.
    """
    allowed = {"DIY", "Mechanic", "Specialist"}

    def entry(title: object, difficulty: object, steps: object) -> dict | None:
        name = _as_text(title)
        if not name:
            return None
        listed = [t for t in (_as_text(x) for x in (steps or [])) if t]
        return {
            "title": name,
            "difficulty": difficulty if difficulty in allowed else "Mechanic",
            "steps": listed,
        }

    # A model answer already has the right shape; validate rather than trust.
    direct = result.get("fix_solutions")
    if isinstance(direct, list) and direct:
        built = [
            entry(s.get("title"), s.get("difficulty"), s.get("steps"))
            for s in direct if isinstance(s, dict)
        ]
        return [b for b in built if b]

    # A knowledge-base answer: map its richer rows onto the same three fields.
    kb = result.get("solutions")
    if isinstance(kb, list) and kb:
        built = []
        for sol in kb:
            if not isinstance(sol, dict):
                continue
            difficulty = str(sol.get("difficulty") or "").title()
            built.append(entry(sol.get("title"), difficulty, sol.get("steps")))
        return [b for b in built if b]

    return []


@router.post("/analyse", response_model=DiagnoseResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute;20/hour")
async def analyse_vehicle(request: Request, body: DiagnoseRequest, db: DB):
    """
    Submit vehicle symptoms and receive an AI-powered preliminary diagnosis.
    No authentication required — open to all users.
    """
    # Tier comes from a cryptographically verified token, never from the body.
    # body.user_id is client-supplied: using it here would let a free user send
    # a paid user's UUID and be upgraded.
    auth_header = request.headers.get("authorization") or ""
    bearer = auth_header[7:] if auth_header.lower().startswith("bearer ") else None
    tier = await resolve_tier(db, verify_caller(bearer))

    ai_result = await run_diagnosis(
        manufacturer=body.manufacturer,
        model=body.model,
        variant=body.variant,
        model_year=body.model_year,
        fuel_type=body.fuel_type,
        transmission=body.transmission,
        odometer_km=body.odometer_km,
        problem_description=body.problem_description,
        warning_lights=body.warning_lights,
        when_occurs=body.when_occurs,
        severity=body.severity,
        image_urls=body.image_urls,
        maintenance_history=body.maintenance_history,
        response_language=body.detected_language or "en-IN",
        model_tier=tier.value,
        # Passing the session is what enables the cache and the knowledge base.
        # Without it the call behaves exactly as it did before either existed.
        db=db,
    )

    # Parse causes safely
    raw_causes = ai_result.get("possible_causes", [])
    if not isinstance(raw_causes, list):
        raw_causes = []

    record = VehicleDiagnosis(
        user_id=await _known_user_id(db, body.user_id),
        manufacturer=body.manufacturer,
        model=body.model,
        variant=body.variant,
        model_year=body.model_year,
        fuel_type=body.fuel_type,
        transmission=body.transmission,
        odometer_km=body.odometer_km,
        problem_description=body.problem_description,
        warning_lights=body.warning_lights or None,
        when_occurs=body.when_occurs or None,
        severity=body.severity,
        maintenance_history=body.maintenance_history or None,
        image_urls=body.image_urls or None,
        audio_url=body.audio_url,
        video_url=body.video_url,
        preliminary_diagnosis=ai_result.get("preliminary_diagnosis"),
        possible_causes=raw_causes,
        repair_complexity=ai_result.get("repair_complexity"),
        cost_min_inr=ai_result.get("cost_min_inr"),
        cost_max_inr=ai_result.get("cost_max_inr"),
        repair_time_estimate=ai_result.get("repair_time_estimate"),
        safe_to_drive=ai_result.get("safe_to_drive"),
        risk_level=ai_result.get("risk_level"),
        recommended_steps=ai_result.get("recommended_steps", []),
        diy_fixes=ai_result.get("diy_fixes", []),
        immediate_service_required=ai_result.get("immediate_service_required"),
        preventive_maintenance=ai_result.get("preventive_maintenance", []),
        retrieved_sources=ai_result.get("retrieved_sources", []),
        ollama_used=ai_result.get("ollama_used", False),
        analysis_confidence=ai_result.get("analysis_confidence"),
        # Stored, not just logged. A log line answers "what happened just now";
        # this column answers "which vehicles does the knowledge base not
        # cover", which is the question that decides what to curate next.
        # The ":cached" suffix is stripped — a cached answer was produced by
        # the engine named before the colon, and keeping the suffix would split
        # every engine into two categories in the coverage report.
        engine=_engine_name(ai_result.get("engine")),
        kb_diagnosis_code=_as_text(ai_result.get("kb_diagnosis_code")),
    )
    # Persisting the answer must not be able to destroy it.
    #
    # This block used to be bare `add / commit / refresh`, so any storage
    # failure — a missing column after a migration that did not run, a
    # connection blip — turned a diagnosis that had already been computed into
    # a 500. The model call, the knowledge-base lookup and the translation had
    # all succeeded; the driver got nothing because we could not write a
    # history row.
    #
    # Same principle as the knowledge-base lookup: a fault in a supporting
    # concern falls back, it does not fail the request. The history row is
    # lost and said so loudly in the log, which is the right trade against a
    # driver at the roadside getting no answer at all.
    stored = True
    try:
        db.add(record)
        await db.commit()
        await db.refresh(record)
    except Exception as exc:  # noqa: BLE001 — see above
        stored = False
        await db.rollback()
        logger.error(
            "Diagnosis computed but not stored (%s): %s", type(exc).__name__, exc,
            extra={"event": "diagnosis_store_failed"},
        )

    if not stored:
        # Serve what was computed. The id is generated here rather than by the
        # database, so it will not appear in history — which is honest: there
        # is no history row to fetch.
        return DiagnoseResponse(
            id=str(uuid.uuid4()),
            preliminary_diagnosis=ai_result.get("preliminary_diagnosis") or "",
            possible_causes=[PossibleCause(**c) for c in raw_causes],
            repair_complexity=ai_result.get("repair_complexity") or "Unknown",
            cost_min_inr=ai_result.get("cost_min_inr") or 0,
            cost_max_inr=ai_result.get("cost_max_inr") or 0,
            repair_time_estimate=ai_result.get("repair_time_estimate") or "Unknown",
            safe_to_drive=bool(ai_result.get("safe_to_drive")),
            risk_level=ai_result.get("risk_level") or "Unknown",
            recommended_steps=ai_result.get("recommended_steps", []),
            diy_fixes=ai_result.get("diy_fixes", []),
            immediate_service_required=bool(ai_result.get("immediate_service_required")),
            preventive_maintenance=ai_result.get("preventive_maintenance", []),
            retrieved_sources=ai_result.get("retrieved_sources", []),
            ollama_used=bool(ai_result.get("ollama_used")),
            analysis_confidence=ai_result.get("analysis_confidence") or 0,
            disclaimer=ai_result.get("disclaimer", ""),
            created_at=datetime.now(timezone.utc),
            vision_analysis=ai_result.get("vision_analysis"),
            warning_light_match=ai_result.get("warning_light_match"),
            follow_up_questions=ai_result.get("follow_up_questions", []),
            needs_more_info=bool(ai_result.get("needs_more_info")),
            translation_failed=bool(ai_result.get("translation_failed")),
            engine=_engine_name(ai_result.get("engine")) or "heuristic",
            model_tier=ai_result.get("model_tier", "free"),
            kb_diagnosis_code=_as_text(ai_result.get("kb_diagnosis_code")),
            kb_match_method=_as_text(ai_result.get("kb_match_method")),
            kb_match_confidence=ai_result.get("kb_match_confidence"),
            solutions=ai_result.get("solutions", []),
            fix_solutions=_fix_solutions(ai_result),
        )

    return DiagnoseResponse(
        id=str(record.id),
        preliminary_diagnosis=record.preliminary_diagnosis or "",
        possible_causes=[PossibleCause(**c) for c in (record.possible_causes or [])],
        repair_complexity=record.repair_complexity or "Unknown",
        cost_min_inr=record.cost_min_inr or 0,
        cost_max_inr=record.cost_max_inr or 0,
        repair_time_estimate=record.repair_time_estimate or "Unknown",
        safe_to_drive=record.safe_to_drive if record.safe_to_drive is not None else False,
        risk_level=record.risk_level or "Unknown",
        recommended_steps=record.recommended_steps or [],
        diy_fixes=record.diy_fixes or [],
        immediate_service_required=record.immediate_service_required or False,
        preventive_maintenance=record.preventive_maintenance or [],
        retrieved_sources=record.retrieved_sources or [],
        ollama_used=record.ollama_used,
        analysis_confidence=record.analysis_confidence or 0,
        disclaimer=ai_result.get("disclaimer", ""),
        created_at=record.created_at,
        vision_analysis=ai_result.get("vision_analysis"),
        warning_light_match=ai_result.get("warning_light_match"),
        follow_up_questions=ai_result.get("follow_up_questions", []),
        needs_more_info=ai_result.get("needs_more_info", False),
        translation_failed=ai_result.get("translation_failed", False),
        engine=ai_result.get("engine", "heuristic"),
        model_tier=ai_result.get("model_tier", "free"),
        kb_diagnosis_code=ai_result.get("kb_diagnosis_code"),
        kb_match_method=ai_result.get("kb_match_method"),
        kb_match_confidence=ai_result.get("kb_match_confidence"),
        solutions=ai_result.get("solutions", []),
        fix_solutions=_fix_solutions(ai_result),
    )


# ── Consent + DPDP erasure (BR-SEC-01/05/06, BR-DB-04) ───────────────────────

class ConsentRequest(BaseModel):
    granted: bool
    consent_version: int = Field(1, ge=1, le=1000)
    language: str = Field("en-IN", max_length=10)


class ConsentResponse(BaseModel):
    granted: bool
    consent_version: int
    recorded_at: datetime


@router.post("/voice/consent", response_model=ConsentResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
async def record_voice_consent(
    request: Request,
    body: ConsentRequest,
    db: DB,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """
    Record a microphone consent decision server-side (BR-SEC-01).

    The client also stores this locally so the prompt is shown once; this is
    the durable, auditable copy, and it is what gates transcript persistence.
    """
    event = await record_audit_event(
        db,
        event_type=EVENT_CONSENT_GRANTED if body.granted else EVENT_CONSENT_DECLINED,
        user_id=current_user.id,
        consent_version=body.consent_version,
        language=body.language,
    )
    await db.commit()
    return ConsentResponse(
        granted=body.granted,
        consent_version=body.consent_version,
        recorded_at=event.occurred_at,
    )


class VoiceDataDeletionResponse(BaseModel):
    transcripts_deleted: int
    conversations_deleted: int


@router.delete("/voice/data", response_model=VoiceDataDeletionResponse)
@limiter.limit("5/minute")
async def delete_my_voice_data(
    request: Request,
    db: DB,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """
    Erase all stored voice transcripts and conversations (BR-SEC-06, DPDP).

    Also revokes consent, so nothing new is written until the user opts in
    again. The audit trail is retained as evidence the erasure occurred.
    """
    result = await delete_voice_data(db, current_user.id)
    await record_audit_event(
        db, event_type=EVENT_CONSENT_REVOKED, user_id=current_user.id
    )
    await db.commit()
    return VoiceDataDeletionResponse(**result)


@router.delete("/{diagnosis_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("10/minute")
async def delete_diagnosis_report(
    request: Request,
    diagnosis_id: str,
    db: DB,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Delete one of the caller's own diagnosis reports (BR-SEC-05)."""
    try:
        did = uuid.UUID(diagnosis_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid diagnosis ID")

    deleted = await delete_diagnosis(db, did, current_user.id)
    if not deleted:
        # Not found and not-yours are deliberately indistinguishable here, so
        # this cannot be used to probe for others' report IDs.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Diagnosis report not found")
    return None


class SttResponse(BaseModel):
    text: str
    language: str
    provider: str
    confidence: float | None = None


@router.post("/stt", response_model=SttResponse)
@limiter.limit("15/minute;100/hour")
async def speech_to_text(
    request: Request,
    file: UploadFile = File(...),
    language: str = Form("en-IN"),
):
    """
    Server-side transcription fallback (BR-API-01, BR-VA-01).

    Used when the client has no usable Web Speech API — Android WebView,
    Safari, Firefox. Audio is transcribed and discarded; nothing is persisted
    by this endpoint.
    """
    if not stt_enabled():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Server-side speech recognition is not configured.",
        )

    content_type = file.content_type or ""
    if content_type not in _STT_ALLOWED_TYPES:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "Unsupported audio format.",
        )

    audio = await file.read()
    if not audio:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty audio file.")
    if len(audio) > settings.stt_max_bytes:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"Audio must be under {settings.stt_max_bytes // (1024 * 1024)} MB.",
        )

    # Duration cap where measurable (BR-IR-04). Compressed formats report None;
    # the byte cap above is the backstop for those.
    duration = estimate_duration_seconds(audio, content_type)
    if duration is not None and duration > settings.stt_max_audio_seconds:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"Audio must be under {settings.stt_max_audio_seconds} seconds.",
        )

    if language not in _LANG_NAMES:
        language = "en-IN"

    try:
        result = await transcribe(audio, content_type=content_type, language=language)
    except STTUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except STTError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    return SttResponse(**result)


class TtsRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=3000)
    language: str = Field("en-IN", max_length=10)


class TtsResponse(BaseModel):
    audio_base64: str
    content_type: str
    provider: str
    voice: str
    language: str


@router.post("/tts", response_model=TtsResponse)
@limiter.limit("20/minute")
async def text_to_speech(request: Request, body: TtsRequest):
    """
    Optional server-side speech synthesis (BR-API-02).

    503 means "not configured" — the client falls back to the browser's
    speechSynthesis, which is the normal path on most platforms.
    """
    if not tts_enabled():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Server-side speech synthesis is not configured.",
        )

    language = body.language if body.language in _LANG_NAMES else "en-IN"
    try:
        result = await synthesize(body.text, language=language)
    except TTSUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except TTSError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    return TtsResponse(**result)


class VoiceExtractRequest(BaseModel):
    transcript: str = Field(..., min_length=3, max_length=500)


@router.post("/voice/extract")
@limiter.limit("20/minute")
async def voice_extract(request: Request, body: VoiceExtractRequest):
    """Extract structured vehicle info from a spoken transcript using Ollama."""
    extracted = await extract_vehicle_info_from_transcript(body.transcript)
    return extracted


@router.get("/history", response_model=list[DiagnosisHistoryItem])
async def get_history(db: DB, current_user: Annotated[User, Depends(get_current_user)]):
    """Get diagnosis history for the authenticated user."""
    q = await db.execute(
        select(VehicleDiagnosis)
        .where(VehicleDiagnosis.user_id == current_user.id)
        .order_by(VehicleDiagnosis.created_at.desc())
        .limit(20)
    )
    records = q.scalars().all()
    return [
        DiagnosisHistoryItem(
            id=str(r.id),
            manufacturer=r.manufacturer,
            model=r.model,
            model_year=r.model_year,
            severity=r.severity,
            risk_level=r.risk_level,
            preliminary_diagnosis=r.preliminary_diagnosis,
            created_at=r.created_at,
            cost_min_inr=r.cost_min_inr,
            cost_max_inr=r.cost_max_inr,
            repair_complexity=r.repair_complexity,
        )
        for r in records
    ]


@router.get("/{diagnosis_id}", response_model=DiagnoseResponse)
async def get_diagnosis(
    diagnosis_id: str,
    db: DB,
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Retrieve a saved diagnosis report — owner-only (fixes IDOR MOB-007)."""
    try:
        did = uuid.UUID(diagnosis_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid diagnosis ID")

    q = await db.execute(select(VehicleDiagnosis).where(VehicleDiagnosis.id == did))
    record = q.scalar_one_or_none()
    if not record:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Diagnosis report not found")

    # Enforce ownership — prevent IDOR.
    #
    # A NULL owner means "nobody", not "anybody". /diagnosis/analyse needs no
    # authentication, so an anonymous report is stored with user_id = NULL; the
    # previous guard short-circuited on that and let any signed-in caller read
    # it. The endpoint was documented as owner-only and was not.
    #
    # 404 rather than 403, matching delete_diagnosis_report below: "not found"
    # and "not yours" are deliberately indistinguishable, so this cannot be used
    # to probe for other people's report IDs.
    if not record.user_id or str(record.user_id) != str(current_user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Diagnosis report not found")

    return DiagnoseResponse(
        id=str(record.id),
        preliminary_diagnosis=record.preliminary_diagnosis or "",
        possible_causes=[PossibleCause(**c) for c in (record.possible_causes or [])],
        repair_complexity=record.repair_complexity or "Unknown",
        cost_min_inr=record.cost_min_inr or 0,
        cost_max_inr=record.cost_max_inr or 0,
        repair_time_estimate=record.repair_time_estimate or "Unknown",
        safe_to_drive=record.safe_to_drive if record.safe_to_drive is not None else False,
        risk_level=record.risk_level or "Unknown",
        recommended_steps=record.recommended_steps or [],
        diy_fixes=record.diy_fixes or [],
        immediate_service_required=record.immediate_service_required or False,
        preventive_maintenance=record.preventive_maintenance or [],
        retrieved_sources=record.retrieved_sources or [],
        ollama_used=record.ollama_used,
        analysis_confidence=record.analysis_confidence or 0,
        disclaimer="This is a saved preliminary AI assessment. Always consult a certified mechanic.",
        created_at=record.created_at,
    )
