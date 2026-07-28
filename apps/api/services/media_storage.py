"""
Pluggable object storage for extracted media.

Files land in a local folder today and should land in S3 or Google Cloud
Storage tomorrow without any calling code changing. That is this module's whole
job: callers deal in *keys* ("vehicles/<uuid>/front.png"), never in filesystem
paths, and never learn which backend is in use.

To add a backend, implement StorageBackend and register it in get_storage().
Nothing else in the codebase needs to know.

    storage = get_storage()
    obj = await storage.save(key, data, "image/png")
    #   obj.key -> stable identifier, stored in the database
    #   obj.url -> how a browser fetches it (local: an API route; S3: the CDN)

The database stores the KEY, not the URL. URLs change when you switch provider
or put a CDN in front; keys do not. Storing URLs would mean rewriting every row
on migration day.

Note on the older services/storage.py: it targets Cloudflare R2 only, and when
credentials are absent it returns a fabricated https://media.gaadiiq.com/... URL
for an object that was never uploaded. That is why some car images render
broken. This module never invents a URL for a file it did not write.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

logger = logging.getLogger("gaadiiq.media_storage")

# Keys become filesystem paths, so they must not be able to escape the storage
# root. Bad keys are rejected rather than sanitised — silently rewriting a key
# would make the stored key and the real location disagree.
_SAFE_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$")


class StorageError(RuntimeError):
    """A storage operation failed, or a key was unusable."""


@dataclass(frozen=True)
class StoredObject:
    """Where something ended up. `key` is canonical; `url` is for display."""
    key: str
    url: str
    size_bytes: int
    content_type: str


def _validate_key(key: str) -> str:
    if not _SAFE_KEY.match(key or ""):
        raise StorageError(f"Unsafe storage key: {key!r}")
    # The regex already forbids "..", but traversal is severe enough to check
    # the split form too.
    if ".." in key.split("/"):
        raise StorageError(f"Path traversal in storage key: {key!r}")
    return key


class StorageBackend(Protocol):
    """The contract every backend implements."""

    async def save(self, key: str, data: bytes, content_type: str) -> StoredObject: ...
    async def load(self, key: str) -> bytes: ...
    async def delete(self, key: str) -> None: ...
    async def exists(self, key: str) -> bool: ...
    def url_for(self, key: str) -> str: ...


class LocalStorage:
    """
    Files under a local directory — the development and self-hosted default.

    Blocking file I/O runs in a worker thread: this is called from async request
    handlers, and writing a multi-megabyte brochure image synchronously would
    stall every other request on the event loop.
    """

    def __init__(self, root: str | Path, public_prefix: str = "/media"):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.public_prefix = public_prefix.rstrip("/")

    def _path(self, key: str) -> Path:
        path = (self.root / _validate_key(key)).resolve()
        # A symlink inside the root could still point outside it.
        if not str(path).startswith(str(self.root)):
            raise StorageError(f"Key escapes storage root: {key!r}")
        return path

    async def save(self, key: str, data: bytes, content_type: str) -> StoredObject:
        path = self._path(key)

        def _write() -> None:
            path.parent.mkdir(parents=True, exist_ok=True)
            # Write then move, so a crash mid-write cannot leave a truncated
            # file that later reads as a corrupt image.
            tmp = path.with_name(path.name + ".part")
            tmp.write_bytes(data)
            shutil.move(str(tmp), str(path))

        await asyncio.to_thread(_write)
        return StoredObject(key, self.url_for(key), len(data), content_type)

    async def load(self, key: str) -> bytes:
        path = self._path(key)
        try:
            return await asyncio.to_thread(path.read_bytes)
        except FileNotFoundError as exc:
            raise StorageError(f"No object for key {key!r}") from exc

    async def delete(self, key: str) -> None:
        path = self._path(key)
        await asyncio.to_thread(lambda: path.unlink(missing_ok=True))

    async def exists(self, key: str) -> bool:
        return await asyncio.to_thread(self._path(key).is_file)

    def url_for(self, key: str) -> str:
        # Local files are not web-reachable by themselves, so they are served
        # back through an API route.
        return f"{self.public_prefix}/{_validate_key(key)}"


class S3Storage:
    """
    Amazon S3, or any S3-compatible store (Cloudflare R2, MinIO).

    Written out now so that moving off local storage is a configuration change
    rather than a rewrite: every method matches LocalStorage's signature.
    """

    def __init__(self, bucket: str, endpoint_url: str = "", public_base: str = ""):
        self.bucket = bucket
        self.endpoint_url = endpoint_url
        self.public_base = public_base.rstrip("/")

    def _client(self):
        try:
            import boto3
        except ImportError as exc:  # pragma: no cover - deployment dependent
            raise StorageError("boto3 is required for S3 storage") from exc
        return boto3.client("s3", endpoint_url=self.endpoint_url or None)

    async def save(self, key: str, data: bytes, content_type: str) -> StoredObject:
        _validate_key(key)
        await asyncio.to_thread(
            lambda: self._client().put_object(
                Bucket=self.bucket, Key=key, Body=data, ContentType=content_type
            )
        )
        return StoredObject(key, self.url_for(key), len(data), content_type)

    async def load(self, key: str) -> bytes:
        _validate_key(key)

        def _get() -> bytes:
            return self._client().get_object(Bucket=self.bucket, Key=key)["Body"].read()

        try:
            return await asyncio.to_thread(_get)
        except Exception as exc:
            raise StorageError(f"No object for key {key!r}") from exc

    async def delete(self, key: str) -> None:
        _validate_key(key)
        await asyncio.to_thread(
            lambda: self._client().delete_object(Bucket=self.bucket, Key=key)
        )

    async def exists(self, key: str) -> bool:
        _validate_key(key)

        def _head() -> bool:
            try:
                self._client().head_object(Bucket=self.bucket, Key=key)
                return True
            except Exception:
                return False

        return await asyncio.to_thread(_head)

    def url_for(self, key: str) -> str:
        _validate_key(key)
        if self.public_base:
            return f"{self.public_base}/{key}"
        return f"https://{self.bucket}.s3.amazonaws.com/{key}"


_backend: StorageBackend | None = None


def get_storage() -> StorageBackend:
    """
    The configured backend, created once.

    MEDIA_BACKEND selects it: "local" (default) or "s3". A misconfigured value
    falls back to local with a warning rather than refusing to start — losing
    brochure ingestion is better than the whole API failing to boot.
    """
    global _backend
    if _backend is not None:
        return _backend

    kind = os.getenv("MEDIA_BACKEND", "local").lower()
    if kind == "s3":
        bucket = os.getenv("MEDIA_S3_BUCKET", "")
        if bucket:
            _backend = S3Storage(
                bucket=bucket,
                endpoint_url=os.getenv("MEDIA_S3_ENDPOINT", ""),
                public_base=os.getenv("MEDIA_PUBLIC_BASE", ""),
            )
            return _backend
        logger.warning("MEDIA_BACKEND=s3 but MEDIA_S3_BUCKET is unset — using local storage")
    elif kind not in ("local", ""):
        logger.warning("Unknown MEDIA_BACKEND %r — using local storage", kind)

    _backend = LocalStorage(
        root=os.getenv("MEDIA_ROOT", "media_store"),
        public_prefix=os.getenv("MEDIA_URL_PREFIX", "/media"),
    )
    return _backend


def reset_storage() -> None:
    """Drop the cached backend. Tests use this to point at a temp directory."""
    global _backend
    _backend = None
