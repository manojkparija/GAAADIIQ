"""
Caching an answer that cost money, without changing what any caller sees.

## The two failures being guarded against

1. **The cache does nothing.** A key built from the wrong parts, or a store
   that never happens, and every hit is a miss — the Gemini bill is unchanged
   and nothing visibly fails. There is no error to notice; only a counter.

2. **The cache changes an answer.** Much worse, and the reason most of this
   file is about what must NOT be stored. A rejected forecast frozen in for a
   day, a vector cached from a failed load, one car's curve served for
   another — all of them look like working software.

The second class is why `_clean` rejecting a curve and `embed_texts` returning
None are both tested for *absence* of a cache entry rather than presence.
"""
import time

import pytest

from services import ai_cache, embeddings, redis_support, resale_forecast


@pytest.fixture(autouse=True)
def _clean_cache():
    ai_cache._reset_for_tests()
    # Pin the in-process backend. Whether a Redis is reachable from CI is not
    # what any of these tests is about, and letting it vary would make them
    # assert different things on different machines.
    redis_support._state[ai_cache._LABEL] = (time.monotonic(), None)
    embeddings._embed_one_cached.cache_clear()
    yield
    ai_cache._reset_for_tests()
    embeddings._embed_one_cached.cache_clear()


# ── keys ────────────────────────────────────────────────────────────────────

def test_the_same_question_makes_the_same_key():
    a = ai_cache.build_key("resale", make="Maruti", model="Swift", year=2021)
    b = ai_cache.build_key("resale", year=2021, make="Maruti", model="Swift")
    assert a == b, "argument order must not split one answer across two keys"


def test_a_different_question_makes_a_different_key():
    # The failure this pins is a cache that ignores part of its input and hands
    # a Creta's resale curve to someone looking at a Swift.
    base = dict(make="Maruti", model="Swift", year=2021, price=600000)
    key = ai_cache.build_key("resale", **base)
    for field, other in [
        ("make", "Hyundai"),
        ("model", "Baleno"),
        ("year", 2022),
        ("price", 700000),
    ]:
        assert ai_cache.build_key("resale", **{**base, field: other}) != key, field


def test_a_key_is_case_and_space_insensitive():
    assert ai_cache.build_key("resale", make=" Maruti ") == ai_cache.build_key(
        "resale", make="maruti"
    )


def test_namespaces_do_not_collide():
    assert ai_cache.build_key("resale", q="x") != ai_cache.build_key("research", q="x")
    assert ai_cache.build_key("resale", q="x").startswith("resale:")


# ── the store itself ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_stored_value_comes_back_unchanged():
    key = ai_cache.build_key("resale", q="1")
    await ai_cache.put(key, {"forecast": [{"year": 1, "value": 500000}], "summary": "holds"})
    assert await ai_cache.get(key) == {
        "forecast": [{"year": 1, "value": 500000}],
        "summary": "holds",
    }


@pytest.mark.asyncio
async def test_a_miss_is_none_not_an_error():
    assert await ai_cache.get(ai_cache.build_key("resale", q="never-stored")) is None


@pytest.mark.asyncio
async def test_an_unserialisable_value_is_skipped_rather_than_raising():
    # The contract that keeps this out of the request path: the caller already
    # has its answer, so a cache write must never be the thing that fails.
    key = ai_cache.build_key("resale", q="bad")
    await ai_cache.put(key, {"fn": object()})  # default=str handles it
    assert ai_cache._stats["skips"] + ai_cache._stats["stores"] == 1


@pytest.mark.asyncio
async def test_a_broken_redis_does_not_reach_the_caller():
    """Redis being down degrades to the in-process dict, silently."""
    class _Exploding:
        async def get(self, *a, **kw):
            raise RuntimeError("connection refused")

        async def setex(self, *a, **kw):
            raise RuntimeError("connection refused")

    redis_support._state[ai_cache._LABEL] = (time.monotonic(), _Exploding())

    key = ai_cache.build_key("resale", q="2")
    await ai_cache.put(key, {"forecast": [1]})
    assert await ai_cache.get(key) == {"forecast": [1]}


