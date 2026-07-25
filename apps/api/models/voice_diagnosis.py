"""
Voice diagnosis persistence (BR-DB-01, BR-DB-02, BR-DB-04).

Three tables, deliberately separate from vehicle_diagnoses:

  voice_transcripts        — what the user said, per utterance
  diagnosis_conversations  — the session those utterances belong to
  diagnosis_audit_events   — consent and data-lifecycle events

Transcripts are personal data under the DPDP Act. Nothing here is written
unless the user has granted microphone consent, and every row is reachable
from a user_id so a deletion request can remove all of it (BR-SEC-05/06).
Audio itself is never stored — only the resulting text.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base, TimestampMixin, UUIDMixin


class DiagnosisConversation(UUIDMixin, TimestampMixin, Base):
    """One voice-mode session, from consent through to the diagnosis."""

    __tablename__ = "diagnosis_conversations"

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # Set once the session produces a report; null if the user abandoned it.
    diagnosis_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("vehicle_diagnoses.id", ondelete="CASCADE"), nullable=True, index=True
    )

    language: Mapped[str] = mapped_column(String(10), nullable=False, default="en-IN")
    # "browser" (Web Speech) or a server provider name — useful when
    # diagnosing quality complaints from a specific platform.
    stt_engine: Mapped[str | None] = mapped_column(String(30))
    language_auto_detected: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Vehicle fields the conversation managed to extract.
    extracted_vehicle_info: Mapped[dict | None] = mapped_column(JSON)
    completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    turn_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    transcripts: Mapped[list[VoiceTranscript]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    def __repr__(self) -> str:
        return f"<DiagnosisConversation id={self.id} lang={self.language} turns={self.turn_count}>"


class VoiceTranscript(UUIDMixin, TimestampMixin, Base):
    """A single spoken turn. Text only — the audio is discarded after STT."""

    __tablename__ = "voice_transcripts"

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("diagnosis_conversations.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )

    # "user" for speech, "assistant" for a spoken prompt.
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="user")
    text: Mapped[str] = mapped_column(Text, nullable=False)
    language: Mapped[str] = mapped_column(String(10), nullable=False, default="en-IN")
    confidence: Mapped[float | None] = mapped_column(Float)
    stt_engine: Mapped[str | None] = mapped_column(String(30))
    # Which conversation step produced it (capture-vehicle, capture-problem…).
    step: Mapped[str | None] = mapped_column(String(32))

    conversation: Mapped[DiagnosisConversation] = relationship(back_populates="transcripts")

    def __repr__(self) -> str:
        return f"<VoiceTranscript id={self.id} role={self.role} lang={self.language}>"


class DiagnosisAuditEvent(UUIDMixin, Base):
    """
    Consent and data-lifecycle audit trail (BR-DB-04).

    Deliberately append-only and without TimestampMixin's updated_at: an audit
    row that can be edited is not an audit row. Retained after a data-deletion
    request — proving consent was obtained, and that erasure was carried out,
    requires the record to outlive the data it describes. It holds no
    transcript text.
    """

    __tablename__ = "diagnosis_audit_events"

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        # No cascade: the trail must survive account deletion.
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("diagnosis_conversations.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # consent_granted | consent_declined | consent_revoked
    # | voice_data_deleted | diagnosis_deleted | stt_server_used
    event_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    consent_version: Mapped[int | None] = mapped_column(Integer)
    language: Mapped[str | None] = mapped_column(String(10))
    # Non-identifying context only (counts, provider names, error codes).
    detail: Mapped[dict | None] = mapped_column(JSON)

    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    def __repr__(self) -> str:
        return f"<DiagnosisAuditEvent {self.event_type} at={self.occurred_at}>"
