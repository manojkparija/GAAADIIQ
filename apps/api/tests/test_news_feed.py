"""
Tests for server-side news fetching.

The feed itself is fetched from Google News, which this test environment cannot
reach, so the network call is stubbed and the fixture below is shaped like a
real Google News RSS response — same element names, same " - Publisher" title
suffix, same anchor-tag description. What is asserted here is our handling of
that shape and of input we would rather not trust.
"""
import asyncio

import httpx
import pytest

from services import news_feed

# Trimmed from a real Google News RSS response for an Indian car query.
FEED = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>India car - Google News</title>
  <item>
    <title>Tata Punch EV facelift spied testing - Autocar India</title>
    <link>https://news.google.com/rss/articles/CBMiA1</link>
    <pubDate>Tue, 11 Aug 2026 09:12:00 GMT</pubDate>
    <description>&lt;a href="https://autocarindia.com/x"&gt;Tata Punch EV facelift&lt;/a&gt;
      &amp;nbsp;&lt;font&gt;Autocar India&lt;/font&gt;</description>
    <source url="https://autocarindia.com">Autocar India</source>
  </item>
  <item>
    <title>Maruti to launch new hybrid SUV in 2027 | Economic Times</title>
    <link>https://news.google.com/rss/articles/CBMiA2</link>
    <pubDate>Tue, 11 Aug 2026 06:00:00 GMT</pubDate>
    <description>&lt;a href="https://et.com/y"&gt;Maruti hybrid SUV&lt;/a&gt;</description>
    <source url="https://et.com">Economic Times</source>
  </item>
