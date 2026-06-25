import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from models.loan_inquiry import EmploymentType, LoanStatus


class LoanInquiryCreate(BaseModel):
    listing_id: uuid.UUID
    loan_amount: float = Field(gt=0)
    tenure_months: int = Field(ge=6, le=360)
    employment_type: EmploymentType
    annual_income: float = Field(gt=0)


class LoanInquiryOut(BaseModel):
    id: uuid.UUID
    listing_id: uuid.UUID
    user_id: uuid.UUID
    loan_amount: float | None
    tenure_months: int | None
    employment_type: EmploymentType | None
    annual_income: float | None
    status: LoanStatus
    partner_ref: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class EMIResult(BaseModel):
    principal: float
    annual_rate: float
    tenure_months: int
    monthly_emi: float
    total_payment: float
    total_interest: float
    down_payment_20pct: float
