"""
Live car news — the API's own endpoint, replacing a third-party browser call.

  GET /news?q=&limit=   latest car headlines, optionally for a search term

Public on purpose: the Reviews & News page is readable without signing in, and
requiring a token to read headlines would only push the page back to calling a
third party directly. It is rate-limited instead.
"""
# NOTE: deliberately NOT using `from __future__ import annotations`.
# PEP 563 turns annotations into strings, and slowapi's @limiter.limit wrapper
# leaves FastAPI unable to resolve them — it then treats parameters as query
# params it cannot build, so requests 422.

from fastapi import APIRouter, HTTPException, Query, Request, status

from core.limiter import limiter
from services import news_feed

router = APIRouter(prefix="/news", tags=["news"])


@router.get("")
# The upstream feed is a shared resource and the cache is per-query, so a user
# typing fast is the realistic load. This bounds how much of that reaches
# Google without getting in the way of someone genuinely searching.
@limiter.limit("30/minute")
async def list_news(
    request: Request,
    q: str = Query("", max_length=200, description="Search terms; blank for the default feed"),
    limit: int = Query(12, ge=1, le=30),
):
    """
    Latest car headlines.

    Every article is a real one from a real publisher, with its own link — the
    API fetches the feed and reformats it, and nothing here is generated.
    """
    try:
        articles = await news_feed.fetch(q, limit)
    except news_feed.NewsUnavailable as exc:
        # 503 rather than 500: the feed being unreachable is a temporary
        # upstream condition, and the page has curated articles to fall back on.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Live news is unavailable right now.",
        ) from exc

    return {"query": news_feed.clean_query(q), "count": len(articles), "articles": articles}
