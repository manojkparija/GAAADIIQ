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


#: Repeated single-text embeddings, kept in the worker rather than in Redis.
#:
#: The model is local — fastembed on CPU, 384 dimensions — so a miss costs
#: milliseconds of CPU, not money. A Redis round trip to save that could
#: plausibly cost more than it saves, which is why this is an lru_cache and not
#: services/ai_cache.py.
#:
#: What makes it worth having at all is that the same text arrives over and
#: over: the search and recommendation paths embed a query string that many
#: buyers phrase identically, and diagnosis embeds the same symptom lookups.
#: A listing's text is near-unique and simply occupies a slot until it is
#: evicted, which is what the bound is for.
#:
#: Correctness: embed_texts is a pure function of its input for a fixed model,
#: so a hit and a miss return the same vector. If the model name ever changes,
#: the process restarts with it and the cache goes with it.
_EMBED_CACHE_SIZE = 2048


@lru_cache(maxsize=_EMBED_CACHE_SIZE)
def _embed_one_cached(text: str) -> tuple[float, ...]:
    result = embed_texts([text])
    if not result:
        # Raised rather than returned, because lru_cache stores whatever comes
        # back but never stores an exception. embed_texts returns None when the
        # model has not loaded yet or a single call failed — both transient —
        # and a cached None would make the first failure permanent for the life
        # of the process.
        raise _NotEmbeddable(text[:80])
    # A tuple because lru_cache hands the SAME object to every caller, and a
    # list would let one caller's mutation reach the next one's vector.
    return tuple(result[0])


class _NotEmbeddable(Exception):
    """Internal: embed_texts had no answer. Never escapes embed_one."""


def embed_one(text: str) -> list[float] | None:
    try:
        return list(_embed_one_cached(text))
    except _NotEmbeddable:
        return None


def embed_cache_stats() -> dict:
    info = _embed_one_cached.cache_info()
    total = info.hits + info.misses
    return {
        "hits": info.hits,
        "misses": info.misses,
        "size": info.currsize,
        "maxsize": info.maxsize,
        "hit_rate": round(info.hits / total, 3) if total else 0.0,
    }


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
