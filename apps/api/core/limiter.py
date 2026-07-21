"""Centralised SlowAPI rate-limiter instance.

Enabled only in production.  In production the limiter uses Redis as the
shared storage backend (so limits work across multiple API workers/replicas).
In dev/test the limiter is disabled entirely, which means every decorated
endpoint still accepts an unlimited number of requests — no Redis required.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from core.config import settings


def _real_ip(request: Request) -> str:
    """
    Extract the real client IP when running behind a reverse proxy (Nginx,
    Cloudflare, AWS ALB).  Trusts CF-Connecting-IP first (Cloudflare), then
    X-Forwarded-For first element, then falls back to the direct peer address.
    """
    cf_ip = request.headers.get("CF-Connecting-IP")
    if cf_ip:
        return cf_ip.strip()
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return get_remote_address(request)


_storage_uri = settings.redis_url if settings.is_production else None

limiter = Limiter(
    key_func=_real_ip,
    enabled=settings.is_production,
    storage_uri=_storage_uri,
)
