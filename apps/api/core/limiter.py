"""Centralised SlowAPI rate-limiter instance.

Enabled only in production.  In production the limiter prefers Redis as the shared storage backend (so limits
work across multiple API workers/replicas), and falls back to in-process memory
when Redis cannot be reached — see _usable_storage_uri. In dev/test the limiter
is disabled entirely, which means every decorated endpoint still accepts an
unlimited number of requests — no Redis required.
"""
import hmac
import logging

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from core.config import settings

_log = logging.getLogger("gaadiiq.limiter")


def came_through_trusted_proxy(request: Request) -> bool:
    """
    Did this request arrive via the proxy we put in front, or straight at us?

    A shared secret rather than an IP allow-list: Cloudflare's ranges change and
    a stale copy fails in the direction that locks out real traffic. The secret
    is injected by a Transform Rule and never travels to a browser, so a client
    addressing the origin directly cannot produce it.

    Constant-time comparison — this is a secret, and it is checked on every
    single request, which is exactly the volume a timing attack wants.
    """
    secret = settings.trusted_proxy_secret
    if not secret:
        return False
    presented = request.headers.get(settings.trusted_proxy_secret_header, "")
    return hmac.compare_digest(presented, secret)


def _real_ip(request: Request) -> str:
    """
    The client's address, taken only from sources that cannot be forged.

    WHAT THIS USED TO DO, AND WHY IT MATTERED

    It read CF-Connecting-IP, then the FIRST element of X-Forwarded-For, and
    trusted whichever it found — from anybody. Both are attacker-controlled on a
    request that did not pass through a proxy, and X-Forwarded-For's first
    element is attacker-controlled even on one that did, because a proxy appends
    to the header and whatever the client sent stays on the left.

    Measured against a 3/minute limit, six requests each carrying a different
    forged CF-Connecting-IP:

        same caller, no headers   [200, 200, 200, 429, 429, 429]
        forged CF-Connecting-IP   [200, 200, 200, 200, 200, 200]
        forged X-Forwarded-For    [200, 200, 200, 200, 200, 200]

    Every request minted a fresh bucket. The rate limiting was bypassable with
    one header, which is worse than having none: it looks like a control.

    NOW

    1. CF-Connecting-IP, but only when the request proved it came through our
       proxy. Until trusted_proxy_secret is set, that is never.
    2. Otherwise X-Forwarded-For counted from the RIGHT, by trusted_proxy_hops.
       Render appends the peer it actually saw, so the rightmost entry is the
       one Render wrote and everything to its left is whatever the client chose
       to send. Counting from the right is what makes this unspoofable — a
       client can add entries, and they all land on the wrong side.
    3. Otherwise the peer address.
    """
    if came_through_trusted_proxy(request):
        cf_ip = request.headers.get("CF-Connecting-IP")
        if cf_ip:
            return cf_ip.strip()

    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        parts = [p.strip() for p in forwarded.split(",") if p.strip()]
        if parts:
            # hops=1 -> parts[-1], the entry our own proxy appended.
            hops = max(1, settings.trusted_proxy_hops)
            return parts[-min(hops, len(parts))]

    return get_remote_address(request)


def _usable_storage_uri() -> str | None:
    """
    Redis when it is actually reachable, in-process memory when it is not.

    redis_url defaults to redis://localhost:6379, and slowapi connects lazily —
    so on a deployment with no Redis, the failure surfaced not at startup but
    on the first rate-limited request, as a ConnectionError escaping the
    decorator and becoming a 500. Every rate-limited endpoint was returning
    "Internal Server Error" while the service reported itself healthy.

    Falling back keeps the limits enforced rather than dropping them, which is
    the safer failure: an unprotected upload endpoint is worse than one whose
    counters are per-process. The caveat is real though — memory storage is not
    shared, so with N replicas the effective limit is N times the configured
    one. The warning says so, because a silent fallback here would quietly
    weaken a control that exists for abuse protection.
    """
    if not settings.is_production:
        # Limiter is disabled outside production; no storage needed.
        return None

    try:
        import redis

        client = redis.from_url(
            settings.redis_url, socket_connect_timeout=2, socket_timeout=2
        )
        client.ping()
        client.close()
        return settings.redis_url
    except Exception as exc:
        _log.warning(
            "Redis unreachable at %s (%s) — rate limits will use in-process "
            "memory storage. Counters are NOT shared between replicas; set "
            "REDIS_URL to a reachable instance for accurate limits.",
            settings.redis_url,
            exc,
        )
        return "memory://"


_storage_uri = _usable_storage_uri()

#: Applies to every route that does not carry its own @limiter.limit.
#:
#: WHY THIS EXISTS
#:
#: Counted on 24 Aug 2026: 193 route decorators across routers/, and 76
#: @limiter.limit decorations. Without a default, the other 117 endpoints were
#: unlimited — including the plain catalogue reads, which are the cheapest for
#: an attacker to find and the most expensive for us to serve, since each is a
#: database round trip. Protection was opt-in, and the opt-in had been applied
#: to well under half the surface.
#:
#: DELIBERATELY GENEROUS
#:
#: 300/minute is five requests a second from one IP, which no human browsing
#: the site will reach and which still stops a flood dead. The temptation is to
#: set it tight, and that is the wrong risk to take first: a limit set too high
#: still blocks the attack, while a limit set too low takes the site down for
#: real users at exactly the moment anyone is watching — and on a production we
#: cannot reach into afterwards, that failure is expensive and the other is not.
#:
#: Tighten it once real traffic has been observed. Endpoints that need something
#: stricter already say so with their own decorator, and those still win: an
#: explicit @limiter.limit overrides this, it does not stack with it.
DEFAULT_LIMITS = ["300/minute"]

limiter = Limiter(
    key_func=_real_ip,
    enabled=settings.is_production,
    storage_uri=_storage_uri,
    default_limits=DEFAULT_LIMITS,
)

#: True when the limiter is running on per-process memory rather than Redis.
#:
#: _usable_storage_uri already logs the fallback, but a warning in a log nobody
#: is reading during an incident is not a control. This is surfaced on the
#: health endpoint so the condition can be alerted on: with N replicas, memory
#: storage means the effective limit is N times the configured one.
USING_MEMORY_STORAGE = _storage_uri == "memory://"
