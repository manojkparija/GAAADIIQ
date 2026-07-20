"""Qdrant vector store — index and search car listings."""
from __future__ import annotations

import logging

from core.config import settings

logger = logging.getLogger("gaadiiq.qdrant")

VECTOR_SIZE = 384  # matches bge-small-en-v1.5


def _client():
    try:
        from qdrant_client import QdrantClient
        return QdrantClient(url=settings.qdrant_url, timeout=10)
    except Exception as exc:
        logger.warning("Qdrant client unavailable: %s", exc)
        return None


def ensure_collection() -> bool:
    client = _client()
    if client is None:
        return False
    try:
        from qdrant_client.models import Distance, VectorParams
        names = [c.name for c in client.get_collections().collections]
        if settings.qdrant_collection not in names:
            client.create_collection(
                collection_name=settings.qdrant_collection,
                vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
            )
            logger.info("Created Qdrant collection: %s", settings.qdrant_collection)
        return True
    except Exception as exc:
        logger.warning("Qdrant ensure_collection: %s", exc)
        return False


def upsert_listing(listing_id: int, vector: list[float], payload: dict) -> bool:
    client = _client()
    if client is None:
        return False
    try:
        from qdrant_client.models import PointStruct
        client.upsert(
            collection_name=settings.qdrant_collection,
            points=[PointStruct(id=listing_id, vector=vector, payload=payload)],
        )
        return True
    except Exception as exc:
        logger.warning("Qdrant upsert %s: %s", listing_id, exc)
        return False


def search_listings(
    query_vector: list[float],
    top_k: int = 10,
    must_match: dict | None = None,
) -> list[dict]:
    client = _client()
    if client is None:
        return []
    try:
        from qdrant_client.models import FieldCondition, Filter, MatchValue
        qdrant_filter = None
        if must_match:
            conditions = [
                FieldCondition(key=k, match=MatchValue(value=v))
                for k, v in must_match.items()
            ]
            if conditions:
                qdrant_filter = Filter(must=conditions)
        results = client.search(
            collection_name=settings.qdrant_collection,
            query_vector=query_vector,
            limit=top_k,
            query_filter=qdrant_filter,
            with_payload=True,
        )
        return [{"id": r.id, "score": r.score, **r.payload} for r in results]
    except Exception as exc:
        logger.warning("Qdrant search: %s", exc)
        return []


def delete_listing(listing_id: int) -> bool:
    client = _client()
    if client is None:
        return False
    try:
        from qdrant_client.models import PointIdsList
        client.delete(
            collection_name=settings.qdrant_collection,
            points_selector=PointIdsList(points=[listing_id]),
        )
        return True
    except Exception as exc:
        logger.warning("Qdrant delete %s: %s", listing_id, exc)
        return False
