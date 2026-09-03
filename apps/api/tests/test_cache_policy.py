"""What a shared cache is allowed to keep.

Two failures are being guarded against, and the second is the serious one:

1. Nothing cacheable — every catalogue read crosses the Pacific and hits the
   database, and the proxy in front of the origin buys latency only.
2. Something private cached — a loan application or a mechanic's record kept by
   an intermediary because the response said nothing either way. A response
   with no Cache-Control is not private; it is undefined, and HTTP permits a
   shared cache to apply heuristics to it.

The deny-by-default assertions below are therefore not symmetry for its own
sake. They are the half of this that fails closed.
"""
import pytest
from httpx import ASGITransport, AsyncClient
from starlette.datastructures import Headers
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from core.cache_policy import (
    PRIVATE_CACHE_CONTROL,
    PUBLIC_CACHE_CONTROL,
    apply_cache_policy,
    cache_directive,
)
from main import app


def _request(path: str, method: str = "GET", headers: dict | None = None) -> Request:
    raw = Headers(headers or {}).raw
    return Request(
        {
            "type": "http",
            "method": method,
            "path": path,
            "raw_path": path.encode(),
            "query_string": b"",
            "headers": raw,
            "scheme": "https",
            "server": ("api.gaadiiq.com", 443),
        }
    )


def _response(status: int = 200) -> Response:
    return JSONResponse(status_code=status, content={})


@pytest.mark.parametrize(
    "path",
    [
        "/cars",
        "/cars/catalogue/options",
        "/cars/8f14e45f-ceea-467a-9a3a-1a3b1cd8e2a1",
        "/cars/8f14e45f-ceea-467a-9a3a-1a3b1cd8e2a1/variants",
        "/upcoming-cars",
        "/news",
        "/video-reviews",
    ],
)
def test_catalogue_reads_are_cacheable(path):
    assert cache_directive(_request(path), _response()) == PUBLIC_CACHE_CONTROL


@pytest.mark.parametrize(
    "path",
    [
        "/loans/applications",
        "/mechanics",
        "/auth/me",
        "/admin/users",
        "/diagnosis/history",
        "/payments/orders",
        "/subscriptions",
        "/leads",
        "/service-requests",
        "/reviews",
        "/ev-charging/stations",
    ],
)
def test_everything_else_is_no_store(path):
    """Deny by default. These are the paths where being wrong is a disclosure.

    /reviews and /ev-charging are in this list rather than the one above because
    they were considered for the allowlist and deliberately left out — the first
    is close to user-generated, the second takes the caller's coordinates. If a
    later change adds either prefix, this test is where that decision surfaces.
    """
    assert cache_directive(_request(path), _response()) == PRIVATE_CACHE_CONTROL


def test_a_lookalike_prefix_does_not_inherit_the_policy():
    # "/cars-internal".startswith("/cars") is true, and a naive prefix check
    # would have published a whole router on the strength of its name.
    assert cache_directive(_request("/cars-internal"), _response()) == PRIVATE_CACHE_CONTROL
    assert cache_directive(_request("/cars-private/secrets"), _response()) == PRIVATE_CACHE_CONTROL


@pytest.mark.parametrize("method", ["POST", "PATCH", "DELETE", "PUT", "HEAD"])
def test_only_get_is_cacheable(method):
    # /cars accepts POST and PATCH from admins. Same prefix, same allowlist
    # entry, and the response must not be shared.
    assert cache_directive(_request("/cars", method=method), _response()) == PRIVATE_CACHE_CONTROL


@pytest.mark.parametrize("status", [201, 204, 304, 400, 401, 403, 404, 429, 500, 503])
def test_only_200_is_cacheable(status):
    # A 500 held at the edge for five minutes outlives the fault that caused it,
    # and a 429 held there keeps rate-limiting a caller who has stopped.
    assert cache_directive(_request("/cars"), _response(status)) == PRIVATE_CACHE_CONTROL


def test_an_authenticated_read_is_never_shared():
    """The condition that protects against a handler changing under us.

    Nothing under /cars varies by caller today. That is a fact about the current
    handlers, not a guarantee — and if one starts returning more to an admin,
    the failure without this check is one user's response served to another.
    """
    req = _request("/cars", headers={"Authorization": "Bearer token"})
    assert cache_directive(req, _response()) == PRIVATE_CACHE_CONTROL


def test_a_handler_that_set_its_own_header_keeps_it():
    # brochures.py serves an immutable asset with a one-year max-age and
    # recommend.py sets no-cache. Both know more than a path prefix does.
    resp = _response()
    resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    apply_cache_policy(_request("/brochures/x.pdf"), resp)
    assert resp.headers["Cache-Control"] == "public, max-age=31536000, immutable"


def test_cacheable_responses_vary_on_origin():
    """Without this, a cache can serve one origin's CORS response to another.

    CORSMiddleware runs with allow_credentials=True, so Access-Control-Allow-Origin
    carries the specific requesting origin rather than "*" — which makes the
    response origin-dependent whether or not anything says so.
    """
    resp = _response()
    apply_cache_policy(_request("/cars"), resp)
    assert "origin" in resp.headers["Vary"].lower()


def test_vary_does_not_lose_what_was_already_there():
    resp = _response()
    resp.headers["Vary"] = "Accept-Encoding"
    apply_cache_policy(_request("/cars"), resp)
    vary = resp.headers["Vary"].lower()
    assert "accept-encoding" in vary and "origin" in vary


def test_origin_is_not_appended_twice():
    resp = _response()
    resp.headers["Vary"] = "Origin"
    apply_cache_policy(_request("/cars"), resp)
    assert resp.headers["Vary"].lower().count("origin") == 1


def test_the_public_directive_separates_browser_and_edge_lifetimes():
    """s-maxage exists so the edge can hold longer than the browser.

    A browser holding a stale price is a user seeing a wrong number with no way
    to know it; the edge holding one is invisible and purgeable. If these ever
    collapse to a single max-age, that distinction is gone.
    """
    assert "s-maxage=" in PUBLIC_CACHE_CONTROL
    assert "max-age=60" in PUBLIC_CACHE_CONTROL
    assert "stale-while-revalidate=" in PUBLIC_CACHE_CONTROL


def test_private_is_no_store_not_no_cache():
    # no-cache permits storing the response and revalidating it, which still
    # means a copy of a loan application exists in a cache we do not control.
    assert PRIVATE_CACHE_CONTROL == "no-store"


@pytest.mark.asyncio
async def test_the_middleware_is_actually_wired():
    """Everything above tests the policy. This tests that it runs.

    The distinction matters: a correct cache_policy.py that main.py never calls
    passes every other test in this file and ships an API with no Cache-Control
    on anything — which is the exact state this change exists to leave behind.
    /health is used because it needs no database and sits outside the allowlist,
    so it also demonstrates the deny-by-default arm end to end.
    """
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        resp = await c.get("/health")

    assert resp.headers["Cache-Control"] == PRIVATE_CACHE_CONTROL
