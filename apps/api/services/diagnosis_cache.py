"""Cache for diagnosis answers: the same question twice should cost once.

WHAT IS CACHED, AND WHAT IS NOT

Only the *answer dict*, keyed by the normalised question plus the vehicle it was
asked about. Two drivers with the same car and the same complaint get the same
answer, so computing it twice is waste — and when the answer came from Gemini,
that waste is billed.

Three things are never cached, each for its own reason:

  * **Safety-critical findings.** A cached "your brakes may fail" is a copy of a
    row that a reviewer may since have corrected or retracted. Everything else
    can tolerate five minutes of staleness; this cannot, so it is always read
    live from the knowledge base.
  * **Anything with an uploaded photo.** The image is part of the question and
    is not in the key. Caching on the text alone would hand one driver another
    driver's photo-derived answer.
  * **Heuristic fallbacks.** They are what we return when nothing worked;
    storing one would pin a degraded answer in place for the whole TTL, long
    after the model recovered.

WHY THE KEY CARRIES THE VEHICLE

"Loud knocking on startup" on a 2012 diesel and a 2022 petrol are different
faults. Keying on the complaint alone would serve one car's diagnosis for
another, and the mistake would be invisible — a plausible answer, for the wrong
engine.

REDIS, WITH THE SAME HONEST FALLBACK AS THE OTP STORE

`using_redis()` reports which store is live. The in-process dict is per-worker,
so on Render it means a lower hit rate rather than a wrong answer — an
acceptable degradation for a cache, unlike for the OTP store where it was a
correctness bug.
"""

from __future__ import annotations

import hashlib
import json
import logging

from core.config import settings

logger = logging.getLogger("gaadiiq.diagnosis_cache")

# Long enough to absorb a burst of identical questions, short enough that an
# edit to a KB row reaches drivers the same day without a manual flush.
TTL_SECONDS = 6 * 60 * 60

# A cap for the in-process fallback only. Redis has its own eviction policy;
# this exists so a single worker cannot grow unbounded on a long-lived dyno.
MAX_MEMORY_ENTRIES = 500

_memory: dict[str, str] = {}
_redis = None
_redis_checked = False

_stats = {"hits": 0, "misses": 0, "stores": 0, "skips": 0}


def _get_redis():
    global _redis, _redis_checked
    if _redis_checked:
        return _redis
    _redis_checked = True
    try:
        import redis.asyncio as aioredis

        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    except Exception as exc:
        logger.info("Diagnosis cache: Redis unavailable (%s); using in-process fallback", exc)
        _redis = None
    return _redis


def using_redis() -> bool:
    return _get_redis() is not None


def stats() -> dict:
    """Counters for the admin view. A hit rate near zero means the key is wrong."""
    total = _stats["hits"] + _stats["misses"]
    return {
        **_stats,
        "hit_rate": round(_stats["hits"] / total, 3) if total else 0.0,
        "backend": "redis" if using_redis() else "memory",
    }


def build_key(
    *,
    normalised_question: str,
    manufacturer: str | None,
    model: str | None,
    model_year: int | None,
    fuel_type: str | None,
    language: str = "en-IN",
) -> str:
    """A stable key. Hashed because a symptom description is user text, and user
    text in a Redis key is both unbounded and awkward to read in logs."""
    raw = "|".join(
        [
            normalised_question,
            (manufacturer or "").strip().lower(),
            (model or "").strip().lower(),
            str(model_year or ""),
            (fuel_type or "").strip().lower(),
            language,
        ]
    )
    return "dx:" + hashlib.sha256(raw.encode()).hexdigest()[:40]


def is_cacheable(result: dict, *, has_images: bool) -> bool:
    """Whether this answer may be stored. See the module docstring for the why."""
    if has_images:
        return False
    engine = result.get("engine")
    if engine in (None, "heuristic"):
        return False
    if result.get("safety_critical") or result.get("risk_level") in ("Critical",):
        return False
    if result.get("immediate_service_required"):
        return False
    return True


async def get(key: str) -> dict | None:
    r = _get_redis()
    if r is not None:
        try:
            raw = await r.get(key)
            if raw:
                _stats["hits"] += 1
                return json.loads(raw)
            _stats["misses"] += 1
            return None
        except Exception as exc:
            logger.info("Diagnosis cache: Redis read failed (%s); using fallback", exc)

    raw = _memory.get(key)
    if raw:
        _stats["hits"] += 1
        return json.loads(raw)
    _stats["misses"] += 1
    return None


async def put(key: str, result: dict) -> None:
    """Store an answer. A cache write must never fail a request, so every error
    here is swallowed after logging — the caller already has its answer."""
    try:
        payload = json.dumps(result, default=str)
    except Exception:
        _stats["skips"] += 1
        return

    r = _get_redis()
    if r is not None:
        try:
            await r.setex(key, TTL_SECONDS, payload)
            _stats["stores"] += 1
            return
        except Exception as exc:
            logger.info("Diagnosis cache: Redis write failed (%s); using fallback", exc)

    if len(_memory) >= MAX_MEMORY_ENTRIES:
        # Crude, but the fallback is not the production path and an LRU here
        # would be more machinery than the situation earns.
        _memory.clear()
    _memory[key] = payload
    _stats["stores"] += 1


async def invalidate_all() -> int:
    """Drop every cached answer. Called after a knowledge-base import.

    An import can change what a verified row says, and a cached copy of the old
    text would outlive the correction by up to the TTL. Returns how many
    in-process entries were dropped; Redis keys are removed by pattern.
    """
    dropped = len(_memory)
    _memory.clear()
    r = _get_redis()
    if r is not None:
        try:
            async for k in r.scan_iter(match="dx:*", count=500):
                await r.delete(k)
        except Exception as exc:
            logger.warning("Diagnosis cache: could not clear Redis keys: %s", exc)
    return dropped


def _reset_for_tests() -> None:
    global _redis, _redis_checked
    _memory.clear()
    _redis = None
    _redis_checked = False
    for k in _stats:
        _stats[k] = 0
