"""
Clear Cloudflare's copy of the catalogue when an admin changes it.

## Why this exists

Cloudflare sits in front of api.gaadiiq.com, and core/cache_policy.py marks the
public catalogue prefixes `public, max-age=0, must-revalidate, s-maxage=30`.
The edge holding a copy is the whole point — a flood of buyers collapses onto
one upstream request per TTL — but a held copy is also how an admin's change
stays invisible.

That has already happened here, and it is the reason the TTL is thirty seconds
rather than something useful. From cache_policy.py:

    This was `public, max-age=60, s-maxage=300, stale-while-revalidate=600`,
    and that combination is why the catalogue had to be hard-refreshed to show
    a change... Reported repeatedly from the live site: photographs uploaded
    against a car did not appear, models that existed read "0 models
    available", and a hard refresh fixed it every time.

    Raise s-maxage once purge-on-write exists, not before.

This is that purge. With it, the TTL no longer has to be short enough to limit
the damage, because an edit clears the edge immediately.

## Why it purges everything rather than the URLs that changed

Cloudflare offers purge by URL, by prefix, by tag, by hostname — but **prefix,
tag and hostname are Enterprise-only**. Free and Pro get purge-by-URL (thirty
per call) or purge-everything.

Purge-by-URL cannot cover `/cars`. One catalogue change affects every cached
variation of it: each page, each `bucket`, `priced_only`, `make`, `bodyType`,
`fuel`, `minPrice`/`maxPrice` combination, in any order the client sent them.
Enumerating those is not merely tedious — it is a list that will be *almost*
right, and the URLs it misses are exactly the stale pages nobody can explain.

So: purge the zone. It sounds heavy-handed and is the correct trade here.
Admin writes are a handful a day, the cache refills within seconds of the next
request, and the alternative is bookkeeping that fails silently and invisibly.
A cache that is occasionally colder than it needed to be costs a little
latency; a cache that is wrong costs the report we have had three times.

## Failure is not the caller's problem

A purge that fails must never fail the upload, the price edit or the reorder
that triggered it. The admin's write has already been committed; refusing to
report success because a cache could not be cleared would be the wrong end of
the stick. Failures are logged and swallowed, and the stale copy ages out on
the TTL anyway — which is the behaviour we had before this module existed.

Unconfigured is not a failure either. Without a token and zone id this no-ops
and says so once at debug level, so a developer machine, CI and any
environment that is not behind Cloudflare all keep working unchanged.

## Why writes are coalesced rather than purged one for one

A purge empties the WHOLE zone, so each one is paid for by every reader who
arrives before it refills. That is affordable for "a handful of admin writes a
day" — the line above — and it stops being affordable the moment writes arrive
in a burst, which is exactly how this system is used: a brochure ingestion
stores a batch of images, and an admin reordering a gallery saves a row at a
time. Twenty writes meant twenty full purges, each one throwing away the copy
the previous one had just rebuilt.

Under load that inverts the purpose of the cache. With enough concurrent
readers, a zone emptied twenty times in a minute sends twenty waves at an
origin that runs WEB_CONCURRENCY=1 (see db/session.py) behind a thirty
connection pool — a stampede caused by the thing meant to prevent one.

So a purge now runs at most once per COALESCE_WINDOW_SECONDS. The first write
purges immediately, because the common case is a single edit and the admin
should see it at once. Writes arriving during the window schedule ONE trailing
purge instead of each firing their own, so a burst of any size costs two
purges: one at the start and one after the last write lands.

The trailing half is the part that matters for correctness. Dropping the extra
writes entirely would be simpler and wrong — the last write in a burst is the
one most likely to be the change somebody is waiting to see, and skipping its
purge is how it stays invisible.
"""
from __future__ import annotations

import asyncio
import logging

import httpx

from core.config import settings

logger = logging.getLogger("gaadiiq.cdn_purge")

CLOUDFLARE_API = "https://api.cloudflare.com/client/v4"

#: Short on purpose. This runs inside an admin request, and the write it
#: follows is already committed — so the cost of waiting is real and the cost
#: of giving up is one TTL of staleness.
PURGE_TIMEOUT_SECONDS = 5.0


#: At most one purge per this many seconds. Short enough that the trailing
#: purge after a burst still feels immediate to the admin who caused it, long
#: enough that a batch ingestion does not empty the zone once per image.
COALESCE_WINDOW_SECONDS = 10.0

