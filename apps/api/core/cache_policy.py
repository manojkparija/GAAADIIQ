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

#: max-age is what a browser keeps; s-maxage is what Cloudflare keeps.
#:
#: They differ on purpose. A browser holding a stale price for five minutes is a
#: user seeing a wrong number with no way to know it; the edge holding one is
#: invisible and purgeable. So the browser gets a minute and the edge gets five,
#: and stale-while-revalidate lets the edge serve the old copy while it fetches
#: a new one — which is what turns a cache into protection against a flood
#: rather than just a latency win.
#:
#: These are low on purpose. The catalogue changes when an admin edits it, and
#: there is no purge hook wired to that yet, so the TTL is the only thing
#: bounding how long an edit stays invisible. Raise it after a purge-on-write
#: exists, not before.
PUBLIC_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=600"

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
