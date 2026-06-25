import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class ReviewCreate(BaseModel):
    listing_id: uuid.UUID
    rating: int = Field(ge=1, le=5)
    title: str | None = Field(default=None, max_length=200)
    body: str | None = None


class ReviewOut(BaseModel):
    id: uuid.UUID
    reviewer_id: uuid.UUID
    seller_id: uuid.UUID
    listing_id: uuid.UUID | None
    booking_id: uuid.UUID | None
    rating: int
    title: str | None
    body: str | None
    is_verified: bool
    reviewer_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class SellerRatingSummary(BaseModel):
    seller_id: uuid.UUID
    average_rating: float | None
    review_count: int
    rating_distribution: dict[int, int]  # {1: n, 2: n, ..., 5: n}
