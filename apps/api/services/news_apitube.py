"""
APITube as a news source, behind the same interface as the Google News feed.

WHAT THIS CHANGES, AND WHAT IT DOES NOT

APITube is a third party, exactly as Google News is. Switching to it does not
remove a third party from the picture; it chooses a different one. What keeps
the site safe from either is not which vendor is on the other end, it is the
shape of the connection:

  * the browser never talks to the provider — it calls our own origin, and the
    API makes the outbound request. A visitor's IP, their search terms and
    their session are never exposed to the provider.
  * nothing the provider returns is executed. Headlines and summaries are
    rendered as text, links are validated to be https before they are handed
    to the browser, and no markup from the feed reaches the DOM.
  * the response is size-capped while streaming, so a hostile or broken
    upstream cannot exhaust the process.
  * the key is server-side only.

That last point is the one that actually decides whether a provider can hurt
us. A key compiled into frontend code is public — anyone can read it out of the
bundle, and APITube bills per request against it. It belongs in the API's
environment and nowhere else.

WHAT A COMPROMISED PROVIDER COULD STILL DO

It could serve wrong or malicious *content*: fabricated headlines, or links to
a phishing page dressed as a car review. No amount of transport hardening
addresses that, because the content is the product. The mitigations are that
every story is attributed to a named publisher and links out visibly, and that
the site never reproduces article bodies — a reader ends up on the publisher's
own domain, where the address bar is the check. This is the residual risk of
any aggregator, and it is the reason not to auto-promote feed items into
anything the site asserts in its own voice.
"""
import logging
from typing import Any

from core.config import settings

from .news_feed import (
    _MAX_ARTICLES,
    _MAX_DESCRIPTION_CHARS,
    _MAX_SOURCE_CHARS,
    _MAX_TITLE_CHARS,
    Article,
    NewsUnavailable,
    _download,
    _strip_html,
)

logger = logging.getLogger("gaadiiq.news_apitube")


def configured() -> bool:
    """True when APITube is both selected and has a key to use."""
    return settings.news_provider.lower() == "apitube" and bool(settings.apitube_api_key.strip())


def _safe_link(value: Any) -> str:
    """
    An https URL, or "".

    Link fields decide where a click goes. `javascript:` in an href is a
    scripting bug waiting for a reader, and `http://` is a downgrade we have no
    reason to pass on, so both are dropped rather than rewritten — an article
    without a usable link is skipped, which is visible and safe. Anything that
    is not a string (a provider returning an object here) is not a URL.
    """
    if not isinstance(value, str):
        return ""
    link = value.strip()
    return link if link.startswith("https://") else ""


def _first_str(payload: dict, *keys: str) -> str:
    """
    The first key present as a non-empty string.

    Providers move fields between releases and nest them inconsistently
    (`source` as a string in one response, `{"name": ...}` in the next). Reading
    defensively here means a schema drift degrades one field rather than
    raising and taking the whole page down.
    """
    for key in keys:
        value = payload.get(key)
        if isinstance(value, dict):
            value = value.get("name") or value.get("title") or value.get("id")
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def parse(payload: dict) -> list[Article]:
    """Map an APITube response onto the same Article shape the page already renders."""
    if not isinstance(payload, dict):
        raise NewsUnavailable("APITube response was not an object")

    results = payload.get("results")
    if results is None:
        results = payload.get("data") or payload.get("articles")
    if not isinstance(results, list):
        raise NewsUnavailable("APITube response carried no article list")

    articles: list[Article] = []
    for index, item in enumerate(results):
        if not isinstance(item, dict):
            continue

        title = _first_str(item, "title", "headline")
        link = _safe_link(item.get("href") or item.get("url") or item.get("link"))
        if not title or not link:
            # No headline or no usable link means there is nothing to show and
            # nowhere to send the reader. Skipping beats rendering a dead card.
            continue

        # Summaries are stripped of markup even though they render as text.
        # The frontend not treating them as HTML today is not a guarantee that
        # nothing downstream ever will.
        description = _strip_html(_first_str(item, "description", "summary", "excerpt"))

        articles.append(
            Article(
                id=f"live-{index}",
                title=_strip_html(title)[:_MAX_TITLE_CHARS],
                description=description[:_MAX_DESCRIPTION_CHARS],
                url=link,
                # Only an https image URL, and only ever as a background-image.
                # A non-https or malformed value becomes None and the card
                # falls back to its icon.
                image=_safe_link(
                    (item.get("image") if isinstance(item.get("image"), str) else None)
                    or _first_str(item, "image_url", "thumbnail", "urlToImage")
                )
                or None,
                publishedAt=_first_str(item, "published_at", "publishedAt", "date"),
                source=(_first_str(item, "source", "publisher") or "APITube")[
                    :_MAX_SOURCE_CHARS
                ],
            )
        )

    return articles[:_MAX_ARTICLES]


async def fetch(query: str, limit: int) -> list[Article]:
    """
    Headlines for `query` from APITube.

    Raises NewsUnavailable — never returns an empty list to mean "broken", so
    the caller can tell "no results" from "could not ask".
    """
    if not configured():
        raise NewsUnavailable("APITube is selected but no API key is set")

    import json
    import urllib.parse

    params = {
        "title": query,
        "language.code": "en",
        "per_page": str(max(1, min(int(limit or 12), _MAX_ARTICLES))),
        "sort.by": "published_at",
        "sort.order": "desc",
    }
    url = f"{settings.apitube_api_url.rstrip('/')}/everything?{urllib.parse.urlencode(params)}"

    # The key goes in a header, not the query string. Query strings end up in
    # access logs, proxy logs and Referer headers; a header does not. This also
    # keeps it out of any exception that carries the URL.
    body = await _download(url, headers={"X-API-Key": settings.apitube_api_key.strip()})

    try:
        payload = json.loads(body)
    except ValueError as exc:
        raise NewsUnavailable("APITube response was not valid JSON") from exc

    return parse(payload)
