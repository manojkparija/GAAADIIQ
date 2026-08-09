"""WhatsApp delivery for payment receipts and job notifications.

Mirrors the pattern `routers/payments.py` already uses for Razorpay: with no
credentials configured the module runs in dev mode, writing the message row and
marking it sent without any outbound call, so the whole flow is testable offline.

Every send goes through `models.whatsapp_message.WhatsAppMessage` first and is
updated in place afterwards. Writing the row *before* the API call is what makes
the log trustworthy — a crash mid-request leaves a `queued` row to retry, not
silence.

## Template constraint

WhatsApp does not allow arbitrary business-initiated text. Outside a 24-hour
customer-service window, only templates pre-approved by Meta may be sent, which
is why the payload here is a template name plus positional variables rather than
a rendered string. The three templates in `WhatsAppTemplate` need to be submitted
for approval before this works in production; until then production sends will
fail with a template error, and the failure will be visible in `last_error`.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.whatsapp_message import WhatsAppMessage, WhatsAppStatus, WhatsAppTemplate

# Meta rejects anything that is not E.164 digits. Indian numbers arrive from the
# app in half a dozen shapes ("+91 98765 43210", "098765 43210", "9876543210").
INDIA_CC = "91"


def normalise_phone(raw: str) -> str:
    """Reduce a user-entered Indian number to bare E.164 digits (no '+')."""
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) == 10:
        return INDIA_CC + digits
    # A domestic 0-prefixed number: 0 + 10 digits.
    if len(digits) == 11 and digits.startswith("0"):
        return INDIA_CC + digits[1:]
    return digits


def _enabled() -> bool:
    return bool(settings.whatsapp_api_token and settings.whatsapp_phone_number_id)


async def queue_message(
    db: AsyncSession,
    *,
    to_phone: str,
    template: WhatsAppTemplate,
    variables: dict[str, str],
    idempotency_key: str,
    service_request_id: uuid.UUID | None = None,
    payment_id: uuid.UUID | None = None,
) -> WhatsAppMessage:
    """Persist a queued message, or return the existing one for this key.

    The idempotency check is a read before an insert, which races under
    concurrency; the unique index on `idempotency_key` is the real guarantee and
    this is the fast path that avoids relying on an IntegrityError for control
    flow in the common case.
    """
    from sqlalchemy import select

    existing = (
        await db.execute(
            select(WhatsAppMessage).where(WhatsAppMessage.idempotency_key == idempotency_key)
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    msg = WhatsAppMessage(
        to_phone=normalise_phone(to_phone),
        template=template,
        variables=variables,
        idempotency_key=idempotency_key,
        service_request_id=service_request_id,
        payment_id=payment_id,
        provider=settings.whatsapp_provider,
        status=WhatsAppStatus.queued,
    )
    db.add(msg)
    await db.flush()
    return msg


async def send_message(db: AsyncSession, msg: WhatsAppMessage) -> WhatsAppMessage:
    """Attempt delivery and record the outcome on the row.

    Never raises on a provider failure. A receipt that fails to send must not roll
    back the payment that triggered it — the money has already moved, and the row
    carries `last_error` for a retry sweep to pick up.
    """
    if msg.status in (WhatsAppStatus.sent, WhatsAppStatus.delivered, WhatsAppStatus.read):
        return msg

    msg.attempts += 1

    if not _enabled():
        # Dev mode: no credentials, so record what would have gone out.
        msg.status = WhatsAppStatus.sent
        msg.provider_message_id = f"dev_wa_{uuid.uuid4().hex[:12]}"
        msg.sent_at = datetime.now(timezone.utc)
        await db.flush()
        return msg

    url = f"{settings.whatsapp_api_base}/{settings.whatsapp_phone_number_id}/messages"
    payload = {
        "messaging_product": "whatsapp",
        "to": msg.to_phone,
        "type": "template",
        "template": {
            "name": msg.template.value,
            "language": {"code": "en"},
            "components": [
                {
                    "type": "body",
                    # Meta wants positional parameters in order; dict keys are the
                    # 1-based positions the template was registered with.
                    "parameters": [
                        {"type": "text", "text": str(v)}
                        for _, v in sorted((msg.variables or {}).items(), key=lambda kv: int(kv[0]))
                    ],
                }
            ],
        },
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                url,
                json=payload,
                headers={"Authorization": f"Bearer {settings.whatsapp_api_token}"},
            )
        if resp.status_code >= 400:
            msg.status = WhatsAppStatus.failed
            msg.last_error = f"HTTP {resp.status_code}: {resp.text[:400]}"
        else:
            body = resp.json()
            msg.status = WhatsAppStatus.sent
            msg.sent_at = datetime.now(timezone.utc)
            msg.provider_message_id = (body.get("messages") or [{}])[0].get("id")
    except Exception as exc:  # noqa: BLE001 — see docstring: delivery must not break payment
        msg.status = WhatsAppStatus.failed
        msg.last_error = f"{type(exc).__name__}: {exc}"[:400]

    await db.flush()
    return msg


async def send_payment_receipt(
    db: AsyncSession,
    *,
    to_phone: str,
    reference: str,
    amount_paise: int,
    mechanic_name: str,
    car_number: str,
    payment_id: uuid.UUID,
    service_request_id: uuid.UUID,
) -> WhatsAppMessage:
    """Queue and send the receipt for a captured service payment.

    Keyed on the payment id, so replaying the Razorpay webhook — which Razorpay
    does on any ambiguous response — resends nothing.
    """
    variables = {
        "1": reference,
        "2": f"₹{amount_paise / 100:,.2f}",
        "3": mechanic_name,
        "4": car_number,
        "5": datetime.now(timezone.utc).strftime("%d %b %Y"),
    }
    msg = await queue_message(
        db,
        to_phone=to_phone,
        template=WhatsAppTemplate.payment_receipt,
        variables=variables,
        idempotency_key=f"receipt:{payment_id}",
        service_request_id=service_request_id,
        payment_id=payment_id,
    )
    return await send_message(db, msg)
