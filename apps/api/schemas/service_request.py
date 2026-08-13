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


# ── Dispatch: broadcast, accept, start OTP ──────────────────────────────────

class DispatchRequestIn(BaseModel):
    """Optional overrides for a broadcast. Defaults come from settings."""

    radius_km: float | None = Field(default=None, gt=0, le=50)
    limit: int | None = Field(default=None, ge=1, le=50)


class DispatchResultOut(BaseModel):
    """What the broadcast did, from the customer's side.

    Deliberately a count and a distance, not a list of mechanics. The customer
    does not choose here — telling them who was asked invites them to ring
    around, which is the behaviour the broadcast exists to replace.
    """

    request_id: uuid.UUID
    reference: str
    radius_km: float
    offers_sent: int
    expires_at: datetime | None
    message: str


class StartOtpOut(BaseModel):
    """The start code, returned to the customer and to nobody else.

    This is the only response in the module that carries the plaintext OTP, and
    it is reachable only by the customer who owns the request. Every
    mechanic-facing schema below omits it by construction rather than by
    remembering to strip it.
    """

    request_id: uuid.UUID
    reference: str
    otp: str
    issued_at: datetime


class VerifyStartOtpIn(BaseModel):
    otp: str = Field(min_length=4, max_length=8)

    @field_validator("otp")
    @classmethod
    def _digits_only(cls, v: str) -> str:
        if not v.isdigit():
            raise ValueError("OTP must be digits only")
        return v


class OfferOut(BaseModel):
    """A broadcast job as the *mechanic* sees it, before accepting.

    Carries enough to decide — how far, what is wrong, whether the car moves —
    and none of the customer's identity. No name, no phone number, no exact
    coordinates and no street address: those appear only on the job detail once
    this mechanic has actually won it.

    A 1 km broadcast reaches every mechanic in the area at once. Putting a
    stranded person's precise position and the fact that they are alone with a
    broken car into all of those hands, on the strength of a tap nobody has
    committed to, is not a trade worth making for a slightly richer card.
    """

    model_config = ConfigDict(from_attributes=True)

    offer_id: uuid.UUID
    request_id: uuid.UUID
    reference: str
    distance_km: float
    problem_summary: str
    severity: str | None
    is_vehicle_drivable: bool | None
    manufacturer: str | None
    model: str | None
    # Area only — the pincode and a landmark, never the street address.
    pincode: str | None
    landmark: str | None
    created_at: datetime
    expires_at: datetime | None


class AcceptOfferOut(BaseModel):
    """Result of a mechanic tapping Accept.

    `won` is false when another mechanic got there first. That is an ordinary
    outcome of a broadcast, not an error, so it returns 200 with won=false
    rather than a 409 the app has to interpret.
    """

    won: bool
    request_id: uuid.UUID
    message: str
    request: ServiceRequestOut | None = None
