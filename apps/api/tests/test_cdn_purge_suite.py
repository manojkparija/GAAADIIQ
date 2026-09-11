"""
An admin's change clears Cloudflare, so it is visible immediately.

## What this is for

Cloudflare sits in front of api.gaadiiq.com and holds the public catalogue for
s-maxage seconds. That is the point — a flood of buyers collapses onto one
upstream request — and it is also how an edit stays invisible.

cache_policy.py records what that cost: the TTL used to be
`max-age=60, s-maxage=300, stale-while-revalidate=600`, a reload could be
served content fifteen minutes old, and the reports were "photographs uploaded
against a car did not appear" and "models that existed read 0 models
available". Its note is explicit — *raise s-maxage once purge-on-write exists,
not before*. This is that purge, and the TTL moves in the same change.

## Why the trigger is a middleware

Fifteen endpoints change what a buyer sees. A purge call in each is a list
that must stay complete forever, and the one somebody forgets is not a visible
failure — it is a quietly stale page, which is the report this area has
already produced three times. The middleware has no list to keep.

## What these tests pin

The two halves that decide whether this is safe:

  * it fires for a successful catalogue write, and
  * it does NOT fire for a read, a failure, or a write somewhere private.

The second is the one worth having. A purge that runs too often costs a cold
cache; one that runs on a read would throw the zone's cache away on every
request, which is worse than having no cache at all.
"""
import httpx
import pytest

from main import _writes_to_catalogue
from services import cdn_purge


class _Response:
    def __init__(self, status_code=200, body=None, text=""):
        self.status_code = status_code
        self._body = body if body is not None else {"success": True, "errors": []}
        self.text = text or str(self._body)

    def json(self):
        if self._body is _UNPARSEABLE:
            raise ValueError("not json")
        return self._body


_UNPARSEABLE = object()


class _FakeClient:
    """Stands in for httpx.AsyncClient; records the call, returns `response`."""

    calls: list[dict] = []

    def __init__(self, response=None, raises=None):
        self.response = response or _Response()
        self.raises = raises

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, headers=None, json=None):
        _FakeClient.calls.append({"url": url, "headers": headers, "json": json})
        if self.raises:
            raise self.raises
        return self.response


@pytest.fixture(autouse=True)
def _configured(monkeypatch):
    """A token and zone, and no real network, for every test here."""
    monkeypatch.setattr(cdn_purge.settings, "cloudflare_api_token", "test-token", raising=False)
    monkeypatch.setattr(cdn_purge.settings, "cloudflare_zone_id", "test-zone", raising=False)
    _FakeClient.calls = []
    yield
    _FakeClient.calls = []


def _client_returning(response=None, raises=None):
    return lambda *a, **kw: _FakeClient(response=response, raises=raises)


# ── which paths are catalogue writes ────────────────────────────────────────

@pytest.mark.parametrize("path", [
    "/cars",
    "/cars/abc-123",
    "/cars/abc-123/variants/7",
    "/media-admin/upload",
    "/media-admin/vehicle-images/order",
    "/news/42",
    "/upcoming-cars",
    "/video-reviews/9",
])
def test_catalogue_paths_are_recognised(path):
    assert _writes_to_catalogue(path) is True


@pytest.mark.parametrize("path", [
    "/loan-applications",     # carries PAN; nothing about it is cached
    "/listings/abc",          # an advert, not the catalogue prefixes
    "/mechanics",
    "/auth/login",
    "/",
])
def test_other_paths_are_not(path):
    assert _writes_to_catalogue(path) is False


def test_a_lookalike_prefix_does_not_match():
    # Segment-wise, not string-prefix. A future /cars-private must not be
    # treated as the catalogue — the same care cache_policy takes about what
    # it is willing to mark public.
    assert _writes_to_catalogue("/cars-private") is False
    assert _writes_to_catalogue("/newsletter") is False


# ── the purge itself ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_successful_purge_reports_true(monkeypatch):
    monkeypatch.setattr(httpx, "AsyncClient", _client_returning())

    assert await cdn_purge.purge_catalogue("POST /media-admin/upload") is True

    call = _FakeClient.calls[0]
    assert call["url"].endswith("/zones/test-zone/purge_cache")
    assert call["headers"]["Authorization"] == "Bearer test-token"
    # Purge by URL cannot cover /cars — every page, filter and ordering is its
    # own cached entry — and purge by prefix or tag is Enterprise-only.
    assert call["json"] == {"purge_everything": True}


@pytest.mark.asyncio
async def test_nothing_is_attempted_without_configuration(monkeypatch):
    # A developer machine, CI, and any environment not behind Cloudflare. The
    # write must succeed there exactly as it does today.
    monkeypatch.setattr(cdn_purge.settings, "cloudflare_api_token", "", raising=False)
    monkeypatch.setattr(httpx, "AsyncClient", _client_returning())

    assert await cdn_purge.purge_catalogue("POST /cars") is False
    assert _FakeClient.calls == []


@pytest.mark.asyncio
async def test_a_network_failure_is_swallowed(monkeypatch):
    # THE ONE THAT MATTERS MOST. The admin's write is already committed;
    # failing their upload because a cache could not be cleared would be the
    # wrong end of the stick. The stale copy ages out on the TTL regardless.
    monkeypatch.setattr(httpx, "AsyncClient", _client_returning(raises=httpx.ConnectError("down")))

    assert await cdn_purge.purge_catalogue("POST /media-admin/upload") is False


@pytest.mark.asyncio
async def test_a_timeout_is_swallowed(monkeypatch):
    monkeypatch.setattr(
        httpx, "AsyncClient", _client_returning(raises=httpx.ReadTimeout("slow"))
    )

    assert await cdn_purge.purge_catalogue("PATCH /cars/1") is False


@pytest.mark.asyncio
async def test_a_rejected_token_is_not_reported_as_success(monkeypatch):
    # Cloudflare answers 200 with success:false for a bad token or wrong zone,
    # so the status code alone says nothing about whether anything was purged.
    monkeypatch.setattr(httpx, "AsyncClient", _client_returning(
        _Response(200, {"success": False, "errors": [{"code": 1012, "message": "Invalid zone"}]})
    ))

    assert await cdn_purge.purge_catalogue("PATCH /cars/1") is False


@pytest.mark.asyncio
async def test_an_http_error_is_not_reported_as_success(monkeypatch):
    monkeypatch.setattr(httpx, "AsyncClient", _client_returning(
        _Response(403, {"success": False}, text="Forbidden")
    ))

    assert await cdn_purge.purge_catalogue("POST /cars") is False


@pytest.mark.asyncio
async def test_a_non_json_body_is_not_reported_as_success(monkeypatch):
    # A proxy or captive portal answering 200 with HTML.
    monkeypatch.setattr(httpx, "AsyncClient", _client_returning(_Response(200, _UNPARSEABLE)))

    assert await cdn_purge.purge_catalogue("POST /cars") is False


def test_is_configured_needs_both_halves(monkeypatch):
    monkeypatch.setattr(cdn_purge.settings, "cloudflare_zone_id", "", raising=False)
    assert cdn_purge.is_configured() is False

    monkeypatch.setattr(cdn_purge.settings, "cloudflare_zone_id", "z", raising=False)
    monkeypatch.setattr(cdn_purge.settings, "cloudflare_api_token", "", raising=False)
    assert cdn_purge.is_configured() is False