_last_purge_at: float = 0.0
_pending: asyncio.Task | None = None


def is_configured() -> bool:
    """Whether a purge can be attempted at all."""
    return bool(settings.cloudflare_api_token and settings.cloudflare_zone_id)


def _now() -> float:
    return asyncio.get_running_loop().time()


async def request_purge(reason: str = "") -> bool:
    """
    Ask for the edge to be cleared, at most once per window.

    Returns True only when a purge ran inline and Cloudflare confirmed it.
    False means "not now" — either nothing was attempted, or a trailing purge
    was scheduled and will run when the window closes. Callers must not read
    False as failure: the middleware ignores the result entirely, and this is
    the value it ignores.

    Never raises, for the same reason purge_catalogue does not: the admin's
    write is already committed.
    """
    global _last_purge_at, _pending

    if not is_configured():
        return False

    try:
        now = _now()
    except RuntimeError:
        # No running loop. Nothing here works outside one, and a cache purge is
        # not worth raising over — see the module docstring.
        return False

    if now - _last_purge_at >= COALESCE_WINDOW_SECONDS:
        # First write in a while. Purge inline so a lone edit — much the most
        # common case — is visible the moment the admin's request returns.
        _last_purge_at = now
        return await purge_catalogue(reason)

    if _pending is not None and not _pending.done():
        # A trailing purge is already booked; this write will be covered by it.
        logger.debug("CDN purge coalesced into the pending one: %s", reason)
        return False

    delay = max(0.0, (_last_purge_at + COALESCE_WINDOW_SECONDS) - now)
    _pending = asyncio.create_task(_purge_after(delay, reason))
    return False


async def _purge_after(delay: float, reason: str) -> None:
    """The trailing purge. Covers every write that arrived during the window."""
    global _last_purge_at

    try:
        await asyncio.sleep(delay)
        _last_purge_at = _now()
        await purge_catalogue(f"{reason} (and writes coalesced with it)")
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # pragma: no cover - purge_catalogue swallows its own
        logger.warning("Trailing CDN purge failed: %s", exc)


async def _reset_for_tests() -> None:
    """Drop any scheduled purge and forget the window.

    Async because cancelling is not finishing: a task told to cancel stays
    pending until the loop runs it once more, and a test that ends there closes
    the loop underneath it — which surfaces as "Task was destroyed but it is
    pending" from a later, unrelated test.
    """
    global _last_purge_at, _pending

    _last_purge_at = 0.0
    pending, _pending = _pending, None
    if pending is not None and not pending.done():
        pending.cancel()
        try:
            await pending
        except (asyncio.CancelledError, Exception):
            pass


async def purge_catalogue(reason: str = "") -> bool:
    """
    Drop Cloudflare's cached copies so the next reader sees the change.

    Returns True when Cloudflare confirmed the purge, False when it was not
    attempted or did not succeed. Never raises: see the module docstring.

    `reason` is logged, not sent — when a stale page is reported, the question
    is always "did a purge run when that was saved?", and a log line naming the
    write that triggered it answers it.
    """
    if not is_configured():
        logger.debug("CDN purge skipped (not configured): %s", reason or "no reason given")
        return False

    try:
        async with httpx.AsyncClient(timeout=PURGE_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{CLOUDFLARE_API}/zones/{settings.cloudflare_zone_id}/purge_cache",
                headers={
                    "Authorization": f"Bearer {settings.cloudflare_api_token}",
                    "Content-Type": "application/json",
                },
                json={"purge_everything": True},
            )
    except Exception as exc:
        # Including a timeout. The write stands; the copy ages out on its TTL.
        logger.warning("CDN purge failed for %s: %s", reason or "an admin write", exc)
        return False

    # Cloudflare answers 200 with {"success": false, "errors": [...]} for a
    # rejected token or a wrong zone, so the status code alone does not say
    # whether anything was purged.
    if response.status_code != 200:
        logger.warning(
            "CDN purge returned HTTP %s for %s: %s",
            response.status_code, reason or "an admin write", response.text[:200],
        )
        return False

    try:
        body = response.json()
    except ValueError:
        logger.warning("CDN purge returned a non-JSON body for %s", reason or "an admin write")
        return False

    if not body.get("success"):
        logger.warning(
            "CDN purge was rejected for %s: %s",
            reason or "an admin write", body.get("errors"),
        )
        return False

    logger.info("CDN purged after %s", reason or "an admin write")
    return True
