"""
New-car enquiries captured from the "View Offers" flow, for dealer follow-up.

WHY THIS IS NOT car_enquiries
=============================

`car_enquiries` already exists and the dealer dashboard reads it, but it cannot
carry these. Its RLS policy grants a read through
`car_listings.seller_id -> sellers`, which is right for a used car somebody has
listed and wrong for a catalogue model: a Fronx row has no listing and no
seller, so a lead captured against it would be readable by no dealer at all.
It would sit in the table and reach nobody, which is worse than not capturing
it — the buyer has been told someone will call.

New-car leads are therefore routed by locality instead of ownership: a dealer
sees the leads in their own city. `dealers.city` already exists, so this works
against the data as it stands.

THE PHONE NUMBER IS PERSONAL DATA
=================================

A row here is a named individual who asked to be contacted about a purchase,
and the number is the whole point of the record, so it is stored in the clear —
a digest could not be dialled. That places three obligations on this table
rather than on the code that happens to read it:

  * `consented_at` records that the buyer agreed to be contacted, and when. It
    is not a boolean: consent that cannot be dated cannot be shown to have
    preceded the call.
  * `phone_verified` is only ever set by the endpoint that checked an OTP. An
    unverified number is somebody else's, and dealers must not call it.
  * nothing here is exposed on a public endpoint. See routers/leads.py.
"""
import uuid
from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base, TimestampMixin, UUIDMixin


class LeadStatus(str, PyEnum):
    new = "new"
    contacted = "contacted"
    qualified = "qualified"
    won = "won"
    lost = "lost"


class LeadSource(str, PyEnum):
    """Where the buyer was standing when they asked. Kept because the follow-up
    script differs: someone who clicked "View Offers" expects a price, someone
    who asked for a test drive expects a date."""

    offers_cta = "offers_cta"
    car_detail = "car_detail"
    variants = "variants"


class CarLead(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "car_leads"
    __table_args__ = (
        # The dealer inbox query is "my city, newest first"; the make index
        # serves the per-model view on the same page.
        Index("ix_car_leads_city_created", "city", "created_at"),
        Index("ix_car_leads_make_model", "make", "model"),
    )

    # The catalogue row the buyer was looking at. Nullable because a model can
    # be delisted while its leads are still being worked, and losing the lead
    # would be the wrong side of that trade.
    car_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cars.id", ondelete="SET NULL")
    )
    # Denormalised deliberately. These are what the dealer is called about and
    # what routing matches on, and they must survive the catalogue row being
    # edited or removed underneath the lead.
    make: Mapped[str] = mapped_column(String(80), nullable=False)
    model: Mapped[str] = mapped_column(String(120), nullable=False)
    variant: Mapped[str | None] = mapped_column(String(120))

    # Where to route it. City is required — a lead nobody can be matched to is
    # the failure this table exists to avoid.
    city: Mapped[str] = mapped_column(String(100), nullable=False)
    locality: Mapped[str | None] = mapped_column(String(160))
    pincode: Mapped[str | None] = mapped_column(String(10))

    # Contact. Stored as +91XXXXXXXXXX, matching the OTP router's pattern.
    phone: Mapped[str] = mapped_column(String(16), nullable=False)
    phone_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    name: Mapped[str | None] = mapped_column(String(160))
    email: Mapped[str | None] = mapped_column(String(255))

    # When the buyer agreed to be contacted. Null means they did not.
    consented_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    source: Mapped[LeadSource] = mapped_column(
        Enum(LeadSource, name="lead_source"), default=LeadSource.offers_cta, nullable=False
    )
    status: Mapped[LeadStatus] = mapped_column(
        Enum(LeadStatus, name="lead_status"), default=LeadStatus.new, nullable=False
    )
    assigned_dealer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("dealers.id", ondelete="SET NULL")
    )
    notes: Mapped[str | None] = mapped_column(Text)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<CarLead {self.make} {self.model} {self.city} {self.status}>"
