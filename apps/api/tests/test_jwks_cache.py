"""
The JWKS cache, and the hour-later sign-out.

Reported from production: loan applications worked, and roughly an hour later
every one of them answered 401. Nothing had been deployed in between.

`_JWKS_TTL` is 3600 seconds. The cache expires at exactly the reported
interval, and the old `_jwks()` returned None the moment a refresh failed —
so one transient failure at the hour mark signed the whole application out
until some later fetch happened to succeed. The docstring said callers would
"fall back to the shared-secret path", but that path needs
SUPABASE_JWT_SECRET, which is not set on the Render service (its absence is
visible in the alphabetical env-var list, between STT_PROVIDER and
SUPABASE_URL). There was no fallback.

These tests pin the fix: a key set already held survives a failed refresh.
They do not loosen verification — the tests at the bottom check that a stale
set still only verifies tokens whose kid it actually contains.
"""
import logging

import pytest

from services import llm_tier


@pytest.fixture(autouse=True)
def _clean_cache(monkeypatch):
    monkeypatch.setattr(llm_tier, "_JWKS", None)
    monkeypatch.setattr(llm_tier, "_JWKS_FETCHED_AT", 0.0)
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


def test_a_failed_refresh_keeps_the_keys_already_held(monkeypatch, caplog):
    # The reported failure, reproduced: fetch once, let the hour pass, and have
    # the refresh fail. Before the fix this returned None and every signed-in
    # user got a 401.
    _serving(monkeypatch, KEYS, RuntimeError("connection reset"))

    assert llm_tier._jwks() == KEYS

    monkeypatch.setattr(llm_tier, "_JWKS_FETCHED_AT", llm_tier._JWKS_FETCHED_AT - 3601)
    with caplog.at_level(logging.WARNING):
        assert llm_tier._jwks() == KEYS

    assert "continuing with the key set already held" in caplog.text


def test_a_failed_refresh_does_not_retry_on_every_request(monkeypatch):
    # Retrying per request would put a timing-out network call in front of
    # every authenticated call while Supabase is unreachable.
    calls = _serving(monkeypatch, KEYS, RuntimeError("down"))
    llm_tier._jwks()
    monkeypatch.setattr(llm_tier, "_JWKS_FETCHED_AT", llm_tier._JWKS_FETCHED_AT - 3601)

    llm_tier._jwks()
    before = calls["n"]
    llm_tier._jwks()
    llm_tier._jwks()

    assert calls["n"] == before, "should back off, not refetch each time"


def test_it_does_retry_once_the_backoff_has_passed(monkeypatch):
    _serving(monkeypatch, KEYS, RuntimeError("down"), {"keys": [{"kid": "k2"}]})
    llm_tier._jwks()
    monkeypatch.setattr(llm_tier, "_JWKS_FETCHED_AT", llm_tier._JWKS_FETCHED_AT - 3601)
    llm_tier._jwks()  # fails, backs off

    monkeypatch.setattr(
        llm_tier, "_JWKS_FETCHED_AT", llm_tier._JWKS_FETCHED_AT - llm_tier._JWKS_RETRY_AFTER - 1
    )
    assert llm_tier._jwks() == {"keys": [{"kid": "k2"}]}


def test_a_cold_cache_that_cannot_fetch_still_returns_none(monkeypatch, caplog):
    # Nothing held and nothing fetchable is a genuine "cannot verify".
    _serving(monkeypatch, RuntimeError("down"))
    with caplog.at_level(logging.WARNING):
        assert llm_tier._jwks() is None
    assert "Could not fetch Supabase JWKS" in caplog.text


def test_losing_the_project_url_does_not_discard_a_warm_cache(monkeypatch):
    _serving(monkeypatch, KEYS)
    llm_tier._jwks()
    monkeypatch.setattr(llm_tier.settings, "supabase_url", "", raising=False)
    monkeypatch.setattr(llm_tier, "_JWKS_FETCHED_AT", llm_tier._JWKS_FETCHED_AT - 3601)

    assert llm_tier._jwks() == KEYS


def test_a_stale_key_set_still_refuses_a_token_it_has_no_key_for(monkeypatch, caplog):
    # The security half: serving stale keys must not mean accepting anything.
    # A token naming a kid the held set does not contain is still refused.
    import base64

    from jose import jwt

    _serving(monkeypatch, KEYS, RuntimeError("down"))
    llm_tier._jwks()
    monkeypatch.setattr(llm_tier, "_JWKS_FETCHED_AT", llm_tier._JWKS_FETCHED_AT - 3601)

    signed = jwt.encode({"sub": "u-1"}, "x", algorithm="HS256")
    header = base64.urlsafe_b64encode(b'{"alg":"ES256","kid":"not-in-the-set"}').rstrip(b"=").decode()
    token = ".".join([header, *signed.split(".")[1:]])

    with caplog.at_level(logging.WARNING):
        assert llm_tier._verify_supabase_token(token) is None
    assert "no JWKS key matches kid" in caplog.text
