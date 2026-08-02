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
    ARRAY,
    JSON,
    Boolean,
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


class ImageCategory(str, enum.Enum):
    """
    What an admin says a picture is, from the catalogue's fixed vocabulary.

    Distinct from MediaKind/MediaView, which are what a vision model guessed.
    Both exist because they answer to different authorities: a model's guess is
    useful for sorting a thousand brochure extracts, and an admin's choice is
    what the model page filters on. Conflating them would let a misclassified
    image change what a customer sees.

    The list is the one the business specified — deliberately finer than the
    model's coarse kind/view, because a gallery needs "boot space" and "engine
    bay" as separate tabs and a model cannot reliably tell those apart.
    """
    exterior_front = "exterior_front"
    exterior_rear = "exterior_rear"
    exterior_left = "exterior_left"
    exterior_right = "exterior_right"
    front_quarter = "front_quarter"
    rear_quarter = "rear_quarter"
    interior_dashboard = "interior_dashboard"
    steering = "steering"
    infotainment = "infotainment"
    seats = "seats"
    boot_space = "boot_space"
    engine_bay = "engine_bay"
    wheels = "wheels"
    sunroof = "sunroof"
    safety = "safety"
    accessories = "accessories"
    gallery = "gallery"
    three_sixty = "three_sixty"
    video = "video"


class MediaView(str, enum.Enum):
    """
    Which angle an exterior shot was taken from.

    Separate from MediaKind because they answer different questions: kind says
    whether a picture is of the body, the cabin or a colour swatch, and view
    says where the camera was. A gallery needs both — "front three-quarter
    exterior" is the hero shot, and picking it requires the angle, not just
    that the image is an exterior.
    """
    unknown = "unknown"
    front = "front"
    front_three_quarter = "front_three_quarter"
    side = "side"
    rear_three_quarter = "rear_three_quarter"
    rear = "rear"
    top = "top"
    detail = "detail"


class ListingMedia(Base):
    """
    Links a listing to an image in vehicle_media.

    An association table rather than a column on either side, because the same
    photograph legitimately belongs to several listings — two dealers selling
    the same variant in the same colour should share the stored file, not hold
    a copy each. That sharing is the point of a single source of truth, and it
    is what a JSON array of URLs per listing cannot express.

    `position` orders a listing's gallery. It lives here rather than on the
    image because the running order is a property of the listing, not of the
    photograph: the same shot can be the hero on one listing and the fourth
    thumbnail on another.
    """

    __tablename__ = "listing_media"

    listing_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("listings.id", ondelete="CASCADE"),
        primary_key=True,
    )
    media_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("vehicle_media.id", ondelete="CASCADE"),
        primary_key=True,
    )
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


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

    # Derived, cheap, and served to every gallery and card in the product. Also
    # a key rather than a URL, for the same reason as storage_key. Nullable
    # because generation can fail on an image the decoder dislikes, and losing
    # the original over a missing thumbnail would be the wrong trade.
    thumbnail_key: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # WebP derivative for reduced file size. Stored separately from thumbnail
    # since WebP is full-resolution while thumbnail is downscaled. Nullable
    # because generation can fail, and the original is always available.
    webp_key: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Provenance — which brochure, which page.
    source_pdf_name: Mapped[str] = mapped_column(String(500), nullable=False)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)

    kind: Mapped[MediaKind] = mapped_column(
        Enum(MediaKind, name="media_kind"), default=MediaKind.unknown, nullable=False
    )
    view: Mapped[MediaView] = mapped_column(
        Enum(MediaView, name="media_view"), default=MediaView.unknown, nullable=False
    )

    # Free-text make/model as read from the brochure. Deliberately not a
    # foreign key to cars: an image is extracted before anyone decides which
    # catalogue row it belongs to, and it must not be lost in the meantime.
    make: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    variant: Mapped[str | None] = mapped_column(String(160), nullable=True)
    colour: Mapped[str | None] = mapped_column(String(80), nullable=True)

    # Indexed alongside make/model because the catalogue surfaces filter on them
    # together: a model page wants this year's photographs, and a body-type
    # carousel wants every SUV.
    model_year: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    category: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)

    # Exact hash of the bytes. Catches the same embedded object reused across
    # pages — the common case within one brochure.
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    # Perceptual (difference) hash. Catches the same photograph re-encoded,
    # resized or recompressed between brochures, which an exact hash cannot:
    # those bytes differ, so exact-hashing alone stores the picture twice.
    phash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    # Which extracted vehicle this image depicts, once known. Nullable and SET
    # NULL: an image is stored before the AI has said anything about it, and it
    # must outlive a rejected extraction rather than vanish with it.
    extracted_vehicle_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("extracted_vehicles.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )

    # ── Admin-supplied catalogue metadata ────────────────────────────────────
    # The category an admin chose, as opposed to kind/view which a model
    # guessed. Nullable because brochure extracts arrive without one.
    image_category: Mapped[ImageCategory | None] = mapped_column(
        Enum(ImageCategory, name="image_category"), nullable=True, index=True
    )
    fuel_type: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    transmission: Mapped[str | None] = mapped_column(String(40), nullable=True)

    # The hero shot for a vehicle. Enforced per (make, model, variant) in the
    # upload path rather than by a constraint: "primary" is only meaningful
    # within a vehicle, and a partial unique index over three nullable columns
    # behaves differently on every backend.
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # ── SEO and accessibility ────────────────────────────────────────────────
    # alt_text is an accessibility requirement before it is an SEO one: a
    # gallery of unlabelled images is unusable with a screen reader.
    alt_text: Mapped[str | None] = mapped_column(String(300), nullable=True)
    seo_keywords: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ai_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Provenance and rights ────────────────────────────────────────────────
    # Where the file came from and on what terms. Worth recording at upload:
    # reconstructing the licence of a photograph after the fact is usually
    # impossible, and publishing one without it is the expensive kind of
    # mistake.
    source: Mapped[str | None] = mapped_column(String(200), nullable=True)
    copyright: Mapped[str | None] = mapped_column(String(200), nullable=True)
    license: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Camera/EXIF block as the file carried it, kept whole rather than parsed
    # into columns: the interesting fields differ per camera, and most are null.
    exif: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Nullable and SET NULL for the same reason as the ingestion job's: the
    # image is a record that outlives the account that uploaded it.
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )

    # When the enrichment backfill last processed this row.
    #
    # A marker is needed because "has no perceptual hash" and "has no make" are
    # both legitimate resting states — a flat colour swatch offers no signature
    # to hash, and an image uploaded against a listing has no brochure to take
    # a make from. Selecting on those nulls made the backfill pick the same
    # rows up on every run and re-read every file from storage forever.
    #
    # Null it to force a row through again.
    enriched_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    job_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("pdf_ingestion_jobs.id", ondelete="CASCADE"),
        nullable=True, index=True,
    )
    job: Mapped["PdfIngestionJob | None"] = relationship(back_populates="media")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    # ── WAVE 3 ML fields ─────────────────────────────────────────────────────
    embedding_vector: Mapped[list[float] | None] = mapped_column(
        ARRAY(Float), nullable=True, index=True
    )
    ocr_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    ocr_confidence: Mapped[float | None] = mapped_column(Float, nullable=True, index=True)
    ocr_entities: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    nsfw_score: Mapped[float | None] = mapped_column(Float, nullable=True, index=True)
    license_plate_detected: Mapped[bool | None] = mapped_column(Boolean, nullable=True, index=True)
    license_plate_bbox: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    safety_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True)


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
