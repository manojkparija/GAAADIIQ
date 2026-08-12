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
        articles.append(
            Article(
                id=f"live-{index}",
                title=_clean_title(title),
                description=_strip_html(item.findtext("description") or "")[:300],
                url=link,
                # Google News RSS carries no per-article image. The old client
                # read `thumbnail` from the rss2json wrapper, which was empty
                # for this feed too — so the cards were never getting one.
                image=None,
                publishedAt=(item.findtext("pubDate") or "").strip(),
                source=source or "Google News",
            )
        )
    return articles


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

    url = _feed_url(cleaned)
    try:
        async with httpx.AsyncClient(timeout=_FETCH_TIMEOUT, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "GAADIIQ/1.0 (+news)"})
            resp.raise_for_status()
            body = resp.content
    except httpx.HTTPError as exc:
        raise NewsUnavailable(f"could not reach the news feed: {exc}") from exc

    if len(body) > _MAX_FEED_BYTES:
        raise NewsUnavailable("news feed response was implausibly large")

    articles = [asdict(a) for a in _parse(body)][:_MAX_ARTICLES]

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
