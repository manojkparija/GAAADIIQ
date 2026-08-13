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

    # --- Start OTP ----------------------------------------------------------
    # Proof that the mechanic physically reached the customer. Generated when
    # the job is raised, shown only to the customer, and collected verbally by
    # the mechanic on arrival.
    #
    # The hash is stored, never the code. A six-digit number is not a password,
    # but the row is readable by anything that can read the table, and a stored
    # plaintext OTP means a database read is indistinguishable from having
    # turned up — which is the single thing this mechanism exists to prove.
    start_otp_hash: Mapped[str | None] = mapped_column(String(64))
    start_otp_issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    start_otp_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    start_otp_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # --- Dispatch -----------------------------------------------------------
    # Set when the request is broadcast. Frozen rather than recomputed, so the
    # audit answers "who was actually offered this job" and not "who would be
    # offered it if we asked again now".
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dispatch_radius_km: Mapped[float | None] = mapped_column(Float)
    dispatch_offer_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    user: Mapped["User"] = relationship()
    mechanic: Mapped["Mechanic | None"] = relationship(back_populates="service_requests")

    __table_args__ = (
        Index("ix_service_requests_status_created", "status", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<ServiceRequest {self.reference} status={self.status}>"


class ServiceOfferStatus(str, enum.Enum):
    """What became of one mechanic's copy of a broadcast."""

    offered = "offered"      # sent, awaiting a response
    accepted = "accepted"    # this mechanic won the job
    declined = "declined"    # explicitly turned down
    expired = "expired"      # the window closed with no answer
    lost = "lost"            # someone else accepted first


class ServiceRequestOffer(UUIDMixin, TimestampMixin, Base):
    """One mechanic's copy of a broadcast job.

    A row per (request, mechanic) rather than a list column on the request, for
    two reasons. Acceptance has to be race-safe — two mechanics tapping at the
    same moment must not both win — and a unique constraint plus a conditional
    UPDATE gives that for free, where a JSON list gives a lost update.

    The second reason is that this is the only record of who was asked. A
    mechanic who complains they never see work, or a customer disputing how long
    help took, is answered from these rows. Recomputing the radius later would
    answer a different question, because mechanics move and go offline.
    """

    __tablename__ = "service_request_offers"

    request_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("service_requests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    mechanic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("mechanics.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    status: Mapped[ServiceOfferStatus] = mapped_column(
        Enum(ServiceOfferStatus, name="service_offer_status"),
        default=ServiceOfferStatus.offered,
        nullable=False,
        index=True,
    )

    # Distance at the moment of the broadcast, not now. The mechanic who was
    # 800 m away when offered the job may be 6 km away by the time anyone reads
    # this row, and the question being asked is always "was it fair to offer".
    distance_km: Mapped[float] = mapped_column(Float, nullable=False)

    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    request: Mapped["ServiceRequest"] = relationship()
    mechanic: Mapped["Mechanic"] = relationship()

    __table_args__ = (
        # One offer per mechanic per job. Also the lock that makes a
        # double-accept impossible rather than merely unlikely.
        Index("uq_service_offer_request_mechanic", "request_id", "mechanic_id", unique=True),
        Index("ix_service_offers_mechanic_status", "mechanic_id", "status"),
    )

    def __repr__(self) -> str:
        return f"<ServiceRequestOffer request={self.request_id} status={self.status}>"
