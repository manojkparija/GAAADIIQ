"""Mechanic registration and discovery payloads.

The asymmetry here is intentional: `MechanicRegisterRequest` accepts `aadhaar_number`
and `pan_number`, but no response model in this file can emit either. The Aadhaar
number leaves the process the moment it is hashed, and responses carry only the
masked fragment.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from models.mechanic import MechanicStatus


class MechanicRegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    shop_name: str | None = Field(default=None, max_length=200)
    phone: str = Field(min_length=10, max_length=15)
    whatsapp_phone: str | None = Field(default=None, max_length=15)
    email: EmailStr | None = None

    address_line1: str = Field(min_length=3, max_length=255)
    address_line2: str | None = Field(default=None, max_length=255)
    city: str = Field(min_length=2, max_length=100)
    state: str = Field(min_length=2, max_length=100)
    area_pincode: str = Field(min_length=6, max_length=6)

    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    service_radius_km: int = Field(default=15, ge=1, le=100)

    # Both mandatory. The detailed format/checksum validation lives in
    # services.kyc so the same rules apply to any future import path.
    pan_number: str = Field(min_length=10, max_length=10)
    aadhaar_number: str = Field(min_length=12, max_length=14)

    upi_vpa: str | None = Field(default=None, max_length=120)
    specialisations: list[str] | None = None

    @field_validator("area_pincode")
    @classmethod
    def _pincode_digits(cls, v: str) -> str:
        if not v.isdigit():
            raise ValueError("area_pincode must be 6 digits")
        return v

    @field_validator("phone", "whatsapp_phone")
    @classmethod
    def _phone_digits(cls, v: str | None) -> str | None:
        if v is None:
            return v
        cleaned = "".join(ch for ch in v if ch.isdigit())
        if len(cleaned) < 10:
            raise ValueError("phone must contain at least 10 digits")
        return cleaned


class MechanicOut(BaseModel):
    """Full record — for the mechanic themselves and for admins."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    shop_name: str | None
    phone: str
    whatsapp_phone: str | None
    email: str | None
    address_line1: str
    address_line2: str | None
    city: str
    state: str
    area_pincode: str
    latitude: float | None
    longitude: float | None
    service_radius_km: int
    pan_number: str
    # Masked only — never the number.
    aadhaar_masked: str
    upi_vpa: str | None
    specialisations: list[str] | None
    status: MechanicStatus
    is_available: bool
    rating: float | None
    jobs_completed: int
    created_at: datetime


class MechanicPublicOut(BaseModel):
    """What a customer choosing a mechanic is allowed to see.

    No KYC fields at all: a stranded customer needs a name, a number to call and a
    distance. PAN and the Aadhaar fragment are not theirs to see.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    shop_name: str | None
    phone: str
    city: str
    area_pincode: str
    specialisations: list[str] | None
    rating: float | None
    jobs_completed: int
    distance_km: float | None = None


class MechanicVerifyRequest(BaseModel):
    """Admin decision on a pending registration."""

    approve: bool
    reason: str | None = Field(default=None, max_length=500)


class MechanicAvailabilityRequest(BaseModel):
    is_available: bool
