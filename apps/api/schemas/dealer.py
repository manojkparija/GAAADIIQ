import uuid
from datetime import datetime

from pydantic import BaseModel, field_validator


class DealerRegister(BaseModel):
    business_name: str
    city: str | None = None
    state: str | None = None
    gst_number: str | None = None

    @field_validator("business_name")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Business name cannot be empty")
        return v.strip()


class DealerUpdate(BaseModel):
    business_name: str | None = None
    city: str | None = None
    state: str | None = None
    gst_number: str | None = None


class DealerOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    business_name: str
    city: str | None
    state: str | None
    gst_number: str | None
    is_verified: bool
    rating: float | None
    created_at: datetime

    model_config = {"from_attributes": True}