@pytest.mark.asyncio
async def test_the_memory_fallback_is_bounded():
    for n in range(ai_cache.MAX_MEMORY_ENTRIES + 5):
        await ai_cache.put(f"resale:{n}", {"n": n})
    assert len(ai_cache._memory) <= ai_cache.MAX_MEMORY_ENTRIES


@pytest.mark.asyncio
async def test_invalidate_drops_only_its_own_namespace():
    await ai_cache.put(ai_cache.build_key("resale", q="a"), {"v": 1})
    keep = ai_cache.build_key("research", q="a")
    await ai_cache.put(keep, {"v": 2})

    assert await ai_cache.invalidate("resale") == 1
    assert await ai_cache.get(keep) == {"v": 2}


@pytest.mark.asyncio
async def test_stats_count_hits_and_misses():
    key = ai_cache.build_key("resale", q="3")
    await ai_cache.get(key)
    await ai_cache.put(key, {"v": 1})
    await ai_cache.get(key)

    s = ai_cache.stats()
    assert s["hits"] == 1 and s["misses"] == 1 and s["hit_rate"] == 0.5


# ── resale forecast: the wiring ─────────────────────────────────────────────

_ARGS = dict(
    make="Maruti",
    model="Swift",
    variant="VXi",
    year=2021,
    fuel="Petrol",
    transmission="Manual",
    price=600000,
    years=3,
)

_GOOD = (
    '{"forecast": [{"year": 1, "value": 520000, "note": ""},'
    ' {"year": 2, "value": 460000, "note": ""},'
    ' {"year": 3, "value": 410000, "note": ""}],'
    ' "summary": "Swift resale is strong."}'
)


def _gemini(monkeypatch, text, counter):
    monkeypatch.setattr(resale_forecast, "gemini_available", lambda: True)

    async def _generate(prompt, **kw):
        counter.append(prompt)
        return text

    monkeypatch.setattr(resale_forecast.gemini_gateway, "generate_text", _generate)


@pytest.mark.asyncio
async def test_the_second_identical_forecast_does_not_call_gemini(monkeypatch):
    """The whole point. One billed call, two identical answers."""
    calls: list = []
    _gemini(monkeypatch, _GOOD, calls)

    first = await resale_forecast.ai_forecast(**_ARGS)
    second = await resale_forecast.ai_forecast(**_ARGS)

    assert len(calls) == 1, "the second forecast went to Gemini"
    assert first == second
    assert first[0][0]["value"] == 520000


@pytest.mark.asyncio
async def test_a_different_car_is_not_served_the_cached_curve(monkeypatch):
    calls: list = []
    _gemini(monkeypatch, _GOOD, calls)

    await resale_forecast.ai_forecast(**_ARGS)
    await resale_forecast.ai_forecast(**{**_ARGS, "model": "Baleno"})

    assert len(calls) == 2


@pytest.mark.asyncio
async def test_a_rejected_curve_is_never_stored(monkeypatch):
    """THE ONE THAT MATTERS MOST.

    _clean returns ([], "") for an answer it will not stand behind — rising
    values, a short curve, junk where an integer belongs. Caching that empty
    result would freeze the heuristic fallback in for a full day and no retry
    would ever reach Gemini again, with nothing in the logs to say why.
    """
    calls: list = []
    _gemini(monkeypatch, '{"forecast": [{"year": 1, "value": "nonsense"}]}', calls)

    assert await resale_forecast.ai_forecast(**_ARGS) == ([], "")
    assert await resale_forecast.ai_forecast(**_ARGS) == ([], "")
    assert len(calls) == 2, "an unusable answer was cached and the retry never happened"


