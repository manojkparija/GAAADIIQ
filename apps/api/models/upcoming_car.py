"""
Models that have been announced but are not on sale yet.

The New Cars page carries an "Upcoming Cars" strip. It was a hardcoded array of
five entries inside the Angular component, with the expected date as free text
("Q3 2026"), and nothing that ever removed one. So a car stayed under
"Upcoming" after it launched, and correcting that needed a code change and a
deploy — which is to say it never happened.

Reported with four of the five already on sale.

The same shape as the trims that used to live in a hardcoded map in the car
detail page: a fact about cars, kept somewhere no admin can reach. What is
"upcoming" changes every few weeks by definition, so of everything on that page
this is the entry least able to survive being a literal.

TWO WAYS TO STOP BEING UPCOMING, because one is not enough:

- `expected_on` passes. A date rather than a quarter string, so the question
  "is this still upcoming?" can be answered by comparison instead of by
  reading. The quarter is still what gets *shown* — the industry announces in
  quarters — but it is derived from the date, not stored as prose.
- `launched_at` is set. A car frequently arrives before the window it was
  promised in closes; the Tata Sierra EV was on sale while its own "Q3 2026"
  still had a month to run. Waiting for the date to pass would have kept it on
  the strip that whole time, so an admin can retire one the day it lands.

Neither is a delete: a launched model is a real thing that was announced, and
keeping the row means the page can stop showing it without losing the record.
"""
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Index, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base, TimestampMixin, UUIDMixin


class UpcomingCar(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "upcoming_cars"
    __table_args__ = (
        # The strip is ordered by when each car is expected, and the query
        # filters on the same column.
        Index("ix_upcoming_cars_expected_on", "expected_on"),
    )

    make: Mapped[str] = mapped_column(String(100), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)

    #: When the car is expected. The last day of the announced window, so a
    #: quarter's worth of vagueness is still one comparable date: "Q3 2026"
    #: is stored as 2026-09-30 and stops being upcoming on 1 October.
    expected_on: Mapped[date] = mapped_column(Date, nullable=False)

    #: Set when the car actually goes on sale, which is often before
    #: expected_on. Present means "no longer upcoming", whatever the date says.
    launched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    #: The expected price band, in rupees. NUMERIC for the same reason
    #: cars.ex_showroom_price is: a float rounds money.
    #:
    #: Both nullable — an announcement routinely names a car and a quarter and
    #: no price at all, and inventing one would put a figure on the page that
    #: nobody stated.
    expected_price_min: Mapped[float | None] = mapped_column(Numeric(12, 2))
    expected_price_max: Mapped[float | None] = mapped_column(Numeric(12, 2))

    body_type: Mapped[str | None] = mapped_column(String(50))
    fuel_type: Mapped[str | None] = mapped_column(String(50))

    #: A manufacturer's press image, when there is one to link. Upcoming cars
    #: have no vehicle_media rows — nobody has photographed them — so this is
    #: a plain URL rather than the media library.
    image_url: Mapped[str | None] = mapped_column(Text)

    #: Lets an admin take one off the strip without deleting it or declaring
    #: it launched — an announcement that turns out to be a rumour, say.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<UpcomingCar {self.make} {self.model} expected={self.expected_on}>"

    @property
    def is_upcoming(self) -> bool:
        """Whether a buyer should still see this on the strip."""
        return self.is_active and self.launched_at is None
