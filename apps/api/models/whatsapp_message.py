"""Outbound WhatsApp delivery log.

Receipts go out over a third-party API that can fail, retry, deliver late, or
deliver twice. None of that is visible from the `payments` table, so every send
attempt gets a row here.

Two things this buys us:

  * **Idempotency.** `idempotency_key` is unique, so a webhook replay or a double
    tap on "resend receipt" cannot bill the WhatsApp account twice for the same
    receipt.
  * **An answer to "did the customer get it?"** Provider status arrives
    asynchronously via webhook (`sent` → `delivered` → `read`), and support needs
    that trail when someone says the receipt never arrived.

The message body is not stored — only the template name and its variables. The
rendered text is reconstructible from those, and keeping payloads out of the log
means a receipt containing a phone number and an amount is not duplicated into a
second table with a different retention policy.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from .service_request import ServiceRequest


class WhatsAppTemplate(str, enum.Enum):
    """Template names as registered with the provider.

    WhatsApp only allows business-initiated messages from pre-approved templates,
    so these are not free text — each maps to a template awaiting or holding Meta
    approval.
    """

    payment_receipt = "payment_receipt"
    mechanic_assigned = "mechanic_assigned"
    service_request_raised = "service_request_raised"


class WhatsAppStatus(str, enum.Enum):
    queued = "queued"
    sent = "sent"
    delivered = "delivered"
    read = "read"
    failed = "failed"


class WhatsAppMessage(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "whatsapp_messages"

    # E.164 without the leading '+' (what every Indian provider expects on the wire).
    to_phone: Mapped[str] = mapped_column(String(15), nullable=False, index=True)
    template: Mapped[WhatsAppTemplate] = mapped_column(
        Enum(WhatsAppTemplate, name="whatsapp_template"), nullable=False
    )
    # Ordered template substitutions: {"1": "SR-7F3A21", "2": "₹2,400", ...}
    variables: Mapped[dict | None] = mapped_column(JSON)

    service_request_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("service_requests.id", ondelete="SET NULL"), nullable=True, index=True
    )
    payment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("payments.id", ondelete="SET NULL"), nullable=True, index=True
    )

    status: Mapped[WhatsAppStatus] = mapped_column(
        Enum(WhatsAppStatus, name="whatsapp_status"),
        default=WhatsAppStatus.queued,
        nullable=False,
        index=True,
    )
    # Provider's own id, needed to correlate the delivery webhook back to this row.
    provider: Mapped[str] = mapped_column(String(30), default="meta_cloud", nullable=False)
    provider_message_id: Mapped[str | None] = mapped_column(String(120), index=True)

    # Unique, so a replayed webhook or a double-tapped resend is a no-op.
    idempotency_key: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)

    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    service_request: Mapped["ServiceRequest | None"] = relationship()

    __table_args__ = (
        Index("ix_whatsapp_messages_status_created", "status", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<WhatsAppMessage to={self.to_phone} template={self.template} status={self.status}>"
