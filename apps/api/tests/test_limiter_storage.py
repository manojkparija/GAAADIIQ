"""
Rate limiting must survive an unreachable Redis.

redis_url defaults to redis://localhost:6379 and slowapi connects lazily, so a
deployment without Redis looked healthy at startup and then returned 500 on the
first rate-limited request — the ConnectionError escaped the decorator. On
Render this meant every rate-limited endpoint was broken, and because the 500
carried no CORS headers the browser reported it as "could not reach the API".

The limiter now probes Redis and falls back to memory storage. These tests pin
that behaviour, including that the fallback is announced rather than silent:
memory counters are per-process, so with multiple replicas the effective limit
is looser than configured, and an operator needs to know.
"""
import logging

import pytest

from core import limiter as limiter_module
from core.config import settings


class _RefusingRedis:
    """Stands in for redis-py when nothing is listening."""

    @staticmethod
    def from_url(*_args, **_kwargs):
        raise ConnectionError("Error 111 connecting to localhost:6379. Connection refused.")


class _WorkingRedis:
    class _Client:
        def ping(self):
            return True

        def close(self):
            pass

    @classmethod
    def from_url(cls, *_args, **_kwargs):
        return cls._Client()


@pytest.fixture
def production(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    assert settings.is_production


def test_falls_back_to_memory_when_redis_is_refused(production, monkeypatch):
    monkeypatch.setitem(__import__("sys").modules, "redis", _RefusingRedis)

    assert limiter_module._usable_storage_uri() == "memory://"


def test_fallback_is_logged_with_the_replica_caveat(production, monkeypatch, caplog):
    monkeypatch.setitem(__import__("sys").modules, "redis", _RefusingRedis)

    with caplog.at_level(logging.WARNING, logger="gaadiiq.limiter"):
        limiter_module._usable_storage_uri()

    message = caplog.text
    assert "memory" in message.lower()
    # Silently weakening an abuse control is the failure mode to avoid.
    assert "replica" in message.lower()


def test_uses_redis_when_it_answers(production, monkeypatch):
    monkeypatch.setitem(__import__("sys").modules, "redis", _WorkingRedis)

    assert limiter_module._usable_storage_uri() == settings.redis_url


def test_no_storage_configured_outside_production(monkeypatch):
    monkeypatch.setattr(settings, "environment", "development")

    # The limiter is disabled in dev, so it must not reach for Redis at all.
    monkeypatch.setitem(__import__("sys").modules, "redis", _RefusingRedis)
    assert limiter_module._usable_storage_uri() is None
