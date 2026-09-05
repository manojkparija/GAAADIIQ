"""What Cloudflare — or any intermediary — is allowed to keep a copy of.

WHY THIS EXISTS

Until now no response from this API carried a Cache-Control header, with two
exceptions (a brochure download, and one no-cache on /recommend). That has a
consequence in each direction, and both are live now that a proxy sits in front
of the origin:

1. NOTHING IS CACHED. Cloudflare does not cache an uncacheable-looking API
   response by default, so every catalogue read — the cheapest request for an
   attacker to find and one of the more expensive for us to serve, since each
   is a database round trip — travels the full distance to Oregon and back.

2. NOTHING IS FORBIDDEN FROM BEING CACHED EITHER. A response with no
   Cache-Control is not "private" — it is undefined, and HTTP lets a shared
   cache apply its own heuristics to it. That is the wrong default for an API
   whose responses include loan applications, masked PANs and a mechanic's
   address, and it is the half of this file that matters more.

So the policy is an allowlist and a deny-by-default, not a set of TTLs:

    public, read-only, non-personalised GET  ->  cacheable, short
    everything else                          ->  no-store

DELIBERATELY NARROW

The allowlist is four prefixes of catalogue content, not everything that
happens to be a public GET. A path earns a place here by being the same for
every caller — that is the property that makes a shared cache safe, and it is
not implied by "does not require a token". /ev-charging and /reviews were
considered and left out: the first takes the caller's coordinates in the query
string, and the second is close enough to user-generated that a wrong answer
there is a disclosure rather than a stale price.

Widening this list is a security decision. Read the four conditions in
`cache_directive` before adding a prefix.
"""

from starlette.requests import Request
from starlette.responses import Response

#: Path prefixes whose GET responses are identical for every caller.
#:
#: Matched as path segments, not as raw string prefixes: "/cars" must not admit
#: a future "/cars-private". See `_prefix_matches`.
CACHEABLE_PREFIXES: tuple[str, ...] = (
    "/cars",
    "/upcoming-cars",
    "/news",
    "/video-reviews",
)

#: The browser revalidates every time; the edge absorbs the load.
#:
#: WHY THIS CHANGED
#:
#: This was `public, max-age=60, s-maxage=300, stale-while-revalidate=600`, and
#: that combination is why the catalogue had to be hard-refreshed to show a
#: change. A normal reload could be served a copy up to fifteen minutes old —
#: sixty seconds from the browser's own cache, five minutes from the edge, and
#: ten more from stale-while-revalidate handing over the old copy while it
#: fetched a new one behind the reader. A hard refresh sends
#: `Cache-Control: no-cache`, which skips both, which is why THAT always worked
#: and nothing else did.
#:
#: Reported repeatedly from the live site: photographs uploaded against a car
#: did not appear, models that existed read "0 models available", and a hard
#: refresh fixed it every time. The note below already predicted this — there
#: is still no purge hook, so the TTL was the only thing bounding how long an
#: edit stayed invisible. The TTL was simply too long to live with.
#:
#: WHAT IT DOES NOW
#:
#: `max-age=0, must-revalidate` means the browser may keep the response but has
#: to ask before reusing it. That ask is conditional: unchanged content comes
#: back as a 304 with no body, so this is much cheaper than it looks and the
#: reader never sees a stale catalogue.
#:
#: `s-maxage=30` keeps the edge in front of the origin, which is the half that
#: actually protects the API — a flood still collapses onto one upstream
#: request per half-minute. Thirty seconds is short enough that an admin edit
#: appears while they are still looking at the page.
#:
#: stale-while-revalidate is gone entirely. It is the one directive that serves
#: content already known to be out of date, and correctness of what a buyer
#: sees is worth more here than the latency it saved.
#:
#: The browser/edge distinction the old comment defended is intact, and in the
#: same direction: the browser holds nothing, the edge holds longer. Raise
#: s-maxage once purge-on-write exists, not before.
PUBLIC_CACHE_CONTROL = "public, max-age=0, must-revalidate, s-maxage=30"

#: Everything else. no-store rather than no-cache: no-cache permits storing the
#: response and revalidating it, which still means a copy of a loan application
#: exists in a cache we do not control.
PRIVATE_CACHE_CONTROL = "no-store"


def _prefix_matches(path: str, prefix: str) -> bool:
    """True when `path` is `prefix` itself or a segment below it.

    A plain `startswith` would let "/cars-internal" inherit the policy written
    for "/cars" — a whole router made publicly cacheable by its name alone.
    """
    return path == prefix or path.startswith(prefix + "/")


def cache_directive(request: Request, response: Response) -> str:
    """The Cache-Control value this response should carry.

    Four conditions, all of which must hold for a response to be cacheable:

    1. The method is GET. POST bodies are not idempotent and HEAD carries no
       body worth keeping.
    2. The status is 200. A 404 or a 500 cached at the edge for five minutes
       outlives the fault that caused it.
    3. The request carried no Authorization header. Nothing in the allowlist
       currently varies by caller, but that is a fact about today's handlers,
       not a guarantee — and the failure mode if it ever stops being true is
       one user's response served to another.
    4. The path is in CACHEABLE_PREFIXES.
    """
    if request.method != "GET":
        return PRIVATE_CACHE_CONTROL
    if response.status_code != 200:
        return PRIVATE_CACHE_CONTROL
    if request.headers.get("Authorization"):
        return PRIVATE_CACHE_CONTROL

    path = request.url.path
    if any(_prefix_matches(path, p) for p in CACHEABLE_PREFIXES):
        return PUBLIC_CACHE_CONTROL
    return PRIVATE_CACHE_CONTROL


def apply_cache_policy(request: Request, response: Response) -> None:
    """Set Cache-Control, unless the handler already decided for itself.

    The handler wins. Two already set their own and both are more informed than
    a path prefix can be: brochures.py serves an immutable asset with a one-year
    max-age, and recommend.py marks its output no-cache. Overwriting either from
    here would be this middleware second-guessing the endpoint that knows what
    it returned.
    """
    if "Cache-Control" in response.headers:
        return

    response.headers["Cache-Control"] = cache_directive(request, response)

    # Origin is part of the cache key, because it is part of the response.
    #
    # CORSMiddleware runs with allow_credentials=True, so it echoes the specific
    # requesting origin into Access-Control-Allow-Origin rather than "*". A
    # shared cache that ignored Origin could therefore hand a response stamped
    # for one origin to a browser on another, which that browser would then
    # refuse — a CORS error appearing on a fraction of requests with nothing in
    # the code to explain it.
    #
    # Starlette's CORSMiddleware appends Vary: Origin itself on that setting.
    # This is belt-and-braces, and cheap: the header is only meaningful on the
    # responses a cache will actually keep.
    existing = response.headers.get("Vary", "")
    parts = [v.strip() for v in existing.split(",") if v.strip()]
    if not any(v.lower() == "origin" for v in parts):
        parts.append("Origin")
        response.headers["Vary"] = ", ".join(parts)
