"""
Brochure ingestion: jobs, extracted vehicles, and image metadata.

Three tables:

  pdf_ingestion_jobs   — one uploaded brochure, and how its processing went
  vehicle_media        — one extracted image, and where it is stored
  extracted_vehicles   — one vehicle the AI found in the brochure

vehicle_media stores the storage KEY, not a URL. URLs change when the storage
backend or CDN changes; keys do not. The URL is derived at read time by
services.media_storage, so moving from a local folder to S3 needs no data
migration.

Rows survive the file: deleting an image from storage does not delete its row,
because the row records where a brochure image came from and when — which is
the audit trail for a listing's photography.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from db.base import Base


class IngestionStatus(str, enum.Enum):
    """Lifecycle of one uploaded brochure."""
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class MediaKind(str, enum.Enum):
    """What an extracted image depicts, once known."""
    unknown = "unknown"
    exterior = "exterior"
    interior = "interior"
    colour_swatch = "colour_swatch"
    feature = "feature"
    logo = "logo"


class PdfIngestionJob(Base):
    """One uploaded brochure PDF and the outcome of processing it."""

    __tablename__ = "pdf_ingestion_jobs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # The original filename is kept for provenance: an admin reviewing a
    # questionable image needs to know which brochure it came from.
    source_pdf_name: Mapped[str] = mapped_column(String(500), nullable=False)
    source_pdf_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    file_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    status: Mapped[IngestionStatus] = mapped_column(
        Enum(IngestionStatus, name="ingestion_status"),
        default=IngestionStatus.pending,
        nullable=False,
        index=True,
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    page_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    image_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    vehicle_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Which engine produced the extraction, so a batch of bad data can be
    # traced to the model that generated it.
    ai_engine: Mapped[str | None] = mapped_column(String(60), nullable=True)

    # Nullable and SET NULL on delete: the ingestion record outlives the admin
    # account that created it, exactly like an audit entry.
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    media: Mapped[list["VehicleMedia"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )
    vehicles: Mapped[list["ExtractedVehicle"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )


class VehicleMedia(Base):
    """
    One image pulled out of a brochure.

    storage_key is the identifier the storage backend understands. Nothing here
    records a URL: services.media_storage.url_for() derives it, so the same row
    keeps working after a move to S3.
    """

    __tablename__ = "vehicle_media"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)

    storage_key: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    content_type: Mapped[str] = mapped_column(String(100), default="image/png", nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Provenance — which brochure, which page.
    source_pdf_name: Mapped[str] = mapped_column(String(500), nullable=False)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)

    kind: Mapped[MediaKind] = mapped_column(
        Enum(MediaKind, name="media_kind"), default=MediaKind.unknown, nullable=False
    )

    # Free-text make/model as read from the brochure. Deliberately not a
    # foreign key to cars: an image is extracted before anyone decides which
    # catalogue row it belongs to, and it must not be lost in the meantime.
    make: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    variant: Mapped[str | None] = mapped_column(String(160), nullable=True)
    colour: Mapped[str | None] = mapped_column(String(80), nullable=True)

    # Perceptual hash, used to spot the same picture appearing in several
    # brochures rather than storing it repeatedly.
    phash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    job_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("pdf_ingestion_jobs.id", ondelete="CASCADE"),
        nullable=True, index=True,
    )
    job: Mapped["PdfIngestionJob | None"] = relationship(back_populates="media")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )


class ExtractedVehicle(Base):
    """
    A vehicle the AI believes the brochure describes.

    Held separately from the `cars` catalogue until an admin approves it —
    model output is not trustworthy enough to write straight into the data
    customers see.
    """

    __tablename__ = "extracted_vehicles"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)

    make: Mapped[str | None] = mapped_column(String(120), nullable=True)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    variant: Mapped[str | None] = mapped_column(String(160), nullable=True)
    model_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    price_inr: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fuel_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    transmission: Mapped[str | None] = mapped_column(String(40), nullable=True)
    body_type: Mapped[str | None] = mapped_column(String(40), nullable=True)

    # Colours and specs vary wildly between brochures, so they are kept as
    # JSON rather than forced into columns that would be null most of the time.
    colours: Mapped[list | None] = mapped_column(JSON, nullable=True)
    specs: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    features: Mapped[list | None] = mapped_column(JSON, nullable=True)

    # How sure the extractor was, per field. Drives the review queue ordering.
    confidence: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    review_status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)

    job_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("pdf_ingestion_jobs.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    job: Mapped["PdfIngestionJob"] = relationship(back_populates="vehicles")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
