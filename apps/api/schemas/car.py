import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator

from models.car import BodyType, FuelType, Transmission

#: Mirrors services/variant_research.MAX_FEATURES / MAX_SPECS.
#:
#: Duplicated rather than imported: schemas/ importing a service would invert
#: the dependency every other schema here follows, and these two numbers are a
#: presentation bound — how much the tab can show — not a research detail. The
#: comment on CarUpdate.features records why they must stay in step.
_MAX_FEATURES = 16
_MAX_SPECS = 12


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
    reference_price: Decimal | None = None
    reference_price_source: str | None = None
    reference_price_checked_on: date | None = None

    # Photographs from the media library that match this car's make, model and
    # year. Not a stored column: cars carry no image of their own, and an image
    # is uploaded against a vehicle's identity rather than against a catalogue
    # row, so the association is resolved at read time. Empty when nothing has
    # been uploaded for the model yet.
    image_urls: list[str] = []
    # The 360° spin sequence, in turn order, kept apart from image_urls because
    # a spin frame is not a gallery photograph — one frame on its own says
    # nothing and only the ordered set means anything. Empty unless enough
    # frames exist to genuinely turn the car; see media_library.SPIN_MIN_FRAMES.
    # Only the single-car endpoint fills this: a listing page renders one
    # thumbnail per car and has no use for thirty-six frames of each.
    spin_urls: list[str] = []
    # How many trims a buyer can actually choose between. Counted rather than
    # inferred from catalogue rows: a model is one row, and the card that says
    # "1 Variant" beside eight published trims is simply wrong.
    variant_count: int = 0
    # The band those published trims span, or None when no trim carries a
    # price. A listing card cannot work this out for itself — it holds one
    # catalogue row and never fetches that row's trims — so without these it
    # falls back to `ex_showroom_price`, a figure maintained by hand and quite
    # separately from the trims. The two drift, and then the same car quotes
    # one price on the card and a different one on its own detail page.
    variant_price_min: Decimal | None = None
    variant_price_max: Decimal | None = None
    # The gearboxes and fuels the published trims are sold with.
    #
    # A catalogue row carries one `transmission` and one `fuel_type`, but a
    # model is sold with several. The New Cars grid filtered on the row's
    # single value, so ticking Automatic hid an S-Presso — listed as Manual on
    # its row while having an automatic trim. Filtering a model out of a grid
    # is indistinguishable from the model not existing, so the filter has to
    # see every gearbox the model actually offers.
    variant_transmissions: list[str] = []
    variant_fuels: list[str] = []
    specs: list | None = None
    features: list | None = None

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

    # A figure a person looked up, with where and when. Never derived — see
    # services/price_reference.
    reference_price: Decimal | None = Field(default=None, ge=0)
    reference_price_source: str | None = Field(default=None, max_length=255)
    reference_price_checked_on: date | None = None

    # The Specs and Features tabs, editable by hand.
    #
    # WHY THESE ARE HERE
    #
    # They had exactly one writer: POST /cars/{id}/research-details, which asks
    # a language model. That is fine when the model knows the car and useless
    # when it does not — which is precisely the case for a launch whose price
    # is not announced yet, reported on the Maruti Suzuki Victoris with images
    # uploaded, variants listed, and "Feature details for this car haven't been
    # added yet" under Features. There was no way to type them.
    #
    # The AI draft is unaffected: research_car_details writes each field only
    # when it is empty, so it still fills a gap and still never overwrites
    # anything a person curated — now including what they typed here.
    #
    # Bounds match services/variant_research (MAX_FEATURES, MAX_SPECS and the
    # per-string caps) on purpose. A hand-entered list that the drafted path
    # would have truncated is the same list rendered differently, and the tab
    # has no idea which route a value arrived by.
    features: list[str] | None = None
    specs: list[dict] | None = None

    @field_validator("features")
    @classmethod
    def _tidy_features(cls, value: list[str] | None) -> list[str] | None:
        """Strip, drop blanks, bound. None stays None — see the class docstring."""
        if value is None:
            return None
        cleaned = [str(item).strip()[:80] for item in value]
        return [item for item in cleaned if item][:_MAX_FEATURES]

    @field_validator("specs")
    @classmethod
    def _tidy_specs(cls, value: list[dict] | None) -> list[dict] | None:
        """Label/value pairs, both non-empty. A half-filled row is dropped.

        Not an error: the editor renders blank rows to type into, and rejecting
        the save because one was left empty would be a validation failure the
        person cannot see the cause of.
        """
        if value is None:
            return None
        out: list[dict] = []
        for item in value:
            if not isinstance(item, dict):
                continue
            label = str(item.get("label") or "").strip()[:60]
            detail = str(item.get("value") or "").strip()[:80]
            if label and detail:
                out.append({"label": label, "value": detail})
        return out[:_MAX_SPECS]


class PriceCheckOut(BaseModel):
    """
    What the entered price looks like against the reference.

    Returned alongside the saved car so the screen can warn without a second
    round trip. `has_reference` is separate from `is_significant` on purpose:
    "nothing to compare against" and "compared and fine" are different facts,
    and a publisher acts differently on each.
    """

    has_reference: bool
    is_significant: bool
    difference: float | None = None
    reference_age_days: int | None = None
    is_stale: bool = False
    message: str | None = None


class CarListOut(BaseModel):
    items: list[CarOut]
    total: int
    page: int
    page_size: int
