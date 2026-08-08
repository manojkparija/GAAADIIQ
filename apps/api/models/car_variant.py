"""
The trims a model is sold in.

A catalogue row stands for a model — a Maruti Suzuki S-Presso of a given year —
because that is what a photograph belongs to and what a buyer browses. What a
buyer then asks is which trim to buy, and that question is entirely about the
differences between them: what each costs, and what each gives you for it.

That lived in a hardcoded map in the Angular car detail page, covering seven
models. Every other model showed no variants at all, and no admin action could
change it. A price a buyer budgets against does not belong in a component.

Prices here are the manufacturer's published ex-showroom figures for each
trim, so they are NUMERIC like cars.ex_showroom_price and for the same reason:
a float would quietly round a rupee amount.
"""
import enum
import uuid
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    JSON,
    Enum,
    ForeignKey,
    Index,
    Numeric,
    SmallInteger,
    String,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from .car import Car


class VariantStatus(str, enum.Enum):
    """
    Whether this trim is shown to buyers.

    Drafts exist because the fastest way to populate variants is to ask a
    language model, and a language model will state a plausible price with
    complete confidence. A figure nobody has read must not reach a buyer, so
    research lands as `draft` and an admin publishes it.
    """

    draft = "draft"
    published = "published"


class VariantSource(str, enum.Enum):
    """Where the figures came from, so an admin knows what to trust."""

    manual = "manual"
    ai = "ai"


class CarVariant(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "car_variants"
    __table_args__ = (
        Index("ix_car_variants_car_id", "car_id"),
        Index("ix_car_variants_status", "status"),
    )

    car_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("cars.id", ondelete="CASCADE"), nullable=False
    )

    # "VXi", "ZXi+ AMT", "Adventure Plus S". Free text, because manufacturers
    # name trims however they like and a controlled vocabulary would reject the
    # next launch.
    name: Mapped[str] = mapped_column(String(160), nullable=False)

    # NULL means nobody has priced this trim yet. Never render that as zero.
    ex_showroom_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))

    # Free text rather than the catalogue's enums: one model sells petrol,
    # diesel and CNG trims side by side, and "Petrol + CNG" is a real answer
    # that neither enum can hold.
    fuel_type: Mapped[str | None] = mapped_column(String(40))
    transmission: Mapped[str | None] = mapped_column(String(40))

    engine_cc: Mapped[int | None] = mapped_column(SmallInteger)
    seating_capacity: Mapped[int | None] = mapped_column(SmallInteger)
    mileage: Mapped[str | None] = mapped_column(String(40))

    # A list of strings, kept whole rather than normalised into a feature
    # table. Nothing queries across features — they are read as a bullet list
    # against one trim — and a join table would cost a migration every time a
    # manufacturer invents a name for a cupholder.
    features: Mapped[list | None] = mapped_column(JSON)

    status: Mapped[VariantStatus] = mapped_column(
        Enum(VariantStatus, name="variant_status"),
        default=VariantStatus.draft,
        nullable=False,
    )
    source: Mapped[VariantSource] = mapped_column(
        Enum(VariantSource, name="variant_source"),
        default=VariantSource.manual,
        nullable=False,
    )

    # Trims have a manufacturer's order — base to top — which is neither
    # alphabetical nor by price once two trims share one.
    sort_order: Mapped[int] = mapped_column(SmallInteger, default=0, nullable=False)

    car: Mapped["Car"] = relationship(back_populates="variants")
