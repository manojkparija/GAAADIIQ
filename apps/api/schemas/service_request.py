"""Service request payloads — raise, match, quote, pay."""

from __future__ import annotations

import re
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from models.service_request import ServiceRequestStatus
from schemas.mechanic import MechanicPublicOut

# Indian registration marks, old and BH series, ignoring spacing:
#   OD02AB1234 (state + RTO + series + number)
#   22BH1234AA (Bharat series)
CAR_NUMBER_RE = re.compile(r"^([A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})$")


class ServiceRequestCreate(BaseModel):
    car_number: str = Field(min_length=6, max_length=15)
    manufacturer: str | None = Field(default=None, max_length=100)
    model: str | None = Field(default=None, max_length=100)
    model_year: int | None = Field(default=None, ge=1950, le=2100)
    fuel_type: str | None = Field(default=None, max_length=30)

    # Required, and the point of the feature — the browser's current fix, not a
    # saved address.
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    location_accuracy_m: float | None = Field(default=None, ge=0)
    address_text: str | None = Field(default=None, max_length=400)
    landmark: str | None = Field(default=None, max_length=200)
    pincode: str | None = Field(default=None, min_length=6, max_length=6)

    # Where the mechanic calls back and where the WhatsApp receipt is sent.
    contact_phone: str | None = Field(default=None, max_length=15)

    problem_summary: str = Field(min_length=5, max_length=4000)
    severity: str | None = Field(default=None, max_length=20)
    is_vehicle_drivable: bool | None = None
    photo_urls: list[str] | None = None

    # Links the job back to the AI Diagnosis that prompted it, when there was one.
    diagnosis_id: uuid.UUID | None = None

    @field_validator("car_number")
    @classmethod
    def _normalise_car_number(cls, v: str) -> str:
        cleaned = re.sub(r"[\s-]", "", v).upper()
        if not CAR_NUMBER_RE.match(cleaned):
            raise ValueError("car_number is not a recognised Indian registration number")
        return cleaned


class ServiceRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    reference: str
    car_number: str
    manufacturer: str | None
    model: str | None
    latitude: float
    longitude: float
    address_text: str | None
    landmark: str | None
    problem_summary: str
    severity: str | None
    status: ServiceRequestStatus
    quoted_amount_paise: int | None
    final_amount_paise: int | None
    matched_distance_km: float | None
    mechanic: MechanicPublicOut | None = None
    assigned_at: datetime | None
    completed_at: datetime | None
    created_at: datetime


class NearbyMechanicsOut(BaseModel):
    """Result of a nearest-mechanic search."""

    latitude: float
    longitude: float
    radius_km: float
    count: int
    mechanics: list[MechanicPublicOut]


class AssignMechanicRequest(BaseModel):
    mechanic_id: uuid.UUID


class QuoteRequest(BaseModel):
    """Mechanic's price for the job, in paise."""

    amount_paise: int = Field(gt=0, le=100_000_00)


class CommissionPreviewOut(BaseModel):
    """The split, shown to the mechanic before they accept a quote.

    Surfaced deliberately: a marketplace that hides its take rate until settlement
    is one mechanics leave.
    """

    gross_paise: int
    commission_paise: int
    mechanic_payout_paise: int
    commission_rate_bps: int
    effective_rate_pct: float


class ServicePaymentOut(BaseModel):
    """Everything the customer's payment screen needs."""

    payment_id: uuid.UUID
    service_request_id: uuid.UUID
    reference: str
    amount_paise: int
    razorpay_order_id: str | None
    # "Scan to pay" — the UPI deep link plus a rendered QR when the optional
    # qrcode dependency is installed.
    upi_uri: str | None
    upi_qr_data_uri: str | None
    commission: CommissionPreviewOut