@pytest.mark.asyncio
async def test_a_gemini_failure_is_not_stored(monkeypatch):
    monkeypatch.setattr(resale_forecast, "gemini_available", lambda: True)
    calls: list = []

    async def _boom(prompt, **kw):
        calls.append(prompt)
        raise RuntimeError("504")

    monkeypatch.setattr(resale_forecast.gemini_gateway, "generate_text", _boom)

    assert await resale_forecast.ai_forecast(**_ARGS) == ([], "")
    assert await resale_forecast.ai_forecast(**_ARGS) == ([], "")
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_no_key_means_no_cache_lookup_and_no_call(monkeypatch):
    # Unchanged behaviour for an environment with no Gemini key: the heuristic
    # path the caller already had, with nothing new in front of it.
    monkeypatch.setattr(resale_forecast, "gemini_available", lambda: False)
    assert await resale_forecast.ai_forecast(**_ARGS) == ([], "")
    assert ai_cache.stats()["hits"] == 0 and ai_cache.stats()["misses"] == 0


@pytest.mark.asyncio
async def test_the_heuristic_is_untouched():
    # The fallback is what most requests actually get. It takes no cache and
    # must keep returning exactly what it did.
    rows = resale_forecast.heuristic_forecast(600000, "Petrol", years=3)
    assert [r["year"] for r in rows] == [1, 2, 3]
    assert rows[0]["value"] > rows[1]["value"] > rows[2]["value"]


# ── embeddings: in-process, deliberately not Redis ──────────────────────────

def test_a_repeated_embedding_is_computed_once(monkeypatch):
    calls: list = []

    def _embed(texts):
        calls.append(list(texts))
        return [[0.1, 0.2, 0.3]]

    monkeypatch.setattr(embeddings, "embed_texts", _embed)
    embeddings._embed_one_cached.cache_clear()

    assert embeddings.embed_one("swift petrol") == [0.1, 0.2, 0.3]
    assert embeddings.embed_one("swift petrol") == [0.1, 0.2, 0.3]
    assert len(calls) == 1


def test_a_caller_cannot_mutate_the_next_caller_s_vector(monkeypatch):
    """lru_cache hands back the same object; a list would be shared state.

    The bug without this: recommend.py normalises a vector in place, and the
    next request to embed the same query gets the normalised one.
    """
    monkeypatch.setattr(embeddings, "embed_texts", lambda t: [[1.0, 2.0]])
    embeddings._embed_one_cached.cache_clear()

    first = embeddings.embed_one("q")
    first[0] = 99.0
    assert embeddings.embed_one("q") == [1.0, 2.0]


def test_a_failed_embedding_is_not_cached_as_a_failure(monkeypatch):
    """A transient miss must not become permanent.

    embed_texts returns None while the model is still loading and when a single
    call fails. lru_cache stores return values, so a returned None would make
    the first failure the answer for the rest of the process's life — search
    silently degraded until a restart nobody knows to perform.
    """
    state = {"ready": False}

    def _embed(texts):
        return [[0.5, 0.5]] if state["ready"] else None

    monkeypatch.setattr(embeddings, "embed_texts", _embed)
    embeddings._embed_one_cached.cache_clear()

    assert embeddings.embed_one("q") is None
    state["ready"] = True
    assert embeddings.embed_one("q") == [0.5, 0.5]


def test_different_text_is_not_shared(monkeypatch):
    monkeypatch.setattr(embeddings, "embed_texts", lambda t: [[float(len(t[0]))]])
    embeddings._embed_one_cached.cache_clear()

    assert embeddings.embed_one("ab") == [2.0]
    assert embeddings.embed_one("abcd") == [4.0]


def test_embed_cache_stats_report_the_hit_rate(monkeypatch):
    monkeypatch.setattr(embeddings, "embed_texts", lambda t: [[0.0]])
    embeddings._embed_one_cached.cache_clear()

    embeddings.embed_one("q")
    embeddings.embed_one("q")
    stats = embeddings.embed_cache_stats()
    assert stats["hits"] == 1 and stats["misses"] == 1 and stats["hit_rate"] == 0.5
