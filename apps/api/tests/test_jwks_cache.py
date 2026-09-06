"""
The JWKS cache: the hour-later sign-out, and the stall it caused every hour.

TWO PRODUCTION FAULTS, ONE FUNCTION

First: loan applications worked, and roughly an hour later every one of them
answered 401. Nothing had been deployed in between. The cache lifetime was
3600 seconds — exactly the reported interval — and `_jwks()` returned None the
moment a refresh failed, so one transient failure at the hour mark signed the
whole application out. The docstring said callers would "fall back to the
shared-secret path", but that path needs SUPABASE_JWT_SECRET, which is not set
on the Render service. There was no fallback.

Second, found in Render's log while looking for something else:

    09:12:54  OPTIONS x3
    09:12:55  JWKS fetch, 200 OK
    09:12:59  the three GETs answer      <- 5s
    09:13:09  OPTIONS x3, no JWKS line
    09:13:11  the three GETs answer      <- 2s

The fetch is `httpx.get`, which is synchronous, inside an async handler, on a
service running WEB_CONCURRENCY=1. Whichever request triggered the refresh
stopped the event loop for the whole fetch and everything in flight waited
behind it — including public catalogue reads carrying no token at all.

The fix for the second is that the request path no longer refreshes. Startup
and the scheduler call warm_jwks_cache(), which runs the blocking fetch in a
thread; `_jwks()` serves whatever is cached and does no I/O. That subsumes the
first fault as well: there is no expiry left for a failed refresh to fall off.

These tests pin both, and the last one pins the security half — a stale set
still only verifies tokens whose kid it actually contains.
"""
import logging

import pytest

from services import llm_tier


@pytest.fixture(autouse=True)
def _clean_cache(monkeypatch):
    monkeypatch.setattr(llm_tier, "_JWKS", None)
    monkeypatch.setattr(llm_tier, "_JWKS_FETCHED_AT", 0.0)
    monkeypatch.setattr(llm_tier, "_JWKS_COLD_ATTEMPTED_AT", 0.0)
    monkeypatch.setattr(llm_tier.settings, "supabase_url", "https://proj.supabase.co", raising=False)
    yield


class _Resp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


KEYS = {"keys": [{"kid": "k1", "kty": "EC"}]}


def _serving(monkeypatch, *responses):
    """Install a fake httpx whose get() walks `responses`, raising exceptions."""
    calls = {"n": 0}

    def _get(url, timeout=None):
        i = min(calls["n"], len(responses) - 1)
        calls["n"] += 1
        r = responses[i]
        if isinstance(r, Exception):
            raise r
        return _Resp(r)

    import types

    monkeypatch.setitem(
        __import__("sys").modules, "httpx", types.SimpleNamespace(get=_get)
    )
    return calls


def test_the_request_path_never_fetches_once_the_cache_is_warm(monkeypatch):
    """The one that fixes the stall.

    However old the held key set is, reading it costs no network call. This is
    the whole of the fix: the 5s the log shows was one request paying for a
    refresh that startup and the scheduler now do off the event loop.
    """
    calls = _serving(monkeypatch, KEYS)
    assert llm_tier.refresh_jwks_cache() is True
    warmed = calls["n"]

    # Far past the old 3600s lifetime, and past any plausible one.
    monkeypatch.setattr(llm_tier, "_JWKS_FETCHED_AT", llm_tier._JWKS_FETCHED_AT - 86_400)

    for _ in range(5):
        assert llm_tier._jwks() == KEYS

    assert calls["n"] == warmed, "a request refreshed the key set on the event loop"


def test_a_failed_refresh_keeps_the_keys_already_held(monkeypatch, caplog):
    # The hour-later sign-out, reproduced: fetch once, then have the refresh
    # fail. Before the fix this discarded the keys and every signed-in user
    # got a 401.
    _serving(monkeypatch, KEYS, RuntimeError("connection reset"))
    assert llm_tier.refresh_jwks_cache() is True

    with caplog.at_level(logging.WARNING):
        assert llm_tier.refresh_jwks_cache() is False

    assert llm_tier._jwks() == KEYS
    assert "continuing with the key set already held" in caplog.text


