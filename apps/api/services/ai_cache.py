"""
A Redis cache for answers that cost a billed model call to produce.

## What belongs here

Only results that are a pure function of their inputs and are asked for
repeatedly. A resale forecast for a 2021 Swift VXi at ₹6L is the same answer
whoever asks and however often, and every miss is an invoice.

## What does not, and why it matters more than what does

Three things were considered for this module and deliberately left out. They
read as obvious cache candidates and each would be a correctness bug:

  * **POST /recommend.** Its docstring is explicit — "No AI / LLM — results
    grounded entirely in DB listing data" — and it is nudged by what the
    signed-in buyer has been looking at. Caching by payload would serve one
    person's personalised ordering to another, and would go on offering cars
    that have since sold.
  * **Qdrant search results.** Same reason: they describe live inventory. A
    stale result set is worse than a slow one.
  * **Embeddings.** They looked like the obvious win and are not:
    services/embeddings.py runs BGE locally through fastembed, so a miss costs
    local CPU on a 384-dimension model rather than money. Putting that behind
    Redis adds a network round trip to save an operation the round trip may
    well outlast. An in-process lru_cache is the right shape there, and that is
    where it lives.

The rule those three share: cache what is expensive AND unchanging. Something
merely slow, personalised, or describing live data does not qualify.

## Safety carried over from diagnosis_cache

That module already made these calls and they hold here:

  * a cache write must never fail the request — the caller already has its
    answer, and failing it because Redis was unreachable would be the wrong
    end of the stick;
  * an unusable result is not stored, so a fallback never gets frozen in as
    though it were the real thing;
  * Redis is optional. Without it this degrades to an in-process dict, and
    without that it simply always misses. No caller behaviour changes.

## Why this is not diagnosis_cache with a parameter

It nearly is, and unifying them was the first instinct. diagnosis_cache
carries rules this one must not inherit — it refuses to store safety-critical
findings, because a cached "your brakes may fail" is a copy of a row a
reviewer may since have retracted. Merging the two would put that judgement
behind a flag, and a safety rule behind a flag is a safety rule waiting to be
passed the wrong argument. The shared part is forty lines of Redis handling;
the unshared part is the reason that module exists.
"""
from __future__ import annotations

import hashlib
import json
import logging

from core.config import settings

logger = logging.getLogger("gaadiiq.ai_cache")

#: A day. These answers are projections and research, not live facts — a
#: forecast does not change hour to hour — and the window is what keeps the
#: saving real. Shorter would spend money to cache nothing.
TTL_SECONDS = 24 * 60 * 60

#: The in-process fallback only; Redis has its own eviction. Bounded so one
#: long-lived worker cannot grow without limit.
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
        logger.info("AI cache: Redis unavailable (%s); using in-process fallback", exc)
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


def build_key(namespace: str, **parts) -> str:
    """
    A stable key for one question.

    Sorted by field name so two callers passing the same values in a different
    order share a key rather than paying twice for the same answer. Hashed
    because some values are free text, which is unbounded and awkward in logs;
    the namespace stays readable so keys can be found and dropped by prefix.
    """
    raw = "|".join(f"{k}={str(parts[k]).strip().lower()}" for k in sorted(parts))
    return f"{namespace}:" + hashlib.sha256(raw.encode()).hexdigest()[:40]


async def get(key: str) -> dict | list | None:
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
            logger.info("AI cache: Redis read failed (%s); using fallback", exc)

    raw = _memory.get(key)
    if raw:
        _stats["hits"] += 1
        return json.loads(raw)
    _stats["misses"] += 1
    return None


async def put(key: str, value: dict | list) -> None:
    """Store an answer. Never raises: the caller already has what it needs."""
    try:
        payload = json.dumps(value, default=str)
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
            logger.info("AI cache: Redis write failed (%s); using fallback", exc)

    if len(_memory) >= MAX_MEMORY_ENTRIES:
        # Crude, but the fallback is not the production path and an LRU here
        # would be more machinery than the situation earns.
        _memory.clear()
    _memory[key] = payload
    _stats["stores"] += 1


async def invalidate(namespace: str) -> int:
    """Drop one namespace. Returns how many in-process entries went."""
    prefix = f"{namespace}:"
    dropped = len([k for k in _memory if k.startswith(prefix)])
    for k in [k for k in _memory if k.startswith(prefix)]:
        del _memory[k]

    r = _get_redis()
    if r is not None:
        try:
            async for k in r.scan_iter(match=f"{prefix}*", count=500):
                await r.delete(k)
        except Exception as exc:
            logger.warning("AI cache: could not clear %s keys: %s", namespace, exc)
    return dropped


def _reset_for_tests() -> None:
    global _redis, _redis_checked
    _memory.clear()
    _redis = None
    _redis_checked = False
    for k in _stats:
        _stats[k] = 0
