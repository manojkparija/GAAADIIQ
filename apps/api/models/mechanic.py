"""Mechanic registry — the supply side of the roadside repair marketplace.

A mechanic registers once, is verified by an admin, and then becomes eligible to
be matched against service requests raised from the AI Diagnosis flow.

## A note on the Aadhaar column

The product requirement is that Aadhaar is mandatory: no Aadhaar, no registration.
That requirement is honoured — `register_mechanic` rejects a payload without one.
What is deliberately NOT done is keeping the number itself.

Section 29(4) of the Aadhaar Act and the UIDAI Aadhaar Data Vault circulars make a
private entity storing raw Aadhaar numbers in its own business database an offence,
so the number is verified at the door and then reduced to two columns:

  * `aadhaar_last4`  — the display fragment ("XXXX XXXX 1234"), which is what a
    support agent or the mechanic themselves needs to confirm identity.
  * `aadhaar_hash`   — SHA-256 over the digits with a server-side pepper. It is a
    one-way lookup key, so duplicate registrations are still detectable, but the
    number cannot be recovered from the database if it leaks.

If the business later needs the real number back (for an income-tax filing, say),
the correct move is a dedicated Aadhaar Data Vault keyed by a reference id — not a
column here. `aadhaar_vault_ref` is reserved for exactly that.
"""

from __future__ import annotations

import enum
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, Enum, Float, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from .service_request import ServiceRequest
    from .user import User


class MechanicStatus(str, enum.Enum):
    """Where a mechanic sits in the onboarding funnel.

    Only `active` is matchable. `pending_verification` is the state straight after
    registration — the KYC fields are present but nobody has checked them yet.
    """

    pending_verification = "pending_verification"
    active = "active"
    suspended = "suspended"
    rejected = "rejected"


class MechanicSpecialisation(str, enum.Enum):
    general = "general"
    engine = "engine"
    electrical = "electrical"
    transmission = "transmission"
    ac = "ac"
    bodywork = "bodywork"
    tyres = "tyres"
    ev = "ev"


class Mechanic(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "mechanics"

    # Optional login. A mechanic can be onboarded by an ops agent before they ever
    # sign in, so this is nullable rather than the identity of the row.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # --- Identity -----------------------------------------------------------
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    shop_name: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str] = mapped_column(String(15), nullable=False, unique=True, index=True)
    # Separate from `phone` because the number that receives WhatsApp receipts is
    # not always the number printed on the shop board.
    whatsapp_phone: Mapped[str | None] = mapped_column(String(15))
    email: Mapped[str | None] = mapped_column(String(255))

    # --- Address ------------------------------------------------------------
    address_line1: Mapped[str] = mapped_column(String(255), nullable=False)
    address_line2: Mapped[str | None] = mapped_column(String(255))
    city: Mapped[str] = mapped_column(String(100), nullable=False)
    state: Mapped[str] = mapped_column(String(100), nullable=False)
    area_pincode: Mapped[str] = mapped_column(String(6), nullable=False, index=True)

    # --- Location -----------------------------------------------------------
    # Plain floats rather than PostGIS: the matching radius is tens of kilometres,
    # where haversine on a bounding box is accurate enough and keeps SQLite (used
    # by the test suite) working without an extension.
    latitude: Mapped[float | None] = mapped_column(Float, index=True)
    longitude: Mapped[float | None] = mapped_column(Float, index=True)
    service_radius_km: Mapped[int] = mapped_column(Integer, default=15, nullable=False)

    # --- KYC ----------------------------------------------------------------
    # Both are mandatory at registration; see the module docstring for why the
    # Aadhaar number itself is not among these columns.
    pan_number: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    aadhaar_last4: Mapped[str] = mapped_column(String(4), nullable=False)
    aadhaar_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    aadhaar_vault_ref: Mapped[str | None] = mapped_column(String(64))

    # --- Payout -------------------------------------------------------------
    # The UPI id the customer's "scan to pay" QR resolves to. The QR itself is
    # generated per service request, not stored, so a rotated VPA takes effect
    # immediately rather than leaving stale codes in circulation.
    upi_vpa: Mapped[str | None] = mapped_column(String(120))
    bank_account_last4: Mapped[str | None] = mapped_column(String(4))
    bank_ifsc: Mapped[str | None] = mapped_column(String(11))

    # --- Marketplace state --------------------------------------------------
    status: Mapped[MechanicStatus] = mapped_column(
        Enum(MechanicStatus, name="mechanic_status"),
        default=MechanicStatus.pending_verification,
        nullable=False,
        index=True,
    )
    # JSON rather than a PG array so the SQLite-backed test suite behaves the same.
    specialisations: Mapped[list | None] = mapped_column(JSON)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    rating: Mapped[float | None] = mapped_column(Numeric(3, 2))
    jobs_completed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    verified_at: Mapped[str | None] = mapped_column(String(40))
    rejection_reason: Mapped[str | None] = mapped_column(Text)

    user: Mapped["User | None"] = relationship()
    service_requests: Mapped[list["ServiceRequest"]] = relationship(back_populates="mechanic")

    __table_args__ = (
        # Nearest-mechanic queries always filter on these three together.
        Index("ix_mechanics_status_lat_lng", "status", "latitude", "longitude"),
    )

    def __repr__(self) -> str:
        return f"<Mechanic id={self.id} name={self.full_name} status={self.status}>"
