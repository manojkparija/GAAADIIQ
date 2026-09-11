"""
One place that decides whether Redis is actually there.

## The trap this exists to close

`settings.redis_url` defaults to `redis://localhost:6379`, and redis-py
connects lazily. So on a deployment with no Redis — which is this one, today —
nothing fails at startup. `from_url` succeeds, the client is not None, and the
connection is attempted on the FIRST OPERATION and every operation after it.

core/limiter.py has the scar:

    slowapi connects lazily — so on a deployment with no Redis, the failure
    surfaced not at startup but on the first rate-limited request, as a
    ConnectionError escaping the decorator and becoming a 500. Every
    rate-limited endpoint was returning "Internal Server Error" while the
    service reported itself healthy.

It fixed that for itself with a `ping()` at import. The caches each grew their
own `_get_redis()` that checks whether the CLIENT was constructed, which is not
the same question — construction always succeeds. They therefore degrade
correctly but expensively: a refused connection per call, and a log line per
call, on paths that run on every catalogue read.

## What this does instead

Probes with a real `PING` on a short timeout, remembers the answer, and hands
back None when Redis is not there so callers go straight to their fallback
with no network attempt at all.

The answer is re-probed every PROBE_INTERVAL_SECONDS rather than decided once
for the life of the process. A permanent decision is wrong in both directions:
Redis added to the environment later would never be picked up until a deploy,
and a Redis that blips would be abandoned for good. A minute of using the
fallback after a change either way is a fair price for not asking on every
request.

## What it deliberately does not do

It does not fail a request, ever. Every caller here has a working fallback —
an in-process dict — and a cache that cannot be reached is a slower service,
not a broken one. That is why `client()` returns None rather than raising.
"""
from __future__ import annotations

import time

from core.config import settings

#: How long an answer is trusted before asking again. Short enough that Redis
#: appearing (or recovering) is picked up without a deploy, long enough that
#: the probe is not itself per-request traffic.
PROBE_INTERVAL_SECONDS = 60.0

#: A PING to a reachable Redis is sub-millisecond; to an absent one this is how
#: long a request would wait. Kept to a second because this runs in the request
#: path and the fallback is immediate.
CONNECT_TIMEOUT_SECONDS = 1.0

#: label -> (checked_at, client or None)
_state: dict[str, tuple[float, object | None]] = {}


async def client(label: str, logger):
    """
    A live Redis client, or None when Redis is not reachable.

    `label` separates callers so one cache's failure is logged once for that
    cache rather than attributed to another.
    """
    now = time.monotonic()
    cached = _state.get(label)
    if cached is not None:
        checked_at, existing = cached
        if now - checked_at < PROBE_INTERVAL_SECONDS:
            return existing

    try:
        import redis.asyncio as aioredis

        candidate = aioredis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=CONNECT_TIMEOUT_SECONDS,
            socket_timeout=CONNECT_TIMEOUT_SECONDS,
        )
        # The whole point: a real round trip. Constructing the client proves
        # nothing, which is how this failure mode survived for so long.
        await candidate.ping()
    except Exception as exc:
        if cached is None or cached[1] is not None:
            # Log on the transition only. Without this it is one line per
            # request on an API with no Redis configured.
            logger.info(
                "%s: Redis not reachable at %s (%s) — using the in-process "
                "fallback and re-checking in %.0fs",
                label, settings.redis_url, exc, PROBE_INTERVAL_SECONDS,
            )
        _state[label] = (now, None)
        return None

    if cached is None or cached[1] is None:
        logger.info("%s: Redis is available", label)
    _state[label] = (now, candidate)
    return candidate


def forget(label: str) -> None:
    """Drop a remembered client after an operation on it failed.

    So a Redis that dies mid-process is re-probed on the next call rather than
    being retried once per request until the interval lapses.
    """
    _state.pop(label, None)


def _reset_for_tests() -> None:
    _state.clear()
