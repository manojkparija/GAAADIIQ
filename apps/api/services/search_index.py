"""
OpenSearch integration for full-text listing search.

When OPENSEARCH_URL is set, listings are indexed in OpenSearch and all
full-text queries are served from there. When it is absent or unreachable,
the service degrades gracefully to a no-op — the Postgres/tsvector path in
routers/search.py takes over automatically.

Index lifecycle:
  • index_listing(listing)  — called after create/update
  • delete_listing(id)       — called after soft/hard delete
  • search(q, filters, page, page_size) → list[str] (listing UUIDs, ranked)

Usage:
    from services.search_index import search_index
    ids = await search_index.search("swift petrol mumbai")
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from core.config import settings

if TYPE_CHECKING:
    from models.listing import Listing

logger = logging.getLogger(__name__)

INDEX_NAME = "gaadiiq_listings"

_MAPPING = {
    "mappings": {
        "properties": {
            "id":           {"type": "keyword"},
            "make":         {"type": "text", "analyzer": "standard"},
            "model":        {"type": "text", "analyzer": "standard"},
            "variant":      {"type": "keyword"},
            "year":         {"type": "integer"},
            "fuel_type":    {"type": "keyword"},
            "transmission": {"type": "keyword"},
            "body_type":    {"type": "keyword"},
            "city":         {"type": "text", "analyzer": "standard"},
            "description":  {"type": "text", "analyzer": "standard"},
            "price":        {"type": "long"},
            "km_driven":    {"type": "integer"},
            "listing_type": {"type": "keyword"},
            "is_active":    {"type": "boolean"},
        }
    },
    "settings": {
        "number_of_shards": 1,
        "number_of_replicas": 0,
    },
}


def _listing_doc(listing: "Listing") -> dict[str, Any]:
    car = listing.car
    return {
        "id":           str(listing.id),
        "make":         car.make if car else "",
        "model":        car.model if car else "",
        "variant":      car.variant if car else "",
        "year":         car.year if car else None,
        "fuel_type":    car.fuel_type.value if car and car.fuel_type else "",
        "transmission": car.transmission.value if car and car.transmission else "",
        "body_type":    car.body_type.value if car and car.body_type else "",
        "city":         listing.city or "",
        "description":  listing.description or "",
        "price":        listing.price,
        "km_driven":    listing.km_driven,
        "listing_type": listing.listing_type.value if listing.listing_type else "",
        "is_active":    listing.is_active,
    }


class SearchIndex:
    """Thin async wrapper around OpenSearch. All methods are no-ops when
    OpenSearch is not configured — callers need no error handling."""

    def __init__(self) -> None:
        self._client: Any = None
        self._available: bool | None = None  # None = not yet probed

    def _url(self) -> str:
        return getattr(settings, "opensearch_url", "")

    async def _get_client(self) -> Any | None:
        if self._available is False:
            return None
        url = self._url()
        if not url:
            self._available = False
            return None
        if self._client is not None:
            return self._client
        try:
            from opensearchpy import AsyncOpenSearch  # type: ignore[import-untyped]
            self._client = AsyncOpenSearch(hosts=[url], use_ssl=url.startswith("https"))
            await self._ensure_index()
            self._available = True
            logger.info("OpenSearch connected at %s", url)
        except Exception as exc:  # pragma: no cover
            logger.warning("OpenSearch unavailable (%s) — falling back to Postgres search", exc)
            self._available = False
            self._client = None
        return self._client

    async def _ensure_index(self) -> None:
        client = self._client
        if client is None:
            return
        try:
            exists = await client.indices.exists(INDEX_NAME)
            if not exists:
                await client.indices.create(INDEX_NAME, body=_MAPPING)
                logger.info("Created OpenSearch index '%s'", INDEX_NAME)
        except Exception as exc:
            logger.warning("Could not create OpenSearch index: %s", exc)

    async def index_listing(self, listing: "Listing") -> None:
        client = await self._get_client()
        if client is None:
            return
        try:
            doc = _listing_doc(listing)
            await client.index(index=INDEX_NAME, id=str(listing.id), body=doc)
        except Exception as exc:
            logger.warning("OpenSearch index_listing failed: %s", exc)

    async def delete_listing(self, listing_id: str) -> None:
        client = await self._get_client()
        if client is None:
            return
        try:
            await client.delete(index=INDEX_NAME, id=listing_id, ignore=[404])
        except Exception as exc:
            logger.warning("OpenSearch delete_listing failed: %s", exc)

    async def search(
        self,
        q: str,
        *,
        fuel_type: str | None = None,
        body_type: str | None = None,
        city: str | None = None,
        listing_type: str | None = None,
        min_price: int | None = None,
        max_price: int | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> list[str] | None:
        """Return an ordered list of listing UUIDs, or None if OpenSearch is unavailable."""
        client = await self._get_client()
        if client is None:
            return None
        try:
            must: list[dict] = [
                {
                    "multi_match": {
                        "query": q,
                        "fields": ["make^3", "model^3", "city^2", "description", "variant"],
                        "type": "best_fields",
                        "fuzziness": "AUTO",
                    }
                },
                {"term": {"is_active": True}},
            ]
            filters: list[dict] = []
            if fuel_type:
                filters.append({"term": {"fuel_type": fuel_type}})
            if body_type:
                filters.append({"term": {"body_type": body_type}})
            if city:
                filters.append({"match": {"city": city}})
            if listing_type:
                filters.append({"term": {"listing_type": listing_type}})
            if min_price is not None or max_price is not None:
                price_range: dict[str, Any] = {}
                if min_price is not None:
                    price_range["gte"] = min_price
                if max_price is not None:
                    price_range["lte"] = max_price
                filters.append({"range": {"price": price_range}})

            body = {
                "query": {"bool": {"must": must, "filter": filters}},
                "from": (page - 1) * page_size,
                "size": page_size,
                "_source": ["id"],
            }
            resp = await client.search(index=INDEX_NAME, body=body)
            hits = resp.get("hits", {}).get("hits", [])
            return [h["_source"]["id"] for h in hits]
        except Exception as exc:
            logger.warning("OpenSearch search failed: %s", exc)
            return None

    @property
    def is_available(self) -> bool:
        return self._available is True


search_index = SearchIndex()
