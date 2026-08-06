import uuid
from datetime import datetime

from pydantic import BaseModel, field_validator

from models.car import BodyType, FuelType, Transmission


class CarCreate(BaseModel):
    make: str
    model: str
    variant: str | None = None
    year: int
    fuel_type: FuelType | None = None
    transmission: Transmission | None = None
    body_type: BodyType | None = None
    seating_capacity: int | None = None
    engine_cc: int | None = None

    @field_validator("year")
    @classmethod
    def valid_year(cls, v: int) -> int:
        if v < 1980 or v > datetime.now().year + 1:
            raise ValueError("Year must be between 1980 and next year")
        return v


class CarOut(BaseModel):
    id: uuid.UUID
    make: str
    model: str
    variant: str | None
    year: int
    fuel_type: FuelType | None
    transmission: Transmission | None
    body_type: BodyType | None
    seating_capacity: int | None
    engine_cc: int | None
    created_at: datetime

    # Photographs from the media library that match this car's make, model and
    # year. Not a stored column: cars carry no image of their own, and an image
    # is uploaded against a vehicle's identity rather than against a catalogue
    # row, so the association is resolved at read time. Empty when nothing has
    # been uploaded for the model yet.
    image_urls: list[str] = []

    model_config = {"from_attributes": True}


class CarListOut(BaseModel):
    items: list[CarOut]
    total: int
    page: int
    page_size: int
