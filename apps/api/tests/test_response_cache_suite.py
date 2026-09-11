"""
The origin's own few seconds of cache, and the single-flight in front of it.

## Why this is not just "another cache test"

The interesting half is not the cache. It is what happens when a thousand
readers ask for the same cold key at the same moment — the situation this
service is least able to survive, running WEB_CONCURRENCY=1 behind thirty
connections with a 15-second statement timeout. A cache with no single-flight
does nothing there: every one of those requests checks the cache, every one
misses because none has filled it yet, and every one queries the database.

So the central test below runs concurrent requests against a deliberately slow
factory and asserts the factory ran ONCE. It was verified to fail without the
single-flight, which is the only way to know it is testing the mechanism
rather than the order the event loop happened to run things in.

## The other half is what must NOT be cached

A response cache that shares the wrong response is a disclosure, not a
performance bug. The gate is cache_policy.cache_directive — the same function
the CDN policy uses — so these tests pin that the delegation holds: an
authenticated request, a non-200, a POST and an unlisted path must all pass
through untouched.
"""
import asyncio
import time

import pytest
from starlette.datastructures import Headers
from starlette.requests import Request

from core.cache_policy import PUBLIC_CACHE_CONTROL, cache_directive
from services import redis_support, response_cache


@pytest.fixture(autouse=True)
def _clean():
    response_cache._reset_for_tests()
    # Pin the in-process backend: whether CI can reach a Redis is not what any
    # of these tests is about. Recorded as a probed answer so no PING is
    # attempted either.
    redis_support._state[response_cache._LABEL] = (time.monotonic(), None)
    yield
    response_cache._reset_for_tests()


def _request(path: str, method: str = "GET", query: str = "", headers: dict | None = None):
    return Request(
        {
            "type": "http",
            "method": method,
            "path": path,
            "raw_path": path.encode(),
            "query_string": query.encode(),
            "headers": Headers(headers or {}).raw,
            "scheme": "https",
            "server": ("api.gaadiiq.com", 443),
        }
    )


# ── what may be cached ──────────────────────────────────────────────────────

def test_public_catalogue_reads_are_cacheable():
    assert response_cache.is_cacheable(_request("/cars")) is True
    assert response_cache.is_cacheable(_request("/brochures/images")) is True
    assert response_cache.is_cacheable(_request("/video-reviews/car/abc")) is True


def test_an_authenticated_request_is_never_cached():
    """One admin's response must never be replayed to a buyer.

    This is the condition that makes the whole approach safe, and it is not
    re-decided here — it is cache_policy's, inherited.
    """
    req = _request("/cars", headers={"Authorization": "Bearer token"})
    assert response_cache.is_cacheable(req) is False


@pytest.mark.parametrize("path", ["/loans/applications", "/auth/me", "/mechanics", "/brochures/jobs"])
def test_private_paths_are_not_cached(path):
    assert response_cache.is_cacheable(_request(path)) is False


@pytest.mark.parametrize("method", ["POST", "PATCH", "DELETE"])
def test_writes_are_not_cached(method):
    assert response_cache.is_cacheable(_request("/cars", method=method)) is False


@pytest.mark.parametrize("status", [201, 304, 404, 429, 500, 503])
def test_only_200_is_cached(status):
    assert response_cache.is_cacheable(_request("/cars"), status) is False


def test_the_gate_is_the_same_one_the_cdn_policy_uses():
    """Delegation, not duplication.

    If this module grew its own allowlist, a prefix removed from cache_policy
    for a security reason would stay cached at the origin — the failure being
    guarded against is two lists that drift.
    """
    for path in ("/cars", "/loans/applications", "/brochures/images", "/auth/me"):
        expected = cache_directive(_request(path), type("R", (), {"status_code": 200, "headers": {}})())
        assert response_cache.is_cacheable(_request(path)) is (expected == PUBLIC_CACHE_CONTROL)


# ── keys ────────────────────────────────────────────────────────────────────

def test_filters_in_a_different_order_share_one_key():
    a = response_cache.cache_key(_request("/cars", query="make=Maruti&fuel=Petrol"))
    b = response_cache.cache_key(_request("/cars", query="fuel=Petrol&make=Maruti"))
    assert a == b


def test_different_filters_do_not_share_a_key():
    a = response_cache.cache_key(_request("/cars", query="make=Maruti"))
    b = response_cache.cache_key(_request("/cars", query="make=Hyundai"))
    assert a != b


def test_different_paths_do_not_share_a_key():
    assert response_cache.cache_key(_request("/cars")) != response_cache.cache_key(
        _request("/brochures/images")
    )


# ── store and fetch ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_stored_response_comes_back_intact():
    await response_cache.put("rc:/cars?", 200, '{"items":[]}', "application/json")
    assert await response_cache.get("rc:/cars?") == (200, '{"items":[]}', "application/json")


@pytest.mark.asyncio
async def test_a_miss_is_none():
    assert await response_cache.get("rc:/cars?never") is None


@pytest.mark.asyncio
async def test_an_oversized_body_is_not_held():
    # This keeps whole bodies in the memory of a single-worker process, so the
    # cap is what stops it being a leak with extra steps.
    huge = "x" * (response_cache.MAX_BODY_BYTES + 1)
    await response_cache.put("rc:/cars?big", 200, huge, "application/json")
    assert await response_cache.get("rc:/cars?big") is None


@pytest.mark.asyncio
async def test_an_entry_expires():
    response_cache.TTL_SECONDS = 0
    try:
        await response_cache.put("rc:/cars?ttl", 200, "{}", "application/json")
        await asyncio.sleep(0.01)
        assert await response_cache.get("rc:/cars?ttl") is None
    finally:
        response_cache.TTL_SECONDS = 15


