"""
The security headers every response carries.

These are one middleware and easy to delete by accident, and nothing about a
passing test suite would notice — a missing header breaks no feature. Asserting
them is how they survive.

The Content-Security-Policy is production-only and deliberately so: this
service returns JSON, so nothing should ever load from one of its responses,
but in development /docs serves Swagger UI from a CDN and `default-src 'none'`
would leave an empty page.
"""
import pytest
from httpx import ASGITransport, AsyncClient

from core.config import settings
from main import app


async def _get(path: str = "/health"):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.get(path)


@pytest.mark.asyncio
async def test_the_always_on_headers_are_present():
    resp = await _get()

    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["X-Frame-Options"] == "DENY"
    assert resp.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert "camera=()" in resp.headers["Permissions-Policy"]


@pytest.mark.asyncio
async def test_csp_and_hsts_are_production_only(monkeypatch):
    """
    Outside production these two are absent on purpose.

    HSTS on a plain-HTTP dev server pins the browser to https for the whole
    host, which is a confusing afternoon. And `default-src 'none'` empties the
    Swagger UI that only exists outside production.
    """
    monkeypatch.setattr(type(settings), "is_production", property(lambda _: False))
    resp = await _get()
    assert "Content-Security-Policy" not in resp.headers
    assert "Strict-Transport-Security" not in resp.headers


@pytest.mark.asyncio
async def test_in_production_the_api_forbids_loading_anything(monkeypatch):
    monkeypatch.setattr(type(settings), "is_production", property(lambda _: True))
    resp = await _get()

    csp = resp.headers["Content-Security-Policy"]
    # A JSON API has no business fetching a script, a style or an image, so the
    # policy is the strictest one available rather than an allow-list.
    assert "default-src 'none'" in csp
    assert "frame-ancestors 'none'" in csp
    assert "base-uri 'none'" in csp
    assert "max-age=" in resp.headers["Strict-Transport-Security"]
