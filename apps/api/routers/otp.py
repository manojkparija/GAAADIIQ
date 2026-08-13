"""
OTP / Phone authentication — MOB-009.

POST /auth/otp/send   — send a 6-digit OTP to the given phone number via SMS
POST /auth/otp/verify — verify OTP and return JWT tokens

Implementation notes:
- SMS is sent via MSG91 (India) when MSG91_AUTH_KEY is set in env.
- Falls back to printing OTP to server log in development (never in production).
- OTPs are stored hashed (peppered SHA-256) in Redis with a 10-minute TTL,
  falling back to an in-process map only when Redis is unreachable. See
  services/otp_store.py — including why that fallback is not a production path.
- Verification is capped at 5 attempts per code, counted in the store rather
  than by IP, so guesses cannot be reset by changing address.
- Send is additionally rate-limited by the shared limiter, which keys on client
  IP (core/limiter.py). That is a blunt instrument for this endpoint: it does
  not stop one client walking a list of phone numbers, and it does not stop a
  distributed client hammering one number. The per-code attempt cap above is
  what actually bounds an attack; this only bounds SMS spend.
"""
# NOTE: deliberately NOT using `from __future__ import annotations`.
# PEP 563 turns annotations into strings, and slowapi's @limiter.limit wrapper
# leaves FastAPI unable to resolve them — it then treats the Pydantic body and
# the DB dependency as query parameters, so every request 422s.

import logging
import os

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from core.config import settings
from core.limiter import limiter
from services import otp_store

logger = logging.getLogger("gaadiiq.otp")

router = APIRouter(prefix="/auth/otp", tags=["auth"])

async def _send_sms(phone: str, otp: str) -> None:
    """Send OTP via MSG91 if configured; log in dev mode."""
    msg91_key = os.environ.get("MSG91_AUTH_KEY", "")
    if msg91_key and settings.is_production:
        import httpx
        payload = {
            "template_id": os.environ.get("MSG91_TEMPLATE_ID", ""),
            "mobile": phone.lstrip("+"),
            "authkey": msg91_key,
            "otp": otp,
        }
        async with httpx.AsyncClient() as client:
            resp = await client.post("https://api.msg91.com/api/v5/otp", json=payload, timeout=10)
            resp.raise_for_status()
    else:
        # Dev: log the OTP — NEVER do this in production
        if settings.is_production:
            raise RuntimeError("MSG91_AUTH_KEY not set in production")
        logger.warning("[DEV ONLY] OTP for %s: %s", phone, otp)


class SendOTPIn(BaseModel):
    phone: str = Field(..., pattern=r"^\+91[6-9]\d{9}$", description="Indian mobile number (+91XXXXXXXXXX)")


class VerifyOTPIn(BaseModel):
    phone: str = Field(..., pattern=r"^\+91[6-9]\d{9}$")
    otp: str = Field(..., min_length=6, max_length=6)


@router.post("/send", status_code=status.HTTP_200_OK)
@limiter.limit("5/hour")
async def send_otp(request: Request, body: SendOTPIn):
    """Send a 6-digit OTP to the given phone number."""
    otp = otp_store.generate_otp()
    await otp_store.store(body.phone, otp)
    await _send_sms(body.phone, otp)
    return {"message": "OTP sent"}


@router.post("/verify", status_code=status.HTTP_200_OK)
@limiter.limit("20/hour")
async def verify_otp(request: Request, body: VerifyOTPIn):
    """Verify the OTP and return a success flag (caller should then issue JWT).

    Both limits matter and neither replaces the other: the decorator bounds how
    fast one address can guess, and the store's own attempt cap bounds how many
    guesses a code will ever accept, from anywhere. Before this, there was no
    cap of either kind on a six-digit secret.
    """
    try:
        ok = await otp_store.verify(body.phone, body.otp)
    except otp_store.OtpNotFound:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "OTP not found or expired — request a new one"
        ) from None
    except otp_store.OtpAttemptsExhausted:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many incorrect attempts — request a new OTP",
        ) from None

    if not ok:
        remaining = await otp_store.attempts_remaining(body.phone)
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, f"Invalid OTP. {remaining} attempt(s) remaining."
        )
    return {"verified": True, "phone": body.phone}
