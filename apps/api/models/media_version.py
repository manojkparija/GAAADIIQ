"""Version history for vehicle media."""
from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID

from sqlalchemy import JSON, BigInteger, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base


class MediaEventType(str, Enum):
    """Events tracked in version history."""
    CREATED = "created"
    METADATA_UPDATED = "metadata_updated"
    CROPPED = "cropped"
    DELETED = "deleted"


class VehicleMediaVersion(Base):
    """Immutable audit log of changes to vehicle media."""
    __tablename__ = "vehicle_media_versions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    media_id: Mapped[UUID] = mapped_column(ForeignKey("vehicle_media.id"), nullable=False, index=True)
    event_type: Mapped[MediaEventType] = mapped_column(String, nullable=False)
    actor_id: Mapped[Optional[UUID]] = mapped_column(nullable=True, index=True)
    old_value: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    new_value: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow, index=True
    )

    # Relationships
    media: Mapped["VehicleMedia"] = relationship("VehicleMedia", foreign_keys=[media_id])

    class Config:
        from_attributes = True