@pytest.mark.asyncio
async def test_the_memory_fallback_is_bounded():
    for n in range(response_cache.MAX_MEMORY_ENTRIES + 5):
        await response_cache.put(f"rc:/cars?{n}", 200, "{}", "application/json")
    assert len(response_cache._memory) <= response_cache.MAX_MEMORY_ENTRIES


@pytest.mark.asyncio
async def test_invalidate_clears_everything():
    # Fired on every catalogue write, so an admin's own refresh is not answered
    # from the copy one layer below the edge they just purged.
    await response_cache.put("rc:/cars?a", 200, "{}", "application/json")
    await response_cache.put("rc:/brochures/images?b", 200, "{}", "application/json")

    assert await response_cache.invalidate_all() == 2
    assert await response_cache.get("rc:/cars?a") is None


@pytest.mark.asyncio
async def test_a_broken_redis_falls_back_rather_than_failing():
    class _Exploding:
        async def get(self, *a, **kw):
            raise RuntimeError("connection refused")

        async def setex(self, *a, **kw):
            raise RuntimeError("connection refused")

    redis_support._state[response_cache._LABEL] = (time.monotonic(), _Exploding())

    await response_cache.put("rc:/cars?x", 200, '{"ok":1}', "application/json")
    assert await response_cache.get("rc:/cars?x") == (200, '{"ok":1}', "application/json")


# ── single-flight: the part that actually stops a stampede ──────────────────

@pytest.mark.asyncio
async def test_concurrent_misses_query_once():
    """THE CENTRAL TEST.

    Fifty simultaneous requests for one cold key. Without single-flight all
    fifty reach the database, which on one worker with thirty connections is a
    queue ending in statement timeouts rather than slow pages.

    Verified to fail without the mechanism (50 calls instead of 1), so it is
    testing the coalescing rather than an accident of scheduling order.
    """
    calls = []

    async def _slow():
        calls.append(1)
        await asyncio.sleep(0.05)   # long enough that all fifty are in flight
        return "answer"

    results = await asyncio.gather(
        *[response_cache.single_flight("rc:/cars?hot", _slow) for _ in range(50)]
    )

    assert len(calls) == 1, f"{len(calls)} callers reached the database instead of 1"
    assert results == ["answer"] * 50


@pytest.mark.asyncio
async def test_every_waiter_sees_a_failure_rather_than_hanging():
    """A failing leader must not strand its followers.

    They see the same error they would have produced themselves — which is the
    contract: single-flight changes how many callers do the work, never what
    the caller ends up with.
    """
    async def _boom():
        await asyncio.sleep(0.01)
        raise RuntimeError("database is down")

    results = await asyncio.gather(
        *[response_cache.single_flight("rc:/cars?bad", _boom) for _ in range(5)],
        return_exceptions=True,
    )

    assert len(results) == 5
    assert all(isinstance(r, RuntimeError) for r in results)


@pytest.mark.asyncio
async def test_a_follower_giving_up_does_not_cancel_the_others():
    """A disconnecting client must not take the in-flight query with it.

    Browsers abandon requests constantly — a navigation away, a reload, a
    closed tab. Without the shield in single_flight, one of those cancelling
    its await would cancel the shared future and every other reader waiting on
    it would fail for a reason that has nothing to do with them.
    """
    started = asyncio.Event()

    async def _slow():
        started.set()
        await asyncio.sleep(0.05)
        return "answer"

    leader = asyncio.create_task(response_cache.single_flight("rc:/cars?c", _slow))
    await started.wait()

    follower = asyncio.create_task(response_cache.single_flight("rc:/cars?c", _slow))
    await asyncio.sleep(0)          # let it attach to the leader's future
    follower.cancel()

    assert await leader == "answer"


@pytest.mark.asyncio
async def test_sequential_calls_are_not_coalesced():
    # Single-flight covers overlap only. Once the first has finished there is
    # nothing in flight, and the TTL cache is what serves the next caller —
    # this module must not silently dedupe two requests that never overlapped.
    calls = []

    async def _work():
        calls.append(1)
        return "x"

    await response_cache.single_flight("rc:/cars?s", _work)
    await response_cache.single_flight("rc:/cars?s", _work)

    assert len(calls) == 2


@pytest.mark.asyncio
async def test_different_keys_run_independently():
    calls = []

    async def _work():
        calls.append(1)
        await asyncio.sleep(0.01)
        return "x"

    await asyncio.gather(
        response_cache.single_flight("rc:/cars?a", _work),
        response_cache.single_flight("rc:/brochures/images?b", _work),
    )

    assert len(calls) == 2


@pytest.mark.asyncio
async def test_the_map_does_not_leak_after_a_failure():
    # A key left behind in _inflight would make every later request for it wait
    # on a future that will never resolve — a permanent hang on one URL.
    async def _boom():
        raise RuntimeError("no")

    with pytest.raises(RuntimeError):
        await response_cache.single_flight("rc:/cars?leak", _boom)

    assert response_cache._inflight == {}


@pytest.mark.asyncio
async def test_stats_report_what_happened():
    async def _work():
        await asyncio.sleep(0.02)
        return "x"

    await asyncio.gather(
        *[response_cache.single_flight("rc:/cars?stat", _work) for _ in range(3)]
    )
    await response_cache.put("rc:/cars?stat", 200, "{}", "application/json")
    await response_cache.get("rc:/cars?stat")

    s = response_cache.stats()
    assert s["coalesced"] == 2 and s["hits"] == 1 and s["in_flight"] == 0
