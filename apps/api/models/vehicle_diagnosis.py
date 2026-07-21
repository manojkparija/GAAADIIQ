from __future__ import annotations

import uuid

from sqlalchemy import JSON, Boolean, Float, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base, TimestampMixin, UUIDMixin


class VehicleDiagnosis(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "vehicle_diagnoses"

    # Who submitted (optional — guests can use too)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)

    # Vehicle details
    manufacturer: Mapped[str] = mapped_column(String(100), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    variant: Mapped[str | None] = mapped_column(String(100))
    model_year: Mapped[int] = mapped_column(Integer, nullable=False)
    fuel_type: Mapped[str] = mapped_column(String(30), nullable=False)
    transmission: Mapped[str] = mapped_column(String(30), nullable=False)
    odometer_km: Mapped[int | None] = mapped_column(Integer)

    # Symptoms
    problem_description: Mapped[str] = mapped_column(Text, nullable=False)
    warning_lights: Mapped[list | None] = mapped_column(JSON)
    when_occurs: Mapped[list | None] = mapped_column(JSON)
    severity: Mapped[str] = mapped_column(String(20), nullable=False)  # low/medium/high/critical

    # Media (S3 keys or local paths)
    image_urls: Mapped[list | None] = mapped_column(JSON)
    audio_url: Mapped[str | None] = mapped_column(String(500))
    video_url: Mapped[str | None] = mapped_column(String(500))

    # AI output
    preliminary_diagnosis: Mapped[str | None] = mapped_column(Text)
    possible_causes: Mapped[list | None] = mapped_column(JSON)
    repair_complexity: Mapped[str | None] = mapped_column(String(30))
    cost_min_inr: Mapped[int | None] = mapped_column(Integer)
    cost_max_inr: Mapped[int | None] = mapped_column(Integer)
    repair_time_estimate: Mapped[str | None] = mapped_column(String(100))
    safe_to_drive: Mapped[bool | None] = mapped_column(Boolean)
    risk_level: Mapped[str | None] = mapped_column(String(20))
    recommended_steps: Mapped[list | None] = mapped_column(JSON)
    diy_fixes: Mapped[list | None] = mapped_column(JSON)
    immediate_service_required: Mapped[bool | None] = mapped_column(Boolean)
    preventive_maintenance: Mapped[list | None] = mapped_column(JSON)
    retrieved_sources: Mapped[list | None] = mapped_column(JSON)
    ollama_used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    analysis_confidence: Mapped[float | None] = mapped_column(Float)

    def __repr__(self) -> str:
        return f"<VehicleDiagnosis id={self.id} {self.manufacturer} {self.model} {self.model_year}>"
