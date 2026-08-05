"""Audit trail for vehicle media operations."""
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional
from uuid import UUID, uuid4

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base

if TYPE_CHECKING:
    from .vehicle_media import VehicleMedia


class AuditAction(str, Enum):
    """Actions tracked in audit log."""
    UPLOAD = "upload"
    VIEW = "view"
    EDIT = "edit"
    DELETE = "delete"
    SHARE = "share"
    DOWNLOAD = "download"


class VehicleMediaAudit(Base):
    """Immutable audit log of media operations for compliance."""
    __tablename__ = "vehicle_media_audit"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    media_id: Mapped[UUID] = mapped_column(ForeignKey("vehicle_media.id", ondelete="CASCADE"), nullable=False, index=True)
    # Same native-enum mismatch as media_version.event_type: migration 0012
    # creates "CREATE TYPE audit_action AS ENUM ('upload', 'view', …)", so
    # binding a VARCHAR here is rejected by Postgres. See that model for why
    # the SQLite-based test suite does not catch it.
    action: Mapped[AuditAction] = mapped_column(
        SAEnum(
            AuditAction,
            name="audit_action",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
        index=True,
    )
    actor_id: Mapped[Optional[UUID]] = mapped_column(nullable=True, index=True)
    # Postgres declares this INET (migration 0012); SQLite uses String(45).
    # Left untyped it bound a VARCHAR, and Postgres has no assignment cast from
    # varchar to inet, so the insert was rejected outright.
    ip_address: Mapped[Optional[str]] = mapped_column(
        String(45).with_variant(INET(), "postgresql"), nullable=True
    )
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # JSONB on Postgres to match the migration. json -> jsonb does have an
    # assignment cast so plain JSON happened to work, but being explicit keeps
    # the model honest about what the column actually is.
    audit_data: Mapped[Optional[dict]] = mapped_column(
        "audit_data", JSON().with_variant(JSONB(), "postgresql"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow, index=True
    )

    # Relationships
    media: Mapped["VehicleMedia"] = relationship("VehicleMedia", foreign_keys=[media_id])

    class Config:
        from_attributes = True
