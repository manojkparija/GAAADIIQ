"""
A few seconds of catalogue responses, held at the origin.

## What this is for, and why the edge is not already enough

Cloudflare holds the public catalogue for s-maxage and absorbs almost all of
it. This is about the moments when it does not:

  * the window straight after a purge, when the zone is empty;
  * a TTL expiring under load;
  * a query nobody has asked for yet — /cars and /brochures/images both take
    filters, so "the catalogue" is thousands of distinct cache entries and a
    long tail of them are cold at any moment;
  * Cloudflare deciding not to serve from cache for its own reasons.

In each of those, every request in flight lands on the origin at once. That
origin runs WEB_CONCURRENCY=1 behind a pool of ten connections plus twenty
overflow (db/session.py). One worker, thirty connections, and a 15-second
statement timeout — so a large enough simultaneous arrival does not queue, it
times out, and every one of those readers gets an error.

## Two mechanisms, and the second is the one that matters

**A short TTL cache.** Fifteen seconds. Long enough that a burst collapses,
short enough that it is not really a source of staleness — and it is cleared on
a catalogue write anyway, by the same trigger that purges Cloudflare.

**Single-flight.** When N requests for the same key arrive with nothing cached,
ONE of them queries the database and the other N-1 wait for its answer. This is
the part that actually prevents the stampede: a cache with no single-flight
still lets a thousand simultaneous misses become a thousand queries, because
every one of them checks the cache before any of them has filled it.

Single-flight is unusually effective here precisely because of WEB_CONCURRENCY=1
— with one process there is one in-memory map, so it collapses every concurrent
duplicate in the whole service. On a multi-worker deployment it would collapse
them per worker and the ceiling would be workers × distinct keys instead.

## What it will not cache

The gate is `cache_policy.cache_directive(...) == PUBLIC_CACHE_CONTROL` — the
same function that decides what Cloudflare may keep, rather than a second list
that can drift away from the first. So this inherits every condition that file
argues for: GET only, 200 only, no Authorization header, and only the
allowlisted prefixes. If a path is ever removed from that allowlist for a
security reason, it leaves this cache in the same commit, with nothing to
remember.

Two further limits of its own:

  * JSON only. A streaming or binary response is passed straight through
    rather than buffered into memory, so brochure PDFs and image bytes are
    untouched.
  * A size cap, because this holds whole bodies and an unbounded one on a
    single worker is a memory leak with extra steps.

## Failure

Redis is optional, exactly as it is for the other caches here. Without it this
degrades to an in-process dict with the same TTL; without that it always
misses and every request behaves as it does today. A read or write that raises
is logged and ignored — a cache must never be the reason a page fails.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Awaitable, Callable

from starlette.requests import Request

from core.cache_policy import PUBLIC_CACHE_CONTROL, cache_directive
from services import redis_support

logger = logging.getLogger("gaadiiq.response_cache")

#: Deliberately small. This is a stampede absorber, not a data cache — the edge
#: is what holds content for an hour. Fifteen seconds bounds any staleness to
#: less than a page load even if the invalidation below never fired.
TTL_SECONDS = 15

#: Whole response bodies live in here, on a single worker. 512 KB is far above
#: any catalogue page (the largest /brochures/images page is a few hundred
#: rows of metadata) and far below anything that would matter to the process.
MAX_BODY_BYTES = 512 * 1024

#: The in-process fallback when Redis is absent.
MAX_MEMORY_ENTRIES = 200

_LABEL = "Response cache"

_memory: dict[str, tuple[float, str]] = {}
_inflight: dict[str, asyncio.Future] = {}

_stats = {"hits": 0, "misses": 0, "stores": 0, "coalesced": 0}

#: Last known backend, for stats(). Kept as a plain string because stats() is
#: sync and probing is not.
_backend = "memory"


async def _get_redis():
    """Redis when a real PING says so, else None — see services/redis_support."""
    global _backend

    r = await redis_support.client(_LABEL, logger)
    _backend = "redis" if r is not None else "memory"
    return r


def stats() -> dict:
    total = _stats["hits"] + _stats["misses"]
    return {
        **_stats,
        "hit_rate": round(_stats["hits"] / total, 3) if total else 0.0,
        "backend": _backend,
        "in_flight": len(_inflight),
    }


def is_cacheable(request: Request, status_code: int = 200) -> bool:
    """
    Whether this request's response may be shared with another caller.

    Delegated to cache_policy rather than re-decided here. That file is where
    the reasoning lives and where a security review would look; a second
    allowlist in a second module is how the two end up disagreeing.
    """
    return cache_directive(request, _StatusOnly(status_code)) == PUBLIC_CACHE_CONTROL


class _StatusOnly:
    """The minimum cache_directive reads from a response: its status code."""

    def __init__(self, status_code: int):
        self.status_code = status_code
        self.headers: dict[str, str] = {}


def cache_key(request: Request) -> str:
    """
    Path plus query, with the query normalised.

    Sorted, because `?make=Maruti&fuel=Petrol` and `?fuel=Petrol&make=Maruti`
    are the same question and should not be two entries — the origin pays for
    every distinct key, and this cache is small.
    """
    params = sorted(request.query_params.multi_items())
    query = "&".join(f"{k}={v}" for k, v in params)
    return f"rc:{request.url.path}?{query}"


async def get(key: str) -> tuple[int, str, str] | None:
    """A cached (status, body, media_type), or None."""
    r = await _get_redis()
    raw = None
    if r is not None:
        try:
            raw = await r.get(key)
        except Exception as exc:
            logger.info("Response cache: Redis read failed (%s); using fallback", exc)
            redis_support.forget(_LABEL)

    if raw is None:
        entry = _memory.get(key)
        if entry is not None:
            expires_at, payload = entry
            if expires_at > time.monotonic():
                raw = payload
            else:
                _memory.pop(key, None)

    if not raw:
        _stats["misses"] += 1
        return None

    try:
        stored = json.loads(raw)
        _stats["hits"] += 1
        return stored["status"], stored["body"], stored["media_type"]
    except Exception:
        _stats["misses"] += 1
        return None


async def put(key: str, status: int, body: str, media_type: str) -> None:
    """Store a response. Never raises."""
    if len(body.encode("utf-8", "ignore")) > MAX_BODY_BYTES:
        return

    try:
        payload = json.dumps({"status": status, "body": body, "media_type": media_type})
    except Exception:
        return

    r = await _get_redis()
    if r is not None:
        try:
            await r.setex(key, TTL_SECONDS, payload)
            _stats["stores"] += 1
            return
        except Exception as exc:
            logger.info("Response cache: Redis write failed (%s); using fallback", exc)
            redis_support.forget(_LABEL)

    if len(_memory) >= MAX_MEMORY_ENTRIES:
        _memory.clear()
    _memory[key] = (time.monotonic() + TTL_SECONDS, payload)
    _stats["stores"] += 1


async def single_flight(key: str, factory: Callable[[], Awaitable]):
    """
    Run `factory` once for a key, however many callers ask at the same time.

    THE FAILURE THIS PREVENTS

    A plain cache does not stop a stampede. A thousand simultaneous requests
    for a cold key each check the cache, each miss because none of them has
    filled it yet, and each queries the database — which on one worker with
    thirty connections is a queue that ends in statement timeouts rather than
    slow pages.

    The first caller here does the work. The rest await its result and get the
    same object back. If it raises, they all see that same failure, which is
    exactly what would have happened had they each done the work themselves.
    """
    existing = _inflight.get(key)
    if existing is not None:
        _stats["coalesced"] += 1
        # shield: a follower giving up (client disconnect, timeout) must not
        # cancel the leader's work that the other followers are still waiting on.
        return await asyncio.shield(existing)

    loop = asyncio.get_running_loop()
    future: asyncio.Future = loop.create_future()
    # Without this, a future whose exception no follower happened to read logs
    # "exception was never retrieved" on garbage collection — noise that looks
    # like a fault in this module rather than the original error.
    future.add_done_callback(lambda f: not f.cancelled() and f.exception())
    _inflight[key] = future

    try:
        result = await factory()
    except BaseException as exc:
        if not future.done():
            future.set_exception(exc)
        raise
    else:
        if not future.done():
            future.set_result(result)
        return result
    finally:
        _inflight.pop(key, None)


async def invalidate_all() -> int:
    """
    Drop everything. Called on a catalogue write, beside the Cloudflare purge.

    A fifteen-second TTL would expire on its own, and this exists so an admin
    does not have to wait even that long to see their own change — the same
    reason the CDN purge exists rather than letting s-maxage lapse.
    """
    dropped = len(_memory)
    _memory.clear()

    r = await _get_redis()
    if r is not None:
        try:
            async for k in r.scan_iter(match="rc:*", count=500):
                await r.delete(k)
        except Exception as exc:
            logger.warning("Response cache: could not clear keys: %s", exc)
    return dropped


def _reset_for_tests() -> None:
    _memory.clear()
    _inflight.clear()
    redis_support._reset_for_tests()
    for k in _stats:
        _stats[k] = 0