def test_a_cold_cache_that_cannot_fetch_still_returns_none(monkeypatch, caplog):
    # Nothing held and nothing fetchable is a genuine "cannot verify".
    _serving(monkeypatch, RuntimeError("down"))
    with caplog.at_level(logging.WARNING):
        assert llm_tier._jwks() is None
    assert "Could not fetch Supabase JWKS" in caplog.text


def test_a_cold_cache_does_not_refetch_on_every_request(monkeypatch):
    """The cold path is the only fetch left on the request path, so it is rate
    limited. Unbounded, every request in a Supabase outage would pay the full
    5s timeout in series on the single worker — the exact stall being fixed,
    reintroduced by the recovery path."""
    calls = _serving(monkeypatch, RuntimeError("down"))

    assert llm_tier._jwks() is None
    after_first = calls["n"]
    assert llm_tier._jwks() is None
    assert llm_tier._jwks() is None

    assert calls["n"] == after_first, "should back off, not refetch each time"


def test_the_cold_path_retries_once_the_backoff_has_passed(monkeypatch):
    _serving(monkeypatch, RuntimeError("down"), KEYS)
    assert llm_tier._jwks() is None

    monkeypatch.setattr(
        llm_tier,
        "_JWKS_COLD_ATTEMPTED_AT",
        llm_tier._JWKS_COLD_ATTEMPTED_AT - llm_tier._JWKS_COLD_RETRY_AFTER - 1,
    )
    assert llm_tier._jwks() == KEYS


def test_losing_the_project_url_does_not_discard_a_warm_cache(monkeypatch):
    _serving(monkeypatch, KEYS)
    llm_tier.refresh_jwks_cache()
    monkeypatch.setattr(llm_tier.settings, "supabase_url", "", raising=False)

    assert llm_tier._jwks() == KEYS


@pytest.mark.asyncio
async def test_the_warm_up_does_not_block_the_event_loop(monkeypatch):
    """warm_jwks_cache must hand the blocking call to a thread.

    Awaiting the fetch directly would stall the loop exactly as the request
    path did, which is the failure this whole change exists to remove — and it
    would look identical from the outside, because the cache would still fill.
    """
    import threading

    caller: dict[str, int] = {}

    def _get(url, timeout=None):
        caller["thread"] = threading.get_ident()
        return _Resp(KEYS)

    import types

    monkeypatch.setitem(__import__("sys").modules, "httpx", types.SimpleNamespace(get=_get))

    await llm_tier.warm_jwks_cache()

    assert llm_tier._jwks() == KEYS
    assert caller["thread"] != threading.get_ident(), "the fetch ran on the event loop's thread"


def test_a_stale_key_set_still_refuses_a_token_it_has_no_key_for(monkeypatch, caplog):
    # The security half: serving stale keys must not mean accepting anything.
    # A token naming a kid the held set does not contain is still refused.
    import base64

    from jose import jwt

    _serving(monkeypatch, KEYS, RuntimeError("down"))
    llm_tier.refresh_jwks_cache()
    monkeypatch.setattr(llm_tier, "_JWKS_FETCHED_AT", llm_tier._JWKS_FETCHED_AT - 86_400)

    signed = jwt.encode({"sub": "u-1"}, "x", algorithm="HS256")
    header = base64.urlsafe_b64encode(b'{"alg":"ES256","kid":"not-in-the-set"}').rstrip(b"=").decode()
    token = ".".join([header, *signed.split(".")[1:]])

    with caplog.at_level(logging.WARNING):
        assert llm_tier._verify_supabase_token(token) is None
    assert "no JWKS key matches kid" in caplog.text
