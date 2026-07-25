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

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_current_user
from core.limiter import limiter
from db.session import get_db
from models.user import User
from models.vehicle_diagnosis import VehicleDiagnosis
from services.diagnosis import extract_vehicle_info_from_transcript, run_diagnosis

router = APIRouter(prefix="/diagnosis", tags=["diagnosis"])

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


class DiagnosisHistoryItem(BaseModel):
    id: str
    manufacturer: str
    model: str
    model_year: int
    severity: str
    risk_level: str | None
    preliminary_diagnosis: str | None
    created_at: datetime


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/analyse", response_model=DiagnoseResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute;20/hour")
async def analyse_vehicle(request: Request, body: DiagnoseRequest, db: DB):
    """
    Submit vehicle symptoms and receive an AI-powered preliminary diagnosis.
    No authentication required — open to all users.
    """
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
        response_language=body.detected_language or "en-IN",
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
    )


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
