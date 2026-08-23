"""
Car news, fetched by the API rather than by the browser.

WHY THIS MOVED SERVER-SIDE

The Reviews & News page used to call api.rss2json.com directly from the
browser, which called Google News. That meant:

  * every visitor's IP and search terms went to a third party the site has no
    agreement with, and which its privacy policy does not mention;
  * the free tier's 10,000 requests a month were shared across all users with
    no API key, so anyone could exhaust the quota and nobody could rotate,
    throttle or even attribute it — the page had been showing "Could not load
    live news" as a result;
  * there was no cache, so one page load meant one third-party call.

Fetching the feed here removes the third party entirely: the API talks to
Google News directly, caches the answer, and serves it to the browser from our
own origin.

NOTHING HERE IS GENERATED

Every headline, link, publisher and timestamp comes from the feed. No model
writes or summarises news copy. A generated summary of a real article is
indistinguishable from a quotation at the point where a reader sees it, and
being confidently wrong about what a manufacturer announced is a way to mislead
someone into a purchase. If AI summaries are ever wanted here, they need to be
visibly labelled as such, not folded into a list that looks like reporting.
"""
import asyncio
import html
import ipaddress
import logging
import re
import time
import urllib.parse
import xml.etree.ElementTree as ElementTree
from dataclasses import asdict, dataclass

import httpx

logger = logging.getLogger("gaadiiq.news_feed")

# Indian English edition. Google News RSS is a public feed and needs no key.
_FEED_URL = "https://news.google.com/rss/search"
_EDITION = {"hl": "en-IN", "gl": "IN", "ceid": "IN:en"}

# What the page asks for when nobody has typed a search.
DEFAULT_QUERY = "India car automobile EV launch"

# Every query is scoped to cars before it reaches Google. Without this, the
# search box on a car site is an open, cached, server-side search proxy for any
# subject at all — which is both a moderation problem and an abuse vector.
_TOPIC_SCOPE = "(car OR automobile OR vehicle OR EV)"

_MAX_QUERY_CHARS = 120
_MAX_ARTICLES = 30
_FETCH_TIMEOUT = 10.0

# Field caps. Feed text is external input and its length is the upstream's
# choice, not ours: without a bound, one item with a megabyte "title" is served
# straight through to every reader of that cached query. The description was
# already truncated at 300; the title was not.
_MAX_TITLE_CHARS = 300
_MAX_SOURCE_CHARS = 120
_MAX_DESCRIPTION_CHARS = 300

# Google News is not a fast-moving wire for our purposes — a used-car buyer does
# not need sub-minute freshness, and this is the difference between one request
# per cache period and one per page load.
_CACHE_TTL_SECONDS = 600
_CACHE_MAX_ENTRIES = 64

# Refuse to parse XML that declares entities. ElementTree does not resolve
# external entities, so this is not about XXE — it is the billion-laughs
# expansion, where a kilobyte of XML inflates to gigabytes in memory. Cheap to
# check, and the feed we expect never contains one.
_ENTITY_DECLARATION = re.compile(rb"<!(?:DOCTYPE|ENTITY)", re.IGNORECASE)

# A feed page is tens of kilobytes. Anything vastly larger is not the feed.
_MAX_FEED_BYTES = 4 * 1024 * 1024

_cache: dict[str, tuple[float, list[dict]]] = {}
_cache_lock = asyncio.Lock()


@dataclass(frozen=True)
class Article:
    id: str
    title: str
    description: str
    url: str
    image: str | None
    publishedAt: str
    source: str


class NewsUnavailable(RuntimeError):
    """The upstream feed could not be reached or understood."""


