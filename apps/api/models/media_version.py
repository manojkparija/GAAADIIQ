"""Version history for vehicle media."""
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional
from uuid import UUID, uuid4

from sqlalchemy import JSON, DateTime, ForeignKey
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base

if TYPE_CHECKING:
    from .vehicle_media import VehicleMedia


class MediaEventType(str, Enum):
    """Events tracked in version history."""
    CREATED = "created"
    METADATA_UPDATED = "metadata_updated"
    CROPPED = "cropped"
    DELETED = "deleted"


class VehicleMediaVersion(Base):
    """Immutable audit log of changes to vehicle media."""
    __tablename__ = "vehicle_media_versions"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    media_id: Mapped[UUID] = mapped_column(ForeignKey("vehicle_media.id"), nullable=False, index=True)
    # Migration 0011 creates a native PostgreSQL enum for this column:
    #   CREATE TYPE media_event_type AS ENUM ('created', 'metadata_updated', …)
    # Declaring it as String made SQLAlchemy bind a VARCHAR, which Postgres
    # rejects outright ("column is of type media_event_type but expression is
    # of type character varying"), failing every upload after the file had
    # already been stored. The test suite runs on SQLite, where the same
    # migration uses String(32), so the mismatch never showed up there.
    #
    # values_callable persists the enum's VALUE ('created'), not its NAME
    # ('CREATED'), which is what the Postgres type actually contains.
    event_type: Mapped[MediaEventType] = mapped_column(
        SAEnum(
            MediaEventType,
            name="media_event_type",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )
    actor_id: Mapped[Optional[UUID]] = mapped_column(nullable=True, index=True)
    old_value: Mapped[Optional[dict]] = mapped_column(
        JSON().with_variant(JSONB(), "postgresql"), nullable=True
    )
    new_value: Mapped[Optional[dict]] = mapped_column(
        JSON().with_variant(JSONB(), "postgresql"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow, index=True
    )

    # Relationships
    media: Mapped["VehicleMedia"] = relationship("VehicleMedia", foreign_keys=[media_id])

    class Config:
        from_attributes = True
