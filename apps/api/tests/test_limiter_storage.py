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


# ── Default limits ───────────────────────────────────────────────────────────
#
# The gap these cover: on 24 Aug 2026 there were 193 route decorators and 76
# @limiter.limit decorations, and the Limiter carried no default. So 117
# endpoints — the plain catalogue reads among them — accepted an unbounded
# number of requests. Protection was opt-in and mostly not opted into.


def test_the_limiter_has_a_default_so_protection_is_not_opt_in():
    """
    An endpoint with no decorator must still be bounded.

    Asserting on limiter._default_limits rather than on the string, because the
    number is expected to be tuned; what must not change is that a default
    exists at all.
    """
    assert limiter_module.DEFAULT_LIMITS, "no default limit configured"
    assert limiter_module.limiter._default_limits, "Limiter was built without default_limits"


def test_the_default_is_generous_enough_not_to_block_a_person():
    """
    Deliberately loose, and this pins that intent.

    A limit set too low takes the site down for real users; a limit set too high
    still stops a flood. On a production that cannot be reached into afterwards
    those two failures are not symmetric, so the default errs high and is meant
    to be tightened against observed traffic rather than guessed downward.
    """
    per_minute = int(limiter_module.DEFAULT_LIMITS[0].split("/")[0])
    assert per_minute >= 120, "default is tight enough to hit real users"
    assert per_minute <= 600, "default is so loose it no longer bounds anything"


def test_memory_fallback_is_reported_and_not_only_logged(monkeypatch):
    """
    A warning in a log nobody reads during an incident is not a control.

    With N replicas, memory storage means the effective limit is N times the
    configured one — the limiter is still enforcing something, just not what the
    operator thinks. This flag is what the health endpoint exposes so it can be
    alerted on.
    """
    assert isinstance(limiter_module.USING_MEMORY_STORAGE, bool)
    # And it agrees with the storage actually chosen, rather than being a
    # constant that drifted away from it.
    assert limiter_module.USING_MEMORY_STORAGE == (limiter_module._storage_uri == "memory://")


def test_an_undecorated_endpoint_is_actually_refused_after_the_default():
    """
    The behaviour, not the configuration.

    The tests above read attributes off the Limiter, and passing them proves
    only that a value was set — not that slowapi applies it to a route carrying
    no decorator of its own, which is the entire claim. This builds a real app
    with a real undecorated route and drives it until it is refused.

    A small explicit limit is used rather than the shipped 300/minute so the
    test does not have to send three hundred requests to learn the answer.
    """
    from fastapi import FastAPI, Request
    from fastapi.testclient import TestClient
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded
    from slowapi.middleware import SlowAPIMiddleware

    probe = Limiter(
        # *args: slowapi invokes key_func with no argument on the middleware
        # path, unlike the decorator path where it receives the request.
        key_func=lambda *_a: "one-caller",
        enabled=True,
        storage_uri="memory://",
        default_limits=["3/minute"],
    )

    app = FastAPI()
    app.state.limiter = probe
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)

    @app.get("/undecorated")
    async def undecorated(request: Request):      # no @limiter.limit on purpose
        return {"ok": True}

    client = TestClient(app)
    codes = [client.get("/undecorated").status_code for _ in range(5)]

    assert codes[:3] == [200, 200, 200], f"the default refused a caller too early: {codes}"
    assert 429 in codes, f"an undecorated route was never limited: {codes}"
