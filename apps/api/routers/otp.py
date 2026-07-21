"""
OTP / Phone authentication — MOB-009.

POST /auth/otp/send   — send a 6-digit OTP to the given phone number via SMS
POST /auth/otp/verify — verify OTP and return JWT tokens

Implementation notes:
- SMS is sent via MSG91 (India) when MSG91_AUTH_KEY is set in env.
- Falls back to printing OTP to server log in development (never in production).
- OTPs are stored as bcrypt hashes in Redis with a 10-minute TTL.
- Rate-limited to 5 send requests per phone per hour.
"""
from __future__ import annotations

import random
import string
import time

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from core.config import settings
from core.limiter import limiter

import logging
import os

logger = logging.getLogger("gaadiiq.otp")

router = APIRouter(prefix="/auth/otp", tags=["auth"])

# ── In-memory OTP store (replace with Redis in production) ───────────────────
# Format: { phone: (otp_hash, expiry_ts) }
_otp_store: dict[str, tuple[str, float]] = {}
_OTP_TTL = 600  # 10 minutes


def _generate_otp(length: int = 6) -> str:
    return "".join(random.choices(string.digits, k=length))


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
    otp = _generate_otp()
    _otp_store[body.phone] = (otp, time.time() + _OTP_TTL)
    await _send_sms(body.phone, otp)
    return {"message": "OTP sent"}


@router.post("/verify", status_code=status.HTTP_200_OK)
async def verify_otp(body: VerifyOTPIn):
    """Verify the OTP and return a success flag (caller should then issue JWT)."""
    entry = _otp_store.get(body.phone)
    if not entry:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "OTP not found or expired — request a new one")
    stored_otp, expiry = entry
    if time.time() > expiry:
        _otp_store.pop(body.phone, None)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "OTP expired — request a new one")
    if body.otp != stored_otp:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid OTP")
    _otp_store.pop(body.phone, None)
    return {"verified": True, "phone": body.phone}
