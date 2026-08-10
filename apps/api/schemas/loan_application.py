"""Request and response shapes for the car loan module.

The PAN never appears in a response. It goes in on the application and comes
back masked, everywhere, without an option to retrieve it — the only consumer
that needs the full number is the lender hand-off, which reads the column
directly rather than round-tripping through the API.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from models.lending_partner import CreditBand, EmploymentType, PartnerType
from models.loan_application import CreditSource, LoanApplicationStatus, VehicleCondition


class RateSlabOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    credit_band: CreditBand
    employment_type: EmploymentType | None
    annual_rate_pct: float


class LendingPartnerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    partner_type: PartnerType
    logo_url: str | None
    #: The advertised "from" rate — the best band's rate, which is what a rate
    #: comparison table shows and what the lender's own marketing quotes.
    rate_from_pct: float | None = None
    min_loan_amount: float
    max_loan_amount: float
    min_tenure_months: int
    max_tenure_months: int
    min_monthly_income: float
    max_ltv_pct: float
    processing_fee_pct: float
    finances_used_cars: bool


class LoanApplicationCreate(BaseModel):
    """What the applicant fills in.

    `credit_score` is accepted but is a *declaration*, not a check. It is
    recorded as `self_declared` and the response says so, because an applicant's
    memory of their score and the lender's pull are routinely different numbers.
    """

    # What is being financed. A car or listing id is optional — a buyer may be
    # financing a vehicle they found elsewhere — but the price never is, since
    # it is what LTV is computed against.
    car_id: uuid.UUID | None = None
    listing_id: uuid.UUID | None = None
    vehicle_condition: VehicleCondition = VehicleCondition.new
    vehicle_description: str | None = Field(default=None, max_length=200)
    vehicle_year: int | None = Field(default=None, ge=1980, le=2100)
    vehicle_price: float = Field(gt=0)

    applicant_name: str = Field(min_length=2, max_length=150)
    date_of_birth: date | None = None
    mobile: str = Field(min_length=10, max_length=15)
    email: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=100)
    pincode: str | None = Field(default=None, max_length=10)
    pan_number: str = Field(min_length=10, max_length=10)

    employment_type: EmploymentType
    employer_name: str | None = Field(default=None, max_length=150)
    monthly_income: float = Field(gt=0)
    existing_emi: float = Field(default=0, ge=0)

    down_payment: float = Field(default=0, ge=0)
    loan_amount: float = Field(gt=0)
    tenure_months: int = Field(ge=6, le=120)

    credit_score: int | None = Field(default=None, ge=-1, le=900)
    #: Consent to a bureau enquiry. Required by the CIC(R) Act before any check,
    #: and recorded with a timestamp — see models/loan_application.py.
    credit_consent: bool = False


class LoanOfferOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    partner: LendingPartnerOut
    is_eligible: bool
    ineligible_reason: str | None
    annual_rate_pct: float | None
    approved_amount: float | None
    tenure_months: int | None
    monthly_emi: float | None
    total_interest: float | None
    processing_fee: float | None
    total_cost: float | None
    rank: int | None
    is_recommended: bool


class LoanApplicationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    reference: str
    status: LoanApplicationStatus
    vehicle_condition: VehicleCondition
    vehicle_description: str | None
    vehicle_price: float
    applicant_name: str
    mobile: str
    #: Masked. The full PAN is never serialised.
    pan_masked: str
    employment_type: EmploymentType
    monthly_income: float
    existing_emi: float
    down_payment: float
    loan_amount: float
    tenure_months: int
    credit_score: int | None
    credit_band: CreditBand
    credit_band_label: str
    credit_source: CreditSource
    selected_offer_id: uuid.UUID | None
    created_at: datetime
    offers: list[LoanOfferOut] = []


class SelectOfferRequest(BaseModel):
    offer_id: uuid.UUID


class CreditCheckRequest(BaseModel):
    """Ask for a live bureau pull, or record a declared score.

    Consent is mandatory for the former and meaningless for the latter, which is
    why it is a field here rather than assumed from the endpoint being called.
    """

    credit_consent: bool = False
    declared_score: int | None = Field(default=None, ge=-1, le=900)


class CreditCheckOut(BaseModel):
    source: CreditSource
    bureau: str | None
    score: int | None
    band: CreditBand
    band_label: str
    succeeded: bool
    #: Present when no bureau is configured, so the UI can explain that the
    #: quote rests on a declared band rather than a checked one.
    note: str | None = None
