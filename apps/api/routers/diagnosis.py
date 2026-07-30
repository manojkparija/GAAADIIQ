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

import uuid
from datetime import datetime
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
    # Which engine produced this: gemini (paid/admin) | ollama | heuristic.
    engine: str = "heuristic"
    model_tier: str = "free"


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
    )

    # Parse causes safely
    raw_causes = ai_result.get("possible_causes", [])
    if not isinstance(raw_causes, list):
        raw_causes = []

    record = VehicleDiagnosis(
        user_id=uuid.UUID(body.user_id) if body.user_id else None,
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
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

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

    # Enforce ownership — prevent IDOR
    if record.user_id and str(record.user_id) != str(current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied")

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