def clean_query(raw: str | None) -> str:
    """
    Reduce a user's search box input to something safe to put in a feed query.

    Control characters and the operators Google News treats specially are
    dropped rather than escaped: this is a headline search, and someone typing
    `site:` or a boolean into it is either confused or probing.
    """
    if not raw or not raw.strip():
        return DEFAULT_QUERY
    text = raw.strip()[:_MAX_QUERY_CHARS]
    text = "".join(c for c in text if c.isprintable())
    text = re.sub(r'[:"()\[\]{}<>|&]+', " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text or DEFAULT_QUERY


def _feed_url(query: str) -> str:
    scoped = f"{query} {_TOPIC_SCOPE}" if query != DEFAULT_QUERY else query
    params = {"q": scoped, **_EDITION}
    return f"{_FEED_URL}?{urllib.parse.urlencode(params)}"


def _strip_html(value: str) -> str:
    """
    Plain text out of a feed description.

    Google News descriptions are a list of anchor tags. The frontend renders
    this as text, not markup, so the tags are noise — but they are stripped here
    as well so that nothing downstream is tempted to trust them as HTML.
    """
    text = re.sub(r"<[^>]*>", " ", value)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _clean_title(title: str) -> str:
    """Drop the " - Publisher" suffix Google appends, since we show the source."""
    return re.sub(r"\s[-–|]\s[^-–|]+$", "", title).strip()


def _normalise(value: str) -> str:
    """Lower-cased alphanumerics only, for comparing two renderings of a headline."""
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _summary(description: str, title: str, source: str) -> str:
    """
    The description, or nothing when it is only the headline again.

    Google News RSS has no real summary field. Its <description> is an anchor
    tag wrapping the headline, so stripping the markup yields the title back
    with the publisher appended — which rendered every card as its own headline
    printed twice, once bold and once grey.

    Returning "" is the honest outcome: there is no summary to show, and the
    card should be a headline rather than a headline and its own echo. A
    publisher who does supply a real description still gets it.
    """
    cleaned = _strip_html(description)
    if not cleaned:
        return ""

    remainder = cleaned
    # Drop the headline from the front, and the publisher from the end, then
    # see whether anything of substance is left.
    if _normalise(remainder).startswith(_normalise(title)):
        remainder = remainder[len(title):] if remainder[: len(title)] == title else remainder
        if _normalise(remainder) == _normalise(cleaned):
            # The prefix matched only after normalising, so trim by comparison
            # rather than by length — punctuation differs between the two.
            remainder = ""
    if source and _normalise(remainder).endswith(_normalise(source)):
        remainder = remainder[: len(remainder) - len(source)]

    # A dozen characters of leftover punctuation is not a summary.
    return remainder.strip(" -–|·,") if len(_normalise(remainder)) > 12 else ""


def _parse(xml_bytes: bytes) -> list[Article]:
    if _ENTITY_DECLARATION.search(xml_bytes):
        raise NewsUnavailable("feed declared XML entities; refusing to parse")

    try:
        root = ElementTree.fromstring(xml_bytes)
    except ElementTree.ParseError as exc:
        raise NewsUnavailable(f"feed was not valid XML: {exc}") from exc

    articles: list[Article] = []
    for index, item in enumerate(root.iterfind(".//item")):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        if not title or not link:
            continue
        # Only http(s) links are passed to the browser. A feed is external
        # input, and a javascript: URL in an href is a scripting bug waiting
        # for a click.
        if not link.startswith(("http://", "https://")):
            continue

        source = (item.findtext("source") or "").strip()
        clean_title = _clean_title(title)
        articles.append(
            Article(
                id=f"live-{index}",
                title=clean_title[:_MAX_TITLE_CHARS],
                description=_summary(
                    item.findtext("description") or "", clean_title, source
                )[:_MAX_DESCRIPTION_CHARS],
                url=link,
                # Google News RSS carries no per-article image. The old client
                # read `thumbnail` from the rss2json wrapper, which was empty
                # for this feed too — so the cards were never getting one.
                image=None,
                publishedAt=(item.findtext("pubDate") or "").strip(),
                source=(source or "Google News")[:_MAX_SOURCE_CHARS],
            )
        )
    return articles


def _assert_public_url(url: str) -> None:
    """
    Refuse anything that is not an https URL on a public hostname.

    This guards the redirect chain, not the URL we build — that one is a
    constant. `follow_redirects=True` means the upstream chooses where the
    second request goes, and a feed host that is compromised (or simply
    misconfigured) can point it at `http://169.254.169.254/`, the cloud
    metadata endpoint, or at `http://10.x` inside our own network. The
    response body then comes back through this function to the browser, which
    turns a news feed into a read primitive on the private network.

    Hostnames are not resolved here: the check is on the literal host, so a
    name that resolves to a private address still passes. Closing that needs
    resolution pinned to the socket that actually connects, which httpx does
    not expose. This blocks the direct forms, which is what an opportunistic
    redirect uses.
    """
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https":
        raise NewsUnavailable(f"refusing a non-https feed URL ({parsed.scheme or 'no scheme'})")

    host = (parsed.hostname or "").lower()
    if not host:
        raise NewsUnavailable("feed URL had no host")

    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        # A name, not a literal address.
        if host == "localhost" or host.endswith(".localhost") or host.endswith(".internal"):
            raise NewsUnavailable(f"refusing a feed URL pointing at {host}") from None
        return

    if not address.is_global:
        raise NewsUnavailable(f"refusing a feed URL pointing at the non-public address {host}")


async def _download(url: str, headers: dict[str, str] | None = None) -> bytes:
    """
    Fetch a feed, streaming, and stop reading once it exceeds the size cap.

    Streaming is the point. This used to call `resp.content`, which reads the
    whole body into memory and only then compared its length to the cap — so
    the cap described what we would refuse to parse, not what we would refuse
    to receive. An upstream returning a multi-gigabyte body exhausted the
    process before the check ran, and the check itself was what was supposed
    to prevent that. Reading in chunks and aborting mid-body makes the limit
    real.
    """
    _assert_public_url(url)
    request_headers = {"User-Agent": "GAADIIQ/1.0 (+news)", **(headers or {})}

    try:
        async with httpx.AsyncClient(
            timeout=_FETCH_TIMEOUT,
            follow_redirects=True,
            max_redirects=3,
        ) as client:
            async with client.stream("GET", url, headers=request_headers) as resp:
                # Every hop, not just the one we asked for.
                for hop in [*resp.history, resp]:
                    _assert_public_url(str(hop.url))
                resp.raise_for_status()

                chunks: list[bytes] = []
                total = 0
                async for chunk in resp.aiter_bytes():
                    total += len(chunk)
                    if total > _MAX_FEED_BYTES:
                        raise NewsUnavailable("news feed response was implausibly large")
                    chunks.append(chunk)
    except httpx.HTTPError as exc:
        # The message can carry the full URL, and for a keyed provider that URL
        # may hold the key. Report the class of failure, not the request.
        raise NewsUnavailable(f"could not reach the news feed: {type(exc).__name__}") from exc

    return b"".join(chunks)


async def fetch(query: str | None = None, limit: int = 12) -> list[dict]:
    """
    Headlines for `query`, cached, newest first as the feed orders them.

    Raises NewsUnavailable when the feed cannot be fetched or parsed, so the
    caller can say so rather than showing an empty list that looks like "no
    news today".
    """
    cleaned = clean_query(query)
    limit = max(1, min(int(limit or 12), _MAX_ARTICLES))

    async with _cache_lock:
        hit = _cache.get(cleaned)
        if hit and time.monotonic() - hit[0] < _CACHE_TTL_SECONDS:
            return hit[1][:limit]

    # Which upstream answers is a deployment setting, not a code change. Import
    # here rather than at module scope: news_apitube imports names from this
    # module, and a top-level import either way is a cycle.
    from . import news_apitube

    if news_apitube.configured():
        parsed = await news_apitube.fetch(cleaned, _MAX_ARTICLES)
    else:
        parsed = _parse(await _download(_feed_url(cleaned)))

    articles = [asdict(a) for a in parsed][:_MAX_ARTICLES]

    async with _cache_lock:
        if len(_cache) >= _CACHE_MAX_ENTRIES:
            # Oldest first. A plain dict preserves insertion order, and this
            # cache is small enough that an LRU would be more machinery than
            # the problem deserves.
            for key in list(_cache)[: len(_cache) - _CACHE_MAX_ENTRIES + 1]:
                _cache.pop(key, None)
        _cache[cleaned] = (time.monotonic(), articles)

    logger.info("Fetched %d articles for %r", len(articles), cleaned)
    return articles[:limit]


def clear_cache() -> None:
    """Drop cached feeds. For tests, and for an operator who needs a fresh pull."""
    _cache.clear()
