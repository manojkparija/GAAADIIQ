"""Pydantic data models for the PDF ingestion pipeline."""

from __future__ import annotations
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field, field_validator
import uuid


class ExtractionStatus(str, Enum):
    PENDING          = "PENDING"
    PARSING          = "PARSING"
    EXTRACTING       = "EXTRACTING"
    MATCHING_IMAGES  = "MATCHING_IMAGES"
    VALIDATING       = "VALIDATING"
    AWAITING_REVIEW  = "AWAITING_REVIEW"
    APPROVED         = "APPROVED"
    REJECTED         = "REJECTED"
    FAILED           = "FAILED"


class VehicleStatus(str, Enum):
    READY        = "READY"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    INCOMPLETE   = "INCOMPLETE"


class FuelType(str, Enum):
    PETROL  = "Petrol"
    DIESEL  = "Diesel"
    CNG     = "CNG"
    ELECTRIC= "Electric"
    HYBRID  = "Hybrid"
    OTHER   = "Other"


class Transmission(str, Enum):
    MANUAL    = "Manual"
    AUTOMATIC = "Automatic"
    AMT       = "AMT"
    CVT       = "CVT"
    DCT       = "DCT"


class BodyType(str, Enum):
    HATCHBACK = "Hatchback"
    SEDAN     = "Sedan"
    SUV       = "SUV"
    MUV       = "MUV"
    COUPE     = "Coupe"
    PICKUP    = "Pickup"
    VAN       = "Van"
    OTHER     = "Other"


class ExtractedSpec(BaseModel):
    label: str
    value: str


class ExtractedImage(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    url: str                           # temp local path; replaced with CDN URL on publish
    colour: Optional[str] = None
    match_confidence: float = 0.0
    matched_variant: Optional[str] = None
    page_num: int = 0


class ExtractedVehicle(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    job_id: str

    # Core fields
    make:         Optional[str]   = None
    model:        Optional[str]   = None
    variant:      Optional[str]   = None
    year:         Optional[int]   = None
    body_type:    Optional[str]   = None
    fuel_type:    Optional[str]   = None
    transmission: Optional[str]   = None
    price_inr:    Optional[float] = None
    engine_cc:    Optional[float] = None
    power_bhp:    Optional[float] = None
    torque_nm:    Optional[float] = None
    mileage_kmpl: Optional[float] = None
    seating:      Optional[int]   = None
    colours:      list[str]       = []
    specs:        list[ExtractedSpec] = []
    images:       list[ExtractedImage] = []

    # Pipeline metadata
    quality_score: float = 0.0          # 0–100
    confidence:    dict[str, float] = {}
    status:        VehicleStatus    = VehicleStatus.INCOMPLETE
    duplicate_of:  Optional[str]    = None
    admin_notes:   str              = ""

    @field_validator("price_inr")
    @classmethod
    def price_range(cls, v):
        if v is not None and not (100_000 <= v <= 50_000_000):
            raise ValueError(f"Price {v} out of plausible range ₹1L–₹5Cr")
        return v

    @field_validator("mileage_kmpl")
    @classmethod
    def mileage_range(cls, v):
        if v is not None and not (5 <= v <= 80):
            raise ValueError(f"Mileage {v} kmpl out of range 5–80")
        return v

    @field_validator("power_bhp")
    @classmethod
    def power_range(cls, v):
        if v is not None and not (30 <= v <= 800):
            raise ValueError(f"Power {v} bhp out of range")
        return v


class IngestionJob(BaseModel):
    id:             str = Field(default_factory=lambda: str(uuid.uuid4()))
    filename:       str
    file_size:      int
    status:         ExtractionStatus = ExtractionStatus.PENDING
    progress:       int              = 0   # 0–100
    vehicles_found: int              = 0
    created_at:     str              = ""
    completed_at:   Optional[str]    = None
    error:          Optional[str]    = None
    vehicles:       list[ExtractedVehicle] = []
    listing_type:   str              = "new"   # "new" | "used"


class ApproveRequest(BaseModel):
    make:         Optional[str]   = None
    model:        Optional[str]   = None
    variant:      Optional[str]   = None
    year:         Optional[int]   = None
    price_inr:    Optional[float] = None
    fuel_type:    Optional[str]   = None
    transmission: Optional[str]   = None
    engine_cc:    Optional[float] = None
    power_bhp:    Optional[float] = None
    torque_nm:    Optional[float] = None
    mileage_kmpl: Optional[float] = None
    seating:      Optional[int]   = None


class RejectRequest(BaseModel):
    reason: Optional[str] = None


class PatchRequest(BaseModel):
    make:         Optional[str]   = None
    model:        Optional[str]   = None
    variant:      Optional[str]   = None
    year:         Optional[int]   = None
    price_inr:    Optional[float] = None
    fuel_type:    Optional[str]   = None
    transmission: Optional[str]   = None
    engine_cc:    Optional[float] = None
    power_bhp:    Optional[float] = None
    torque_nm:    Optional[float] = None
    mileage_kmpl: Optional[float] = None
    seating:      Optional[int]   = None
    admin_notes:  Optional[str]   = None
