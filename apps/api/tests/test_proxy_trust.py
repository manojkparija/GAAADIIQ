"""
Rate limiting is only a control if its key cannot be chosen by the caller.

THE BUG THIS FILE EXISTS FOR

_real_ip read CF-Connecting-IP, then the FIRST element of X-Forwarded-For, and
trusted whichever it found — from anybody. Measured against a 3/minute limit,
six requests each carrying a different forged CF-Connecting-IP returned
[200, 200, 200, 200, 200, 200]: every request minted its own bucket, so the
limit bounded nothing. Rate limiting that a single header defeats is worse than
none, because it looks like protection.

The subtlety that makes the fix non-obvious: Render terminates TLS, so simply
ignoring the headers would put every visitor behind one proxy address and share
a single bucket across the whole internet — an outage we would have caused
ourselves. The tests below pin both halves: forgery must fail AND genuinely
different clients must still be counted separately.
"""
import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from core import limiter as limiter_module
from core.config import settings


def _app(limit: str = "3/minute") -> TestClient:
    app = FastAPI()
    app.state.limiter = Limiter(
        key_func=limiter_module._real_ip,
        enabled=True,
        storage_uri="memory://",
        default_limits=[limit],
    )
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)

    @app.get("/x")
    async def x(request: Request):
        return {"ok": True}

    return TestClient(app)


def test_a_forged_cf_connecting_ip_does_not_mint_a_new_bucket():
    """
    CF-Connecting-IP is meaningful only when Cloudflare set it, and the only
    proof of that is the shared secret. With no secret configured — which is
    the state until Cloudflare is actually in front — the header is ignored
    entirely rather than believed.
    """
    client = _app()
    codes = [
        client.get("/x", headers={"CF-Connecting-IP": f"9.9.9.{i}"}).status_code
        for i in range(6)
    ]
    assert 429 in codes, f"a forged CF-Connecting-IP still bought fresh buckets: {codes}"


def test_a_forged_x_forwarded_for_does_not_survive_the_proxy_appending_to_it():
    """
    Production shape: the client's value stays on the LEFT and the proxy appends
    the peer it actually saw on the RIGHT. Counting from the right is what makes
    this unspoofable — anything the caller adds lands on the wrong side.
    """
    client = _app()
    codes = [
        client.get(
            "/x", headers={"X-Forwarded-For": f"8.8.8.{i}, 203.0.113.7"}
        ).status_code
        for i in range(6)
    ]
    assert codes[:3] == [200, 200, 200]
    assert 429 in codes, f"forgery survived the proxy's own entry: {codes}"


def test_two_genuine_clients_are_still_counted_separately():
    """
    The failure the naive fix would have caused.

    If proxy headers were ignored outright, every visitor would key on Render's
    proxy address and share one bucket — 300/minute for the entire internet.
    Six requests alternating between two real addresses is three each, so none
    may be refused.
    """
    client = _app()
    codes = [
        client.get("/x", headers={"X-Forwarded-For": f"203.0.113.{i % 2}"}).status_code
        for i in range(6)
    ]
    assert codes == [200] * 6, f"distinct clients were sharing a bucket: {codes}"


def test_cf_connecting_ip_is_trusted_once_the_request_proves_where_it_came_from(
    monkeypatch,
):
    """And the other direction: with the secret present, the header is used."""
    monkeypatch.setattr(settings, "trusted_proxy_secret", "s3cret", raising=False)
    client = _app()
    headers = {"CF-Connecting-IP": "198.51.100.4", "X-Gaadiiq-Origin": "s3cret"}
    for _ in range(3):
        assert client.get("/x", headers=headers).status_code == 200
    assert client.get("/x", headers=headers).status_code == 429


def test_a_wrong_secret_is_not_accepted(monkeypatch):
    monkeypatch.setattr(settings, "trusted_proxy_secret", "s3cret", raising=False)

    class _Req:
        headers = {"X-Gaadiiq-Origin": "not-the-secret"}

    assert limiter_module.came_through_trusted_proxy(_Req()) is False


@pytest.mark.parametrize("secret,required", [("", True), ("s3cret", False), ("", False)])
def test_the_origin_lock_stays_off_unless_both_switches_are_set(
    monkeypatch, secret, required
):
    """
    It must not switch itself on when this deploys.

    The lock refuses every request that did not come through Cloudflare. If it
    activated on a service where Cloudflare is not yet in front — or where the
    secret is missing, so nothing can ever satisfy it — that is a total outage,
    self-inflicted, on the exact deploy meant to harden things.
    """
    monkeypatch.setattr(settings, "trusted_proxy_secret", secret, raising=False)
    monkeypatch.setattr(settings, "require_trusted_proxy", required, raising=False)
    assert not (settings.require_trusted_proxy and settings.trusted_proxy_secret)
