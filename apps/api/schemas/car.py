import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator

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
    ex_showroom_price: Decimal | None = Field(default=None, ge=0)

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

    # Manufacturer's ex-showroom price in rupees, or None when nobody has
    # entered one. Clients must render None as "price on request" rather than
    # as a number: a model shown at ₹0 misleads a buyer far more than a model
    # shown with no price at all.
    ex_showroom_price: Decimal | None = None

    # Photographs from the media library that match this car's make, model and
    # year. Not a stored column: cars carry no image of their own, and an image
    # is uploaded against a vehicle's identity rather than against a catalogue
    # row, so the association is resolved at read time. Empty when nothing has
    # been uploaded for the model yet.
    image_urls: list[str] = []

    model_config = {"from_attributes": True}


class CarUpdate(BaseModel):
    """
    Partial update of a catalogue car. Every field is optional and only the
    ones supplied are written, so setting a price does not require the caller
    to resend the model's whole specification.

    Because "not supplied" and "explicitly cleared" both arrive as None on the
    model, the router reads `model_fields_set` rather than the values, which
    keeps clearing a price back to "price on request" possible.
    """

    variant: str | None = None
    fuel_type: FuelType | None = None
    transmission: Transmission | None = None
    body_type: BodyType | None = None
    seating_capacity: int | None = None
    engine_cc: int | None = None
    ex_showroom_price: Decimal | None = Field(default=None, ge=0)


class CarListOut(BaseModel):
    items: list[CarOut]
    total: int
    page: int
    page_size: int
