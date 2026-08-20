import enum
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Date, Enum, Index, Numeric, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from .car_variant import CarVariant
    from .listing import Listing


class FuelType(str, enum.Enum):
    petrol = "petrol"
    diesel = "diesel"
    electric = "electric"
    cng = "cng"
    hybrid = "hybrid"


class Transmission(str, enum.Enum):
    manual = "manual"
    automatic = "automatic"
    amt = "amt"
    cvt = "cvt"
    dct = "dct"


class BodyType(str, enum.Enum):
    hatchback = "hatchback"
    sedan = "sedan"
    suv = "suv"
    muv = "muv"
    coupe = "coupe"
    convertible = "convertible"


class Car(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "cars"
    __table_args__ = (
        Index("ix_cars_make_model_year", "make", "model", "year"),
        Index("ix_cars_fuel_type", "fuel_type"),
        Index("ix_cars_body_type", "body_type"),
    )

    make: Mapped[str] = mapped_column(String(100), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    variant: Mapped[str | None] = mapped_column(String(100))
    year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    fuel_type: Mapped[FuelType | None] = mapped_column(Enum(FuelType, name="fuel_type"))
    transmission: Mapped[Transmission | None] = mapped_column(
        Enum(Transmission, name="transmission")
    )
    body_type: Mapped[BodyType | None] = mapped_column(Enum(BodyType, name="body_type"))
    seating_capacity: Mapped[int | None] = mapped_column(SmallInteger)
    engine_cc: Mapped[int | None] = mapped_column(SmallInteger)

    # Manufacturer's ex-showroom price for this model, in rupees.
    #
    # Distinct from listings.price, which is one seller's asking price for one
    # vehicle. A new car has a published price whether or not anyone has
    # advertised it, so it belongs to the catalogue row rather than to an
    # advert. NULL means nobody has entered a price yet — readers must show
    # that as unpriced, never as zero.
    ex_showroom_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))

    # A price someone checked against a real source, used to sanity-check the
    # one above. Never derived: a reference figure the system invented would be
    # indistinguishable from a checked one at the point it is read, and would
    # be believed — the reason credit_bureau.fetch_score raises rather than
    # returning something plausible.
    #
    # The source and the date travel with it because a price alone cannot be
    # judged. "OEM site, today" and "someone's memory, last year" are not the
    # same evidence, and a warning is only worth showing when the reader can
    # tell which one they are looking at.
    reference_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    reference_price_source: Mapped[str | None] = mapped_column(String(255))
    reference_price_checked_on: Mapped[date | None] = mapped_column(Date)

    # The model's specification, as label/value pairs read top to bottom, and
    # its feature list. JSON because nothing queries across them and a join
    # table would cost a migration every time a manufacturer names a cupholder.
    specs: Mapped[list | None] = mapped_column(JSON)
    features: Mapped[list | None] = mapped_column(JSON)

    # Relationships
    listings: Mapped[list["Listing"]] = relationship(back_populates="car")

    # Cascade because a trim has no meaning without its model: deleting the
    # catalogue row and leaving its variants would strand rows nothing reads.
    variants: Mapped[list["CarVariant"]] = relationship(
        back_populates="car", cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<Car {self.year} {self.make} {self.model}>"
