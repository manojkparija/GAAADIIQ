"""
What buyers searched for, and where from.

This is the table behind three of the dealer-facing features — demand
heatmaps, inventory-gap analysis, and any honest statement about what is in
demand in a city. All three are questions about *unmet* demand, which is
precisely the thing the listings table cannot answer: it records what was
offered, never what was looked for and not found.

Searches that return nothing are the most valuable rows here. "Forty people
searched for a hybrid SUV in this pincode last month and saw zero results" is
the entire point, and it exists nowhere else.

The row keeps the filters, not free text the buyer typed about themselves. The
query string is capped and stored as-is because model names are the useful part
("fortuner", "creta") — it is never rendered back to another user.
"""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base, UUIDMixin

if TYPE_CHECKING:  # pragma: no cover
    pass


class SearchEvent(UUIDMixin, Base):
    __tablename__ = "search_events"

    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    visitor_key: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # The filters as applied. All optional — most searches set two or three.
    query_text: Mapped[str | None] = mapped_column(String(120), nullable=True)
    make: Mapped[str | None] = mapped_column(String(60), nullable=True)
    model: Mapped[str | None] = mapped_column(String(60), nullable=True)
    body_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    fuel_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Kept apart from city: "buyers near me" is a pincode question, and a city
    # is far too coarse to tell a dealer in New Town anything useful.
    pincode: Mapped[str | None] = mapped_column(String(10), nullable=True)
    price_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    price_max: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # The whole reason for the table: how many cars this search actually found.
    # Zero is the interesting value.
    result_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    searched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("ix_search_events_time", "searched_at"),
        # Demand by place, which is how both the heatmap and the gap analysis
        # read it.
        Index("ix_search_events_city_time", "city", "searched_at"),
        Index("ix_search_events_model_time", "make", "model", "searched_at"),
    )

    def __repr__(self) -> str:
        return f"<SearchEvent {self.make} {self.model} in {self.city} → {self.result_count}>"
