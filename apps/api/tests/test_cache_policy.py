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
    CACHEABLE_PREFIXES,
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
    assert "max-age=0" in PUBLIC_CACHE_CONTROL


def test_the_reader_is_never_served_a_knowingly_stale_catalogue():
    """No directive here may hand over content already known to be out of date.

    THE BUG THIS ENCODES

    The public directive was `max-age=60, s-maxage=300,
    stale-while-revalidate=600`. A normal reload could therefore be answered
    with a copy up to fifteen minutes old, and stale-while-revalidate is the
    part that does it deliberately: it serves the expired copy and refreshes
    behind the reader, so the fresh data lands on the NEXT visit.

    Reported from the live site over and over: uploaded photographs did not
    appear, real models read "0 models available", and a hard refresh fixed it
    every single time — because a hard refresh sends `Cache-Control: no-cache`
    and skips the caches this directive fills.

    Purge-on-write now exists (services/cdn_purge.py, fired from a middleware
    in main.py), so an edit no longer waits out a TTL. That changed what
    s-maxage is for — see the test below — but not this: stale-while-revalidate
    serves a copy ALREADY KNOWN to be out of date, which no purge can undo,
    because the reader is handed the old bytes before the refresh happens.
    """
    assert "stale-while-revalidate" not in PUBLIC_CACHE_CONTROL

    # must-revalidate is the other half: without it a browser is permitted to
    # reuse an expired response when it thinks it is offline or under load.
    assert "must-revalidate" in PUBLIC_CACHE_CONTROL


def test_a_long_edge_window_is_paid_for_by_purge_on_write():
    """s-maxage may only be long while something clears the edge on a write.

    This test used to assert `edge <= 60`, and said why: with no purge hook,
    s-maxage WAS the wait between saving a car and seeing it, so thirty seconds
    was the most that could look immediate. Its closing line was "if someone
    raises it, purge-on-write should exist first."

    It does — services/cdn_purge.py, fired from a middleware in main.py after
    any successful write under a catalogue prefix. So the number was raised to
    an hour, and the edge is now a real cache rather than a bound on how long a
    mistake stays visible.

    The protection is kept rather than deleted, and re-pointed at the thing the
    long window depends on. Delete the purge and this fails, which is the point:
    the two only make sense together, and a future change that removes the purge
    while leaving an hour on the edge would recreate the fifteen-minute-stale
    catalogue this file exists to describe.
    """
    edge = int(PUBLIC_CACHE_CONTROL.split("s-maxage=")[1].split(",")[0].strip())
    if edge <= 60:
        return  # Short enough to need no purge, as it was before.

    from main import _cdn_purge_middleware, _writes_to_catalogue
    from services import cdn_purge

    assert callable(cdn_purge.purge_catalogue), (
        f"s-maxage={edge}s without a purge is how an edit stays invisible"
    )
    assert callable(_cdn_purge_middleware)
    # The prefixes it purges for have to cover the ones being cached, or a
    # write to a cached area would leave the edge holding the old answer.
    for prefix in CACHEABLE_PREFIXES:
        assert _writes_to_catalogue(prefix), f"{prefix} is cached but never purged"


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


def test_image_search_is_cacheable():
    """The busiest read on the site, and until now the only one left uncached.

    /cars was served from the edge while the endpoint behind every image on
    every one of those same pages went to the origin on every request.
    """
    assert cache_directive(_request("/brochures/images"), _response()) == PUBLIC_CACHE_CONTROL
    assert cache_directive(
        _request("/brochures/images?make=Maruti&model=Swift"), _response()
    ) == PUBLIC_CACHE_CONTROL


def test_the_rest_of_the_brochures_router_is_not_cacheable():
    """Only the one path was allowlisted, not the router it lives in.

    /brochures/jobs is admin-only PDF ingestion history. It would also be
    caught by the Authorization condition, but that is a second line: the
    allowlist itself must not claim a whole router is public because one route
    on it is.
    """
    assert cache_directive(_request("/brochures"), _response()) == PRIVATE_CACHE_CONTROL
    assert cache_directive(_request("/brochures/jobs"), _response()) == PRIVATE_CACHE_CONTROL
    assert cache_directive(
        _request("/brochures/jobs/8f14e45f-ceea-467a-9a3a-1a3b1cd8e2a1"), _response()
    ) == PRIVATE_CACHE_CONTROL
