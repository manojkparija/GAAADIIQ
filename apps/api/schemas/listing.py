import uuid
from datetime import datetime

from pydantic import BaseModel, field_validator

from models.listing import ListingCondition, ListingType
from schemas.car import CarOut
from schemas.user import UserPublicOut


class ListingCreate(BaseModel):
    car_id: uuid.UUID
    listing_type: ListingType
    price: float
    negotiable: bool = False
    km_driven: int | None = None
    registration_year: int | None = None
    registration_state: str | None = None
    owners_count: int | None = None
    condition: ListingCondition | None = None
    city: str | None = None
    description: str | None = None

    @field_validator("price")
    @classmethod
    def positive_price(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("Price must be positive")
        return v

    @field_validator("km_driven")
    @classmethod
    def non_negative_km(cls, v: int | None) -> int | None:
        if v is not None and v < 0:
            raise ValueError("km_driven cannot be negative")
        return v


class ListingUpdate(BaseModel):
    price: float | None = None
    negotiable: bool | None = None
    km_driven: int | None = None
    condition: ListingCondition | None = None
    city: str | None = None
    description: str | None = None
    is_active: bool | None = None


class ListingOut(BaseModel):
    id: uuid.UUID
    listing_type: ListingType
    price: float
    negotiable: bool
    km_driven: int | None
    registration_year: int | None
    registration_state: str | None
    owners_count: int | None
    condition: ListingCondition | None
    city: str | None
    description: str | None
    is_active: bool
    is_featured: bool
    views_count: int
    ai_valuation: float | None
    ai_method: str | None
    ai_confidence: str | None
    ai_reasoning: str | None
    image_urls: list[str]
    car: CarOut
    seller: UserPublicOut
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ListingListOut(BaseModel):
    items: list[ListingOut]
    total: int
    page: int
    page_size: int


class ListingFilters(BaseModel):
    listing_type: ListingType | None = None
    city: str | None = None
    make: str | None = None
    model: str | None = None
    fuel_type: str | None = None
    body_type: str | None = None
    min_price: float | None = None
    max_price: float | None = None
    min_year: int | None = None
    max_year: int | None = None
    max_km: int | None = None
    page: int = 1
    page_size: int = 20

    @field_validator("page")
    @classmethod
    def min_page(cls, v: int) -> int:
        return max(1, v)

    @field_validator("page_size")
    @classmethod
    def clamp_page_size(cls, v: int) -> int:
        return min(max(1, v), 100)
