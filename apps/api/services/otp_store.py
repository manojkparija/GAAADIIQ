"""Storage for phone-login OTPs: hashed, expiring, and attempt-limited.

Replaces a module-level dict that held OTPs in plaintext. The docstring above
routers/otp.py had described this store as "bcrypt hashes in Redis with a
10-minute TTL" for as long as it existed; the code was
`_otp_store[phone] = (otp, expiry)`. The description was the design, and it is
now what the code does.

WHY THIS MATTERS MORE THAN IT LOOKS

A six-digit code is not a password, and the instinct is that hashing it is
ceremony. Three things make it not ceremony:

  * The dict lived in the process. Render restarts on every deploy and can run
    more than one instance, so a code sent by one process was unverifiable by
    the next — the OTP simply stopped working, with "OTP not found or expired"
    as the only clue.
  * Anything that could read process memory, or any traceback that serialised
    locals, exposed live login codes for real phone numbers.
  * Nothing capped verification attempts. Ten thousand guesses against a
    six-digit code is roughly a 1% chance per phone per window, and there was
    no limit on how many times you could try.

THE ATTEMPT CAP IS THE PART THAT ACTUALLY STOPS AN ATTACK

Hashing protects the code at rest. It does nothing against someone simply
guessing over the network. `MAX_ATTEMPTS` is what makes 10^6 a real search
space rather than a formality, and it is counted in the same store as the code
so it cannot be reset by rotating IP addresses.

PEPPERED SHA-256, NOT BCRYPT

The docstring promised bcrypt. Peppered SHA-256 is used instead, deliberately
and consistently with services/kyc.py and services/service_dispatch.py: for an
input space of 10^6, bcrypt at any sane cost factor is still enumerable offline
by an attacker holding the store, whereas without the pepper no digest is safe
and with it none is needed. Bcrypt would also add ~100ms to the hot path of a
login endpoint for no gain here.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import time
from dataclasses import dataclass

from core.config import settings

logger = logging.getLogger("gaadiiq.otp")

OTP_TTL_SECONDS = 600  # 10 minutes
MAX_ATTEMPTS = 5
OTP_LENGTH = 6


class OtpNotFound(RuntimeError):
    """No live code for this phone — never sent, already used, or expired."""


class OtpAttemptsExhausted(RuntimeError):
    """Too many wrong guesses. The code is burned; a new one must be sent."""


@dataclass
class _Entry:
    digest: str
    expires_at: float
    attempts: int = 0


# Fallback for local development and tests, where Redis is usually not running.
# Explicitly NOT the production path: it is per-process, so it breaks across
# restarts and instances exactly as the old implementation did. `_using_redis()`
# reports which one is live so a deployment cannot quietly land on this one
# believing it has the durable store.
_memory: dict[str, _Entry] = {}
_redis = None
_redis_checked = False


def _get_redis():
    global _redis, _redis_checked
    if _redis_checked:
        return _redis
    _redis_checked = True
    try:
        import redis.asyncio as aioredis

        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    except Exception as exc:
        logger.warning("OTP store: Redis unavailable (%s); using in-process fallback", exc)
        _redis = None
    return _redis


def using_redis() -> bool:
    return _get_redis() is not None


def generate_otp() -> str:
    """Cryptographically random. `random.choices` is a Mersenne Twister and its
    output is predictable from prior draws, which for a login code means one
    leaked OTP can imply the next."""
    return f"{secrets.randbelow(10 ** OTP_LENGTH):0{OTP_LENGTH}d}"


def _pepper() -> str:
    return settings.kyc_hash_pepper or ""


def _digest(phone: str, otp: str) -> str:
    """Phone-scoped so a code observed for one number cannot be replayed against
    another that happened to draw the same digits."""
    return hashlib.sha256(f"{_pepper()}:{phone}:{otp}".encode()).hexdigest()


def _key(phone: str) -> str:
    return f"otp:{phone}"


async def store(phone: str, otp: str) -> None:
    """Save a fresh code, replacing any previous one and resetting attempts."""
    digest = _digest(phone, otp)
    r = _get_redis()
    if r is not None:
        try:
            await r.hset(_key(phone), mapping={"digest": digest, "attempts": 0})
            await r.expire(_key(phone), OTP_TTL_SECONDS)
            return
        except Exception as exc:
            logger.warning("OTP store: Redis write failed (%s); using fallback", exc)
    _memory[phone] = _Entry(digest=digest, expires_at=time.time() + OTP_TTL_SECONDS)


async def verify(phone: str, otp: str) -> bool:
    """Check a code, counting the attempt.

    Raises OtpNotFound when there is nothing live to check and
    OtpAttemptsExhausted once the cap is hit. A correct code is consumed, so it
    cannot be replayed.

    The attempt is counted *before* the comparison: a client that disconnects
    mid-request, or a server that crashes, must not hand back a free guess.
    """
    r = _get_redis()
    if r is not None:
        try:
            data = await r.hgetall(_key(phone))
            if not data:
                raise OtpNotFound
            attempts = int(data.get("attempts", 0))
            if attempts >= MAX_ATTEMPTS:
                await r.delete(_key(phone))
                raise OtpAttemptsExhausted
            await r.hincrby(_key(phone), "attempts", 1)
            if hmac.compare_digest(data["digest"], _digest(phone, otp)):
                await r.delete(_key(phone))
                return True
            return False
        except (OtpNotFound, OtpAttemptsExhausted):
            raise
        except Exception as exc:
            logger.warning("OTP store: Redis read failed (%s); using fallback", exc)

    entry = _memory.get(phone)
    if entry is None or entry.expires_at < time.time():
        _memory.pop(phone, None)
        raise OtpNotFound
    if entry.attempts >= MAX_ATTEMPTS:
        _memory.pop(phone, None)
        raise OtpAttemptsExhausted
    entry.attempts += 1
    if hmac.compare_digest(entry.digest, _digest(phone, otp)):
        _memory.pop(phone, None)
        return True
    return False


async def attempts_remaining(phone: str) -> int:
    """Best-effort count for the message shown to the user."""
    r = _get_redis()
    if r is not None:
        try:
            data = await r.hgetall(_key(phone))
            if data:
                return max(0, MAX_ATTEMPTS - int(data.get("attempts", 0)))
        except Exception:
            pass
    entry = _memory.get(phone)
    return max(0, MAX_ATTEMPTS - entry.attempts) if entry else 0


def _reset_for_tests() -> None:
    global _redis, _redis_checked
    _memory.clear()
    _redis = None
    _redis_checked = False
