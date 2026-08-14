"""Health and readiness.

`/health` answers "is the process up". `/health/dependencies` answers the
question that actually caused trouble: **which optional subsystems silently fell
back.**

WHY THE SECOND ONE EXISTS

Five services in this codebase degrade quietly rather than failing when they are
not configured — search drops to Postgres, the diagnosis cache drops to a
per-process dict, vector search is skipped, and so on. That is the right
behaviour for resilience and it is also why an architecture document could
describe OpenSearch as deployed for months while every query went to Postgres.
Nothing was broken; nothing was visible either.

A degraded dependency is not an error, so this endpoint does not return a bad
status for one. It reports what is live so the answer is one request away
instead of a grep through startup logs that have long since rotated.
"""

from datetime import datetime, timezone

from fastapi import APIRouter

from core.config import settings

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
async def health_check():
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "service": "gaadiiq-api",
        "version": settings.app_version,
    }


@router.get("/dependencies")
async def dependency_status():
    """What each optional subsystem is actually running on right now.

    Deliberately unauthenticated and deliberately free of secrets: it reports
    *which* backend answered, never a URL, a host or a key. Knowing that search
    is on Postgres tells an operator something useful and tells an attacker
    nothing they could not infer from response times.
    """
    from services import diagnosis_cache
    from services.search_index import search_index

    def state(configured: bool, live: bool, fallback: str) -> dict:
        if not configured:
            return {"configured": False, "serving": fallback}
        return {"configured": True, "serving": "primary" if live else fallback}

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "environment": settings.environment,
        "dependencies": {
            # Postgres is not optional — if it were down this request would not
            # have been served, so it is reported as a fact rather than probed.
            "database": {"configured": True, "serving": "postgres"},
            "search": state(
                bool(settings.opensearch_url),
                search_index.is_available,
                "postgres-like",
            ),
            "diagnosis_cache": {
                "configured": bool(settings.redis_url),
                "serving": diagnosis_cache.stats()["backend"],
            },
            "vector_search": state(
                settings.semantic_search_enabled and bool(settings.qdrant_url),
                settings.semantic_search_enabled and bool(settings.qdrant_url),
                "disabled",
            ),
            "local_llm": state(
                "localhost" not in settings.ollama_base_url,
                "localhost" not in settings.ollama_base_url,
                "unreachable",
            ),
            "gemini": {
                "configured": bool(settings.gemini_api_key),
                "serving": settings.gemini_model if settings.gemini_api_key else "none",
            },
            "marketplace": {
                "configured": settings.marketplace_enabled,
                "serving": "on" if settings.marketplace_enabled else "off",
            },
        },
    }
