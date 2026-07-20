"""
n8n workflow automation triggers.
Fire-and-forget: never raises, just logs on failure.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from core.config import settings

logger = logging.getLogger("gaadiiq.n8n")

# Supported event names (used as routing keys inside n8n)
LISTING_CREATED   = "listing_created"
LISTING_VALUATED  = "listing_valuated"
DIAGNOSIS_SUBMITTED = "diagnosis_submitted"
USER_REGISTERED   = "user_registered"
PRICE_ALERT_HIT   = "price_alert_hit"
TEST_DRIVE_BOOKED = "test_drive_booked"
LEAD_HOT          = "lead_hot"          # user viewed listing 3+ times


async def trigger(event: str, payload: dict[str, Any]) -> bool:
    """
    POST event + payload to the n8n webhook URL.
    Returns True on success, False if n8n is unconfigured or unreachable.
    """
    if not settings.n8n_webhook_url:
        logger.debug("n8n not configured — skipping event '%s'", event)
        return False

    body = {"event": event, "data": payload}
    headers = {"Content-Type": "application/json"}
    if settings.n8n_secret:
        headers["X-N8N-Secret"] = settings.n8n_secret

    try:
        async with httpx.AsyncClient(timeout=5.0) as http:
            resp = await http.post(settings.n8n_webhook_url, json=body, headers=headers)
            resp.raise_for_status()
            logger.info("n8n '%s' triggered (HTTP %d)", event, resp.status_code)
            return True
    except Exception as exc:
        logger.warning("n8n trigger '%s' failed (non-blocking): %s", event, exc)
        return False
