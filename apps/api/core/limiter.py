"""Centralised SlowAPI rate-limiter instance.

Enabled only in production.  In production the limiter uses Redis as the
shared storage backend (so limits work across multiple API workers/replicas).
In dev/test the limiter is disabled entirely, which means every decorated
endpoint still accepts an unlimited number of requests — no Redis required.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

from core.config import settings

_storage_uri = settings.redis_url if settings.is_production else None

limiter = Limiter(
    key_func=get_remote_address,
    enabled=settings.is_production,
    storage_uri=_storage_uri,
)