</channel></rss>"""


def _stub_get(monkeypatch, *, body=FEED, status_code=200, seen=None):
    class FakeResponse:
        content = body
        status_code_ = status_code

        def raise_for_status(self):
            if status_code >= 400:
                raise httpx.HTTPStatusError("boom", request=None, response=None)

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url, **kwargs):
            if seen is not None:
                seen.append(url)
            return FakeResponse()

    monkeypatch.setattr(news_feed.httpx, "AsyncClient", lambda **kw: FakeClient())


@pytest.fixture(autouse=True)
def _clear_cache():
    news_feed.clear_cache()
    yield
    news_feed.clear_cache()


@pytest.mark.asyncio
async def test_real_headlines_are_parsed_with_publisher_and_link(monkeypatch):
    _stub_get(monkeypatch)

    articles = await news_feed.fetch("Tata Punch", 10)

    assert len(articles) == 2
    first = articles[0]
    # The " - Autocar India" suffix goes, because the publisher is shown
    # separately; keeping both prints the name twice on every card.
    assert first["title"] == "Tata Punch EV facelift spied testing"
    assert first["source"] == "Autocar India"
    assert first["url"] == "https://news.google.com/rss/articles/CBMiA1"
    assert first["publishedAt"] == "Tue, 11 Aug 2026 09:12:00 GMT"
    # Description arrives as anchor tags; the page renders text.
    assert "<a" not in first["description"]
    assert "Tata Punch EV facelift" in first["description"]


@pytest.mark.asyncio
async def test_a_description_that_is_only_the_headline_again_is_dropped(monkeypatch):
    """
    Google News has no real summary field.

    Its <description> is an anchor tag wrapping the headline, so stripping the
    markup gives the title back with the publisher appended. In production every
    card rendered as its own headline printed twice — once bold, once grey.
    Returning nothing is the honest answer: there is no summary to show.
    """
    echo = (
        b"<rss><channel><item>"
        b"<title>Tata Motors to Launch 3 New Cars This Calendar Year - CarLelo</title>"
        b"<link>https://example.com/a</link>"
        b'<description>&lt;a href="https://carlelo.com/x"&gt;Tata Motors to Launch 3 New '
        b"Cars This Calendar Year&lt;/a&gt;&amp;nbsp;&lt;font&gt;CarLelo&lt;/font&gt;</description>"
        b"<source url='https://carlelo.com'>CarLelo</source>"
        b"</item></channel></rss>"
    )
    _stub_get(monkeypatch, body=echo)

    articles = await news_feed.fetch("q")

    assert articles[0]["title"] == "Tata Motors to Launch 3 New Cars This Calendar Year"
    assert articles[0]["description"] == ""


@pytest.mark.asyncio
async def test_a_real_summary_is_kept(monkeypatch):
    """A publisher that does supply prose must not lose it to the echo check."""
    real = (
        b"<rss><channel><item>"
        b"<title>Tata Punch EV facelift spied - Autocar India</title>"
        b"<link>https://example.com/b</link>"
        b'<description>&lt;a href="https://x"&gt;Tata Punch EV facelift spied&lt;/a&gt; '
        b"Tata has been testing a facelifted Punch EV with a larger battery pack and a "
        b"revised front fascia.&amp;nbsp;&lt;font&gt;Autocar India&lt;/font&gt;</description>"
        b"<source url='https://autocarindia.com'>Autocar India</source>"
        b"</item></channel></rss>"
    )
    _stub_get(monkeypatch, body=real)

    articles = await news_feed.fetch("q")

    assert "larger battery pack" in articles[0]["description"]
    assert "<" not in articles[0]["description"]


@pytest.mark.asyncio
async def test_a_feed_declaring_entities_is_refused(monkeypatch):
    """
    Billion laughs: a kilobyte of XML that expands to gigabytes in memory.

    ElementTree does not resolve external entities, so this is not XXE — it is
    the expansion, and refusing the declaration outright is cheaper than
    bounding it.
    """
    bomb = (
        b'<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">'
        b'<!ENTITY lol2 "&lol;&lol;&lol;">]><rss><channel>'
        b"<item><title>&lol2;</title><link>https://x/y</link></item>"
        b"</channel></rss>"
    )
    _stub_get(monkeypatch, body=bomb)

    with pytest.raises(news_feed.NewsUnavailable, match="entities"):
        await news_feed.fetch("anything")


@pytest.mark.asyncio
async def test_non_http_links_are_dropped(monkeypatch):
    """A javascript: URL in a feed is a scripting bug waiting for a click."""
    hostile = (
        b"<rss><channel>"
        b"<item><title>Bad</title><link>javascript:alert(1)</link></item>"
        b"<item><title>Good - Pub</title><link>https://example.com/ok</link></item>"
        b"</channel></rss>"
    )
    _stub_get(monkeypatch, body=hostile)

    articles = await news_feed.fetch("q")

    assert [a["url"] for a in articles] == ["https://example.com/ok"]


@pytest.mark.asyncio
async def test_search_terms_are_scoped_to_cars(monkeypatch):
    """
    Without scoping, the search box is an open server-side search proxy.

    It is a car site; a query for anything else is either a mistake or someone
    using our cache and our IP to search for something we would rather not be
    fetching.
    """
    seen: list[str] = []
    _stub_get(monkeypatch, seen=seen)

    await news_feed.fetch("election results")

    assert "car+OR+automobile" in seen[0] or "car%20OR%20automobile" in seen[0]


@pytest.mark.asyncio
async def test_query_operators_are_stripped(monkeypatch):
    seen: list[str] = []
    _stub_get(monkeypatch, seen=seen)

    await news_feed.fetch('site:evil.test "exact" (a|b)')

    assert "site%3A" not in seen[0]
    assert news_feed.clean_query('site:evil.test "x"') == "site evil.test x"


def test_blank_and_overlong_queries_are_handled():
    assert news_feed.clean_query("") == news_feed.DEFAULT_QUERY
    assert news_feed.clean_query("   ") == news_feed.DEFAULT_QUERY
    assert news_feed.clean_query(None) == news_feed.DEFAULT_QUERY
    assert len(news_feed.clean_query("x" * 500)) <= 120


@pytest.mark.asyncio
async def test_repeat_queries_are_served_from_cache(monkeypatch):
    """One fetch per query per TTL, not one per page load."""
    seen: list[str] = []
    _stub_get(monkeypatch, seen=seen)

    await news_feed.fetch("Punch")
    await news_feed.fetch("Punch")

    assert len(seen) == 1


@pytest.mark.asyncio
async def test_limit_is_bounded_and_applied(monkeypatch):
    _stub_get(monkeypatch)
    assert len(await news_feed.fetch("q", 1)) == 1
    news_feed.clear_cache()
    # Above the cap, and below the floor, both land inside the allowed range.
    assert len(await news_feed.fetch("q", 999)) == 2


@pytest.mark.asyncio
async def test_an_unreachable_feed_raises_rather_than_looking_empty(monkeypatch):
    """
    An empty list reads as "no news today", which is a different claim.

    The page has curated articles to fall back on, but only if it is told the
    live fetch failed.
    """
    _stub_get(monkeypatch, status_code=503)

    with pytest.raises(news_feed.NewsUnavailable):
        await news_feed.fetch("q")


@pytest.mark.asyncio
async def test_malformed_xml_raises_news_unavailable(monkeypatch):
    _stub_get(monkeypatch, body=b"<rss><channel><item></broken>")

    with pytest.raises(news_feed.NewsUnavailable):
        await news_feed.fetch("q")


@pytest.mark.asyncio
async def test_concurrent_fetches_do_not_corrupt_the_cache(monkeypatch):
    _stub_get(monkeypatch)

    results = await asyncio.gather(*(news_feed.fetch(f"q{i}") for i in range(5)))

    assert all(len(r) == 2 for r in results)


# ── The endpoint ──────────────────────────────────────────────────────────────


async def _client():
    from httpx import ASGITransport, AsyncClient

    from main import app

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _stub_fetch(monkeypatch, result=None, raises=None):
    """
    Stub the service, not httpx.

    `_stub_get` replaces httpx.AsyncClient on the shared module object, which
    the ASGI test client is also built from — patching it here would hijack the
    test's own requests as well as the feed's.
    """

    async def fake_fetch(query=None, limit=12):
        if raises is not None:
            raise raises
        return (result or [])[:limit]

    monkeypatch.setattr(news_feed, "fetch", fake_fetch)


_ARTICLES = [
    {
        "id": "live-0",
        "title": "Tata Punch EV facelift spied testing",
        "description": "Tata Punch EV facelift",
        "url": "https://news.google.com/rss/articles/CBMiA1",
        "image": None,
        "publishedAt": "Tue, 11 Aug 2026 09:12:00 GMT",
        "source": "Autocar India",
    },
    {
        "id": "live-1",
        "title": "Maruti to launch new hybrid SUV in 2027",
        "description": "Maruti hybrid SUV",
        "url": "https://news.google.com/rss/articles/CBMiA2",
        "image": None,
        "publishedAt": "Tue, 11 Aug 2026 06:00:00 GMT",
        "source": "Economic Times",
    },
]


@pytest.mark.asyncio
async def test_endpoint_returns_articles_without_a_token(monkeypatch):
    """
    Readable signed-out on purpose.

    Requiring a token to read headlines would only push the page back to
    calling a third party from the browser, which is what this replaced.
    """
    _stub_fetch(monkeypatch, _ARTICLES)

    async with await _client() as c:
        resp = await c.get("/news", params={"q": "Punch", "limit": 2})

    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 2
    assert body["articles"][0]["source"] == "Autocar India"
    assert body["articles"][0]["url"].startswith("https://")


@pytest.mark.asyncio
async def test_endpoint_reports_an_unreachable_feed_as_503(monkeypatch):
    """503, not 500: upstream being down is temporary and the page can cope."""
    _stub_fetch(monkeypatch, raises=news_feed.NewsUnavailable("upstream down"))

    async with await _client() as c:
        resp = await c.get("/news")

    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_endpoint_rejects_an_out_of_range_limit(monkeypatch):
    _stub_fetch(monkeypatch, _ARTICLES)

    async with await _client() as c:
        assert (await c.get("/news", params={"limit": 500})).status_code == 422
        assert (await c.get("/news", params={"limit": 0})).status_code == 422
