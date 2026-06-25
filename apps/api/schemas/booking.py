import uuid
from datetime import date, datetime, time

from pydantic import BaseModel

from models.test_drive_booking import BookingStatus


class BookingCreate(BaseModel):
    listing_id: uuid.UUID
    preferred_date: date | None = None
    preferred_time: time | None = None
    notes: str | None = None


class BookingStatusUpdate(BaseModel):
    status: BookingStatus


class BookingOut(BaseModel):
    id: uuid.UUID
    listing_id: uuid.UUID
    user_id: uuid.UUID
    preferred_date: date | None
    preferred_time: time | None
    status: BookingStatus
    notes: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
