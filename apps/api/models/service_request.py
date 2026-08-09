"""Service requests — the job a user raises when AI Diagnosis finds something major.

This is deliberately its own table rather than columns bolted onto
`vehicle_diagnoses`. A diagnosis is an *assessment* and is immutable once written;
a service request is a *transaction* with a lifecycle, a mechanic, money and a
receipt hanging off it. One diagnosis can also produce several requests (the user
tries one mechanic, cancels, picks another), so the relationship is one-to-many
and `diagnosis_id` is nullable — a user can raise a request directly without ever
running a diagnosis.

Location is captured at request time from the browser's Geolocation API rather
than read off the mechanic or the user profile. That is the whole point of the
feature: the coordinates that matter are where the car is stranded right now, not
where the owner lives.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    JSON,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from .mechanic import Mechanic
    from .user import User


class ServiceRequestStatus(str, enum.Enum):
    """Lifecycle of a job.

    `awaiting_payment` is entered only once the mechanic marks the work done, so a
    customer is never asked to pay before there is something to pay for.
    """

    open = "open"                      # raised, no mechanic assigned yet
    assigned = "assigned"              # a mechanic accepted
    in_progress = "in_progress"        # mechanic on site / working
    awaiting_payment = "awaiting_payment"
    paid = "paid"
    completed = "completed"
    cancelled = "cancelled"


class ServiceRequest(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "service_requests"

    # Human-facing reference printed on the receipt (e.g. "SR-7F3A21").
    reference: Mapped[str] = mapped_column(String(20), nullable=False, unique=True, index=True)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Nullable: a request can be raised straight from the garage finder without a
    # diagnosis, and a diagnosis must never be deleted out from under a paid job.
    diagnosis_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicle_diagnoses.id", ondelete="SET NULL"), nullable=True, index=True
    )
    mechanic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("mechanics.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # --- Vehicle ------------------------------------------------------------
    # Stored normalised (uppercase, no spaces) so "OD 02 AB 1234" and "od02ab1234"
    # are the same car when support goes looking.
    car_number: Mapped[str] = mapped_column(String(15), nullable=False, index=True)
    manufacturer: Mapped[str | None] = mapped_column(String(100))
    model: Mapped[str | None] = mapped_column(String(100))
    model_year: Mapped[int | None] = mapped_column(Integer)
    fuel_type: Mapped[str | None] = mapped_column(String(30))

    # --- Where the car actually is -----------------------------------------
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    # Metres of GPS uncertainty as reported by the browser. Worth keeping: a fix
    # accurate to 2km is a different dispatch problem to one accurate to 10m.
    location_accuracy_m: Mapped[float | None] = mapped_column(Float)
    address_text: Mapped[str | None] = mapped_column(String(400))
    landmark: Mapped[str | None] = mapped_column(String(200))
    pincode: Mapped[str | None] = mapped_column(String(6), index=True)

    # --- The problem --------------------------------------------------------
    # The number the mechanic calls back on, and where the receipt is sent. Kept
    # on the request rather than read off the user account: the person standing
    # with the car is not always the account holder, and a roadside job needs a
    # number that is actually reachable right now.
    contact_phone: Mapped[str | None] = mapped_column(String(15))

    problem_summary: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str | None] = mapped_column(String(20))
    is_vehicle_drivable: Mapped[bool | None] = mapped_column()
    photo_urls: Mapped[list | None] = mapped_column(JSON)

    # --- Quote / settlement -------------------------------------------------
    # Paise throughout, matching models.payment, so no float ever touches money.
    quoted_amount_paise: Mapped[int | None] = mapped_column(Integer)
    final_amount_paise: Mapped[int | None] = mapped_column(Integer)

    status: Mapped[ServiceRequestStatus] = mapped_column(
        Enum(ServiceRequestStatus, name="service_request_status"),
        default=ServiceRequestStatus.open,
        nullable=False,
        index=True,
    )
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_reason: Mapped[str | None] = mapped_column(Text)

    # Straight-line km between the user and the mechanic at assignment time,
    # frozen here because the mechanic's own coordinates can change later.
    matched_distance_km: Mapped[float | None] = mapped_column(Float)

    user: Mapped["User"] = relationship()
    mechanic: Mapped["Mechanic | None"] = relationship(back_populates="service_requests")

    __table_args__ = (
        Index("ix_service_requests_status_created", "status", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<ServiceRequest {self.reference} status={self.status}>"
