import enum
from typing import TYPE_CHECKING

from sqlalchemy import Enum, Index, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
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

    # Relationships
    listings: Mapped[list["Listing"]] = relationship(back_populates="car")

    def __repr__(self) -> str:
        return f"<Car {self.year} {self.make} {self.model}>"
