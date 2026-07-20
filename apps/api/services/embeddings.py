"""BGE embeddings via fastembed (BAAI/bge-small-en-v1.5, no GPU required)."""
from __future__ import annotations

import logging
from functools import lru_cache
from typing import Sequence

logger = logging.getLogger("gaadiiq.embeddings")

_MODEL_NAME = "BAAI/bge-small-en-v1.5"  # 384-dim, fast, strong quality
_DIM = 384


@lru_cache(maxsize=1)
def _get_embedder():
    try:
        from fastembed import TextEmbedding
        emb = TextEmbedding(model_name=_MODEL_NAME)
        logger.info("fastembed loaded: %s", _MODEL_NAME)
        return emb
    except Exception as exc:
        logger.warning("fastembed unavailable (install qdrant-client & fastembed): %s", exc)
        return None


def embed_texts(texts: Sequence[str]) -> list[list[float]] | None:
    embedder = _get_embedder()
    if embedder is None:
        return None
    try:
        return [list(v) for v in embedder.embed(list(texts))]
    except Exception as exc:
        logger.warning("Embedding failed: %s", exc)
        return None


def embed_one(text: str) -> list[float] | None:
    result = embed_texts([text])
    return result[0] if result else None


def listing_text(payload: dict) -> str:
    """Build a rich text blob to embed for a listing."""
    parts = [
        payload.get("make", ""), payload.get("model", ""), payload.get("variant", ""),
        str(payload.get("year", "")), payload.get("fuel", ""), payload.get("body_type", ""),
        payload.get("transmission", ""), payload.get("city", ""),
        f"price {payload.get('price', '')}", f"km {payload.get('km', '')}",
        payload.get("condition", ""), payload.get("color", ""),
    ]
    return " ".join(p for p in parts if p)
