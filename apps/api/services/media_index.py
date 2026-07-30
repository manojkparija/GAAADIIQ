"""
OpenSearch index for vehicle imagery.

Separate index and module from services.search_index, which indexes listings.
They are different documents answering different questions — "which cars are
for sale near me" versus "which photographs show a red Dzire from the front" —
and a shared index would need every field of both, with most null on any row.

When OPENSEARCH_URL is absent or unreachable this degrades to a no-op and the
callers fall back to querying Postgres directly, exactly as listing search does.
That fallback is the normal path in development, so it has to stay first-class
rather than being an error case.

Lifecycle:
  • index_media(media)        — after ingestion or an admin edit
  • delete_media(id)          — after a job or image is removed
  • search(...) → list[str]   — media UUIDs, ranked; None when unavailable
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from core.config import settings

if TYPE_CHECKING:
    from models.vehicle_media import VehicleMedia

logger = logging.getLogger(__name__)

INDEX_NAME = "gaadiiq_media"

_MAPPING = {
    "mappings": {
        "properties": {
            "id":         {"type": "keyword"},
            # Analysed as text AND kept as a keyword: brochure capitalisation is
            # inconsistent ("MARUTI SUZUKI" vs "Maruti Suzuki"), so free-text
            # search needs the analyser while a model page needs an exact filter.
            "make":       {"type": "text", "fields": {"raw": {"type": "keyword"}}},
            "model":      {"type": "text", "fields": {"raw": {"type": "keyword"}}},
            "variant":    {"type": "text", "fields": {"raw": {"type": "keyword"}}},
            "model_year": {"type": "integer"},
            "category":   {"type": "keyword"},
            "colour":     {"type": "keyword"},
            "kind":       {"type": "keyword"},
            "view":       {"type": "keyword"},
            "width":      {"type": "integer"},
            "height":     {"type": "integer"},
            # Indexed so a near-duplicate sweep can be run from the index rather
            # than by pulling every row out of Postgres.
            "phash":      {"type": "keyword"},
            "source_pdf_name": {"type": "text"},
            "created_at": {"type": "date"},
        }
    }
}


def _media_doc(m: "VehicleMedia") -> dict[str, Any]:
    return {
        "id": str(m.id),
        "make": m.make,
        "model": m.model,
        "variant": m.variant,
        "model_year": m.model_year,
        "category": m.category,
        "colour": m.colour,
        "kind": m.kind.value if m.kind else None,
        "view": m.view.value if m.view else None,
        "width": m.width,
        "height": m.height,
        "phash": m.phash,
        "source_pdf_name": m.source_pdf_name,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


class MediaIndex:
    def __init__(self) -> None:
        self._client: Any = None
        self._available: bool | None = None

    async def _get_client(self):
        url = settings.opensearch_url
        if not url:
            return None
        if self._client is not None:
            return self._client
        try:
            from opensearchpy import AsyncOpenSearch  # type: ignore[import-untyped]
            self._client = AsyncOpenSearch(hosts=[url], use_ssl=url.startswith("https"))
            await self._ensure_index()
            self._available = True
            logger.info("OpenSearch media index connected at %s", url)
        except Exception as exc:  # pragma: no cover
            logger.warning("OpenSearch unavailable (%s) — media search falls back to Postgres", exc)
            self._available = False
            self._client = None
        return self._client

    async def _ensure_index(self) -> None:
        client = self._client
        if client is None:
            return
        try:
            if not await client.indices.exists(INDEX_NAME):
                await client.indices.create(INDEX_NAME, body=_MAPPING)
                logger.info("Created OpenSearch index '%s'", INDEX_NAME)
        except Exception as exc:
            logger.warning("Could not create media index: %s", exc)

    async def index_media(self, media: "VehicleMedia") -> None:
        client = await self._get_client()
        if client is None:
            return
        try:
            await client.index(index=INDEX_NAME, id=str(media.id), body=_media_doc(media))
        except Exception as exc:
            # Indexing is a read-path optimisation. The row is already committed,
            # and Postgres can answer the same query, so a failure here must not
            # fail the ingestion that produced the image.
            logger.warning("OpenSearch index_media failed: %s", exc)

    async def index_many(self, media: list["VehicleMedia"]) -> None:
        """Index a job's images in one bulk request rather than N round trips."""
        client = await self._get_client()
        if client is None or not media:
            return
        try:
            body: list[dict] = []
            for m in media:
                body.append({"index": {"_index": INDEX_NAME, "_id": str(m.id)}})
                body.append(_media_doc(m))
            await client.bulk(body=body)
        except Exception as exc:
            logger.warning("OpenSearch bulk index_media failed: %s", exc)

    async def delete_media(self, media_id: str) -> None:
        client = await self._get_client()
        if client is None:
            return
        try:
            await client.delete(index=INDEX_NAME, id=media_id, ignore=[404])
        except Exception as exc:
            logger.warning("OpenSearch delete_media failed: %s", exc)

    async def search(
        self,
        q: str | None = None,
        *,
        make: str | None = None,
        model: str | None = None,
        variant: str | None = None,
        model_year: int | None = None,
        category: str | None = None,
        colour: str | None = None,
        kind: str | None = None,
        view: str | None = None,
        limit: int = 60,
        offset: int = 0,
    ) -> list[str] | None:
        """
        Ranked media IDs, or None when the index is unavailable.

        None rather than an empty list, so the caller can tell "the index is not
        there, query Postgres" from "the index answered, and there is nothing".
        Returning [] for both would silently show an empty gallery whenever
        OpenSearch was down.
        """
        client = await self._get_client()
        if client is None:
            return None

        must: list[dict] = []
        if q:
            must.append({
                "multi_match": {
                    "query": q,
                    "fields": ["make^2", "model^3", "variant", "source_pdf_name"],
                    "fuzziness": "AUTO",
                }
            })
        # Exact filters go on the keyword sub-field, so "Maruti Suzuki" does not
        # also match a row whose make is merely analysed to include "maruti".
        for field, value in [
            ("make.raw", make), ("model.raw", model), ("variant.raw", variant),
            ("category", category), ("colour", colour), ("kind", kind), ("view", view),
        ]:
            if value:
                must.append({"term": {field: value}})
        if model_year:
            must.append({"term": {"model_year": model_year}})

        body = {
            "query": {"bool": {"must": must}} if must else {"match_all": {}},
            "from": offset,
            "size": limit,
        }

        try:
            resp = await client.search(index=INDEX_NAME, body=body)
            return [h["_source"]["id"] for h in resp.get("hits", {}).get("hits", [])]
        except Exception as exc:
            logger.warning("OpenSearch media search failed: %s", exc)
            return None

    @property
    def is_available(self) -> bool:
        return self._available is True


media_index = MediaIndex()
