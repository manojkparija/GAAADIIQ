"""Audit trail for vehicle media operations."""
from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base


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
    action: Mapped[AuditAction] = mapped_column(String, nullable=False, index=True)
    actor_id: Mapped[Optional[UUID]] = mapped_column(nullable=True, index=True)
    ip_address: Mapped[Optional[str]] = mapped_column(nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    audit_data: Mapped[Optional[dict]] = mapped_column("audit_data", JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow, index=True
    )

    # Relationships
    media: Mapped["VehicleMedia"] = relationship("VehicleMedia", foreign_keys=[media_id])

    class Config:
        from_attributes = True
