"""
Deciding once whether Redis is there, instead of finding out per request.

## The bug being prevented

`settings.redis_url` defaults to `redis://localhost:6379` and redis-py connects
lazily. Every cache here had a `_get_redis()` that asked whether the CLIENT had
been constructed — which always succeeds, because construction opens no socket.

So on a deployment with no Redis (which is this one), each cache believed it
had Redis, attempted a connection on every operation, had it refused, and fell
back. Correct answers, a refused TCP connection and a log line per request, on
the paths that run on every catalogue read.

core/limiter.py hit the same trap earlier and worse — there the ConnectionError
escaped and became a 500 on every rate-limited endpoint while the service
reported itself healthy. It fixed that with a real `ping()`. This is the same
fix, shared, for the caches.

## What these tests pin

That a probe happens at all (a constructed client is not evidence), that the
answer is remembered rather than re-asked per call, that it is re-checked
eventually so Redis appearing later is picked up without a deploy, and that an
absent Redis is never an error.
"""
import logging

import pytest

from services import redis_support

logger = logging.getLogger("test")


class _FakeRedis:
    def __init__(self, ping_fails=False):
        self.ping_fails = ping_fails
        self.pings = 0

    async def ping(self):
        self.pings += 1
        if self.ping_fails:
            raise ConnectionError("connection refused")
        return True


@pytest.fixture(autouse=True)
def _clean():
    redis_support._reset_for_tests()
    yield
    redis_support._reset_for_tests()


def _patch_factory(monkeypatch, fake):
    """Stand in for redis.asyncio.from_url, counting how often it is called.

    Patched as an ATTRIBUTE of the real module rather than by replacing
    sys.modules["redis.asyncio"]. `import redis.asyncio as aioredis` binds the
    `asyncio` attribute of the already-imported `redis` package, so a
    sys.modules entry is consulted only on the very first import in a process
    — which made this work in the first test and silently fall through to a
    real client in every test after it.
    """
    import redis.asyncio as aioredis

    created = []

    def _from_url(*a, **kw):
        created.append(kw)
        return fake

    monkeypatch.setattr(aioredis, "from_url", _from_url)
    return created


@pytest.mark.asyncio
async def test_a_reachable_redis_is_returned(monkeypatch):
    fake = _FakeRedis()
    _patch_factory(monkeypatch, fake)

    assert await redis_support.client("test", logger) is fake
    assert fake.pings == 1, "a client was returned without a real round trip"


@pytest.mark.asyncio
async def test_an_unreachable_redis_is_none_not_an_exception(monkeypatch):
    """THE POINT. Callers have a working fallback; this must never raise.

    A cache that cannot be reached is a slower service, not a broken one.
    """
    _patch_factory(monkeypatch, _FakeRedis(ping_fails=True))

    assert await redis_support.client("test", logger) is None


@pytest.mark.asyncio
async def test_the_answer_is_not_re_asked_on_every_call(monkeypatch):
    """The waste this module exists to remove.

    Without the remembered answer, an API with no Redis attempts a connection
    on every cacheable request — which on this deployment is every catalogue
    read on the site.
    """
    fake = _FakeRedis(ping_fails=True)
    _patch_factory(monkeypatch, fake)

    for _ in range(50):
        assert await redis_support.client("test", logger) is None

    assert fake.pings == 1, f"probed {fake.pings} times for 50 calls"


@pytest.mark.asyncio
async def test_a_reachable_client_is_reused_without_re_pinging(monkeypatch):
    fake = _FakeRedis()
    _patch_factory(monkeypatch, fake)

    for _ in range(10):
        await redis_support.client("test", logger)

    assert fake.pings == 1


@pytest.mark.asyncio
async def test_the_answer_is_re_checked_after_the_interval(monkeypatch):
    """Not decided once for the life of the process.

    A permanent decision is wrong in both directions: Redis added to the
    environment later would never be used until a deploy, and a Redis that
    blipped would be abandoned for good.
    """
    fake = _FakeRedis(ping_fails=True)
    _patch_factory(monkeypatch, fake)

    await redis_support.client("test", logger)
    assert fake.pings == 1

    monkeypatch.setattr(redis_support, "PROBE_INTERVAL_SECONDS", 0.0)
    await redis_support.client("test", logger)
    assert fake.pings == 2


@pytest.mark.asyncio
async def test_labels_are_independent(monkeypatch):
    fake = _FakeRedis()
    _patch_factory(monkeypatch, fake)

    await redis_support.client("cache A", logger)
    await redis_support.client("cache B", logger)

    assert fake.pings == 2, "one cache's answer was reused for another"


@pytest.mark.asyncio
async def test_forget_forces_the_next_call_to_re_probe(monkeypatch):
    # Called when an operation on a live client fails, so a Redis that dies
    # mid-process is re-checked rather than retried once per request.
    fake = _FakeRedis()
    _patch_factory(monkeypatch, fake)

    await redis_support.client("test", logger)
    redis_support.forget("test")
    await redis_support.client("test", logger)

    assert fake.pings == 2


@pytest.mark.asyncio
async def test_a_short_connect_timeout_is_used(monkeypatch):
    # This runs in the request path. Waiting on an unreachable host is the one
    # way a cache could make the site slower rather than faster.
    created = _patch_factory(monkeypatch, _FakeRedis())

    await redis_support.client("test", logger)

    assert created[0]["socket_connect_timeout"] == redis_support.CONNECT_TIMEOUT_SECONDS
    assert created[0]["decode_responses"] is True
