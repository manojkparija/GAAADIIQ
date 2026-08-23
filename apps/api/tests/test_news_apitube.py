"""
APITube as a news source.

The provider is a third party like any other, so what is asserted here is the
boundary around it: that its key stays server-side, that nothing it returns is
trusted as a URL without checking the scheme, and that a malformed response
degrades rather than raising into the page.
"""
import asyncio
import json

import pytest

from core.config import settings
from services import news_apitube, news_feed


@pytest.fixture(autouse=True)
def _clear_cache():
    news_feed.clear_cache()
    yield
    news_feed.clear_cache()


@pytest.fixture
def apitube_selected(monkeypatch):
    monkeypatch.setattr(settings, "news_provider", "apitube")
    monkeypatch.setattr(settings, "apitube_api_key", "api_live_TESTKEY")


def _stub(monkeypatch, payload, *, captured=None):
    body = json.dumps(payload).encode()

    async def fake_download(url, headers=None):
        if captured is not None:
            captured["url"] = url
            captured["headers"] = headers or {}
        return body

    monkeypatch.setattr(news_apitube, "_download", fake_download)


# ── Configuration ────────────────────────────────────────────────────────────


def test_apitube_is_off_unless_selected_and_keyed(monkeypatch):
    monkeypatch.setattr(settings, "news_provider", "google")
    monkeypatch.setattr(settings, "apitube_api_key", "api_live_TESTKEY")
    assert not news_apitube.configured()

    # Selected but unkeyed must not silently fall through to an unauthenticated
    # request — it would 401 on every page load and look like an outage.
    monkeypatch.setattr(settings, "news_provider", "apitube")
    monkeypatch.setattr(settings, "apitube_api_key", "")
    assert not news_apitube.configured()

    monkeypatch.setattr(settings, "apitube_api_key", "api_live_TESTKEY")
    assert news_apitube.configured()


def test_the_key_travels_in_a_header_not_the_query_string(monkeypatch, apitube_selected):
    """
    Query strings reach access logs, proxy logs and Referer headers; a header
    does not. This is also why an exception must not carry the URL.
    """
    captured: dict = {}
    _stub(monkeypatch, {"results": []}, captured=captured)

    asyncio.run(news_apitube.fetch("india car", 10))

    assert "api_live_TESTKEY" not in captured["url"]
    assert captured["headers"].get("X-API-Key") == "api_live_TESTKEY"


# ── Untrusted response handling ──────────────────────────────────────────────


def test_non_https_links_are_dropped(monkeypatch, apitube_selected):
    """
    A link field decides where a click goes. javascript: in an href is a
    scripting bug waiting for a reader; http:// is a downgrade we have no
    reason to pass on. An item without a usable link is skipped entirely.
    """
    _stub(monkeypatch, {"results": [
        {"title": "js scheme", "href": "javascript:alert(1)"},
        {"title": "data scheme", "href": "data:text/html,<script>x</script>"},
        {"title": "plain http", "href": "http://example.com/a"},
        {"title": "fine", "href": "https://example.com/b"},
    ]})

    articles = asyncio.run(news_apitube.fetch("india car", 10))

    assert [a.title for a in articles] == ["fine"]
    assert all(a.url.startswith("https://") for a in articles)


def test_a_hostile_image_url_does_not_survive(monkeypatch, apitube_selected):
    """
    The thumbnail becomes a CSS background-image. A value that is not a plain
    https URL becomes None and the card falls back to its icon.
    """
    _stub(monkeypatch, {"results": [
        {"title": "a", "href": "https://example.com/a",
         "image": "javascript:alert(1)"},
        {"title": "b", "href": "https://example.com/b",
         "image": "https://cdn.example.com/x.jpg"},
    ]})

    articles = asyncio.run(news_apitube.fetch("india car", 10))

    assert articles[0].image is None
    assert articles[1].image == "https://cdn.example.com/x.jpg"


def test_markup_in_a_summary_is_stripped(monkeypatch, apitube_selected):
    _stub(monkeypatch, {"results": [{
        "title": "Nexon <script>alert(1)</script> review",
        "href": "https://example.com/a",
        "description": "<img src=x onerror=alert(1)>Real summary text here.",
    }]})

    article = asyncio.run(news_apitube.fetch("india car", 10))[0]

    for field in (article.title, article.description):
        assert "<" not in field and ">" not in field
    assert "Real summary text here." in article.description


def test_oversized_fields_are_capped(monkeypatch, apitube_selected):
    _stub(monkeypatch, {"results": [{
        "title": "A" * 9000,
        "href": "https://example.com/a",
        "description": "B" * 9000,
        "source": "C" * 9000,
    }]})

    article = asyncio.run(news_apitube.fetch("india car", 10))[0]

    assert len(article.title) <= news_feed._MAX_TITLE_CHARS
    assert len(article.description) <= news_feed._MAX_DESCRIPTION_CHARS
    assert len(article.source) <= news_feed._MAX_SOURCE_CHARS


def test_a_shape_change_degrades_one_field_rather_than_raising(monkeypatch, apitube_selected):
    """
    Providers move fields between releases. `source` as an object instead of a
    string should cost us the publisher name at worst, not the whole page.
    """
    _stub(monkeypatch, {"results": [{
        "title": "a", "href": "https://example.com/a",
        "source": {"name": "Autocar India"},
    }, {
        "title": "b", "href": "https://example.com/b",
        "source": 12345,
    }]})

    articles = asyncio.run(news_apitube.fetch("india car", 10))

    assert articles[0].source == "Autocar India"
    assert articles[1].source == "APITube"


def test_junk_entries_are_skipped_not_rendered(monkeypatch, apitube_selected):
    _stub(monkeypatch, {"results": [
        "not an object",
        None,
        {"no_title": True, "href": "https://example.com/a"},
        {"title": "real", "href": "https://example.com/b"},
    ]})

    articles = asyncio.run(news_apitube.fetch("india car", 10))
    assert [a.title for a in articles] == ["real"]


def test_a_response_without_an_article_list_raises(monkeypatch, apitube_selected):
    """
    Distinct from "no results". An unreadable response must not render as an
    empty page that reads like "no news today".
    """
    _stub(monkeypatch, {"error": "quota exceeded"})

    with pytest.raises(news_feed.NewsUnavailable):
        asyncio.run(news_apitube.fetch("india car", 10))


def test_invalid_json_raises_rather_than_returning_empty(monkeypatch, apitube_selected):
    async def fake_download(url, headers=None):
        return b"<html>rate limited</html>"

    monkeypatch.setattr(news_apitube, "_download", fake_download)

    with pytest.raises(news_feed.NewsUnavailable):
        asyncio.run(news_apitube.fetch("india car", 10))


# ── Wiring ───────────────────────────────────────────────────────────────────


def test_news_feed_uses_apitube_when_it_is_configured(monkeypatch, apitube_selected):
    """The provider switch is a setting, and fetch() must honour it."""
    _stub(monkeypatch, {"results": [
        {"title": "From APITube", "href": "https://example.com/a", "source": "Autocar"},
    ]})

    def _should_not_run(*_a, **_k):
        raise AssertionError("fell through to the Google News feed")

    monkeypatch.setattr(news_feed, "_download", _should_not_run)

    articles = asyncio.run(news_feed.fetch("india car", 10))

    assert articles[0]["title"] == "From APITube"
    assert articles[0]["source"] == "Autocar"
