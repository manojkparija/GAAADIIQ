"""
Voice conversation persistence and DPDP erasure (BR-DB-01/02/04, BR-SEC-05/06).

Two rules govern everything here:

1. Nothing is written without consent. save_transcript() and
   start_conversation() are no-ops when the caller has not recorded consent,
   so a user who declined leaves no transcript behind.

2. Audit events outlive the data. Consent and deletion events are retained
   after erasure — proving consent was obtained, and that a deletion actually
   happened, requires a record that survives the data it describes. Audit
   rows never contain transcript text.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.vehicle_diagnosis import VehicleDiagnosis
from models.voice_diagnosis import (
    DiagnosisAuditEvent,
    DiagnosisConversation,
    VoiceTranscript,
)

logger = logging.getLogger("gaadiiq.voice_store")

# Event types recorded in diagnosis_audit_events.
EVENT_CONSENT_GRANTED = "consent_granted"
EVENT_CONSENT_DECLINED = "consent_declined"
EVENT_CONSENT_REVOKED = "consent_revoked"
EVENT_VOICE_DATA_DELETED = "voice_data_deleted"
EVENT_DIAGNOSIS_DELETED = "diagnosis_deleted"
EVENT_STT_SERVER_USED = "stt_server_used"

_CONSENT_EVENTS = {EVENT_CONSENT_GRANTED, EVENT_CONSENT_DECLINED, EVENT_CONSENT_REVOKED}


async def record_audit_event(
    db: AsyncSession,
    *,
    event_type: str,
    user_id: uuid.UUID | None = None,
    conversation_id: uuid.UUID | None = None,
    consent_version: int | None = None,
    language: str | None = None,
    detail: dict | None = None,
) -> DiagnosisAuditEvent:
    """Append an audit event. Never contains transcript text."""
    now = datetime.now(timezone.utc)
    event = DiagnosisAuditEvent(
        user_id=user_id,
        conversation_id=conversation_id,
        event_type=event_type,
        consent_version=consent_version,
        language=language,
        detail=detail,
        occurred_at=now,
        created_at=now,
    )
    db.add(event)
    await db.flush()
    return event


async def has_active_consent(db: AsyncSession, user_id: uuid.UUID) -> bool:
    """
    True when the user's most recent consent event is a grant.

    Derived from the audit trail rather than a mutable flag, so a revocation
    cannot be lost and the decision history stays auditable.
    """
    q = await db.execute(
        select(DiagnosisAuditEvent.event_type)
        .where(
            DiagnosisAuditEvent.user_id == user_id,
            DiagnosisAuditEvent.event_type.in_(_CONSENT_EVENTS),
        )
        .order_by(DiagnosisAuditEvent.occurred_at.desc())
        .limit(1)
    )
    latest = q.scalar_one_or_none()
    return latest == EVENT_CONSENT_GRANTED


async def start_conversation(
    db: AsyncSession,
    *,
    user_id: uuid.UUID | None,
    language: str = "en-IN",
    stt_engine: str | None = None,
    language_auto_detected: bool = False,
) -> DiagnosisConversation | None:
    """
    Begin a stored conversation. Returns None when consent is absent — the
    caller carries on in memory and simply persists nothing.
    """
    if user_id is None:
        return None  # anonymous sessions are not persisted
    if not await has_active_consent(db, user_id):
        return None

    conversation = DiagnosisConversation(
        user_id=user_id,
        language=language,
        stt_engine=stt_engine,
        language_auto_detected=language_auto_detected,
    )
    db.add(conversation)
    await db.flush()
    return conversation


async def save_transcript(
    db: AsyncSession,
    *,
    conversation: DiagnosisConversation | None,
    role: str,
    text: str,
    language: str = "en-IN",
    confidence: float | None = None,
    stt_engine: str | None = None,
    step: str | None = None,
) -> VoiceTranscript | None:
    """Store one turn. No conversation (i.e. no consent) means no write."""
    if conversation is None or not text.strip():
        return None

    transcript = VoiceTranscript(
        conversation_id=conversation.id,
        user_id=conversation.user_id,
        role=role,
        text=text.strip(),
        language=language,
        confidence=confidence,
        stt_engine=stt_engine,
        step=step,
    )
    db.add(transcript)
    conversation.turn_count = (conversation.turn_count or 0) + 1
    await db.flush()
    return transcript


async def complete_conversation(
    db: AsyncSession,
    conversation: DiagnosisConversation | None,
    *,
    diagnosis_id: uuid.UUID | None = None,
    extracted_vehicle_info: dict | None = None,
) -> None:
    """Mark a conversation finished and link it to the report it produced."""
    if conversation is None:
        return
    conversation.completed = True
    if diagnosis_id is not None:
        conversation.diagnosis_id = diagnosis_id
    if extracted_vehicle_info is not None:
        conversation.extracted_vehicle_info = extracted_vehicle_info
    await db.flush()


# ── DPDP erasure (BR-SEC-05 / BR-SEC-06) ─────────────────────────────────────

async def delete_voice_data(db: AsyncSession, user_id: uuid.UUID) -> dict:
    """
    Erase every stored transcript and conversation for a user (BR-SEC-06).

    Returns the counts removed. The audit trail is deliberately preserved and
    a deletion event appended — an erasure with no record of having happened
    cannot be evidenced later.
    """
    tq = await db.execute(
        select(func.count()).select_from(VoiceTranscript).where(VoiceTranscript.user_id == user_id)
    )
    transcript_count = tq.scalar_one()

    cq = await db.execute(
        select(func.count()).select_from(DiagnosisConversation)
        .where(DiagnosisConversation.user_id == user_id)
    )
    conversation_count = cq.scalar_one()

    # Transcripts first — the FK cascade would handle it, but SQLite in tests
    # does not enforce cascades by default, so delete explicitly.
    await db.execute(delete(VoiceTranscript).where(VoiceTranscript.user_id == user_id))
    await db.execute(
        delete(DiagnosisConversation).where(DiagnosisConversation.user_id == user_id)
    )

    await record_audit_event(
        db,
        event_type=EVENT_VOICE_DATA_DELETED,
        user_id=user_id,
        detail={"transcripts": transcript_count, "conversations": conversation_count},
    )
    await db.commit()

    logger.info(
        "Deleted voice data for user %s: %d transcripts, %d conversations",
        user_id, transcript_count, conversation_count,
    )
    return {
        "transcripts_deleted": transcript_count,
        "conversations_deleted": conversation_count,
    }


async def delete_diagnosis(
    db: AsyncSession, diagnosis_id: uuid.UUID, user_id: uuid.UUID
) -> bool:
    """
    Delete one diagnosis and everything derived from it (BR-SEC-05).

    Returns False when the report does not exist or is not the caller's —
    the router maps that to 404/403. Anonymous reports (user_id NULL) cannot
    be claimed by an authenticated caller.
    """
    q = await db.execute(
        select(VehicleDiagnosis).where(VehicleDiagnosis.id == diagnosis_id)
    )
    record = q.scalar_one_or_none()
    if record is None or record.user_id is None or record.user_id != user_id:
        return False

    # Detach conversations first so the report can go even where the DB does
    # not enforce the cascade.
    convs = await db.execute(
        select(DiagnosisConversation).where(DiagnosisConversation.diagnosis_id == diagnosis_id)
    )
    for conv in convs.scalars().all():
        await db.execute(delete(VoiceTranscript).where(VoiceTranscript.conversation_id == conv.id))
        await db.delete(conv)

    await db.delete(record)
    await record_audit_event(
        db,
        event_type=EVENT_DIAGNOSIS_DELETED,
        user_id=user_id,
        detail={"diagnosis_id": str(diagnosis_id)},
    )
    await db.commit()
    return True
