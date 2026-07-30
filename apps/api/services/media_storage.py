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

    def __init__(
        self,
        bucket: str,
        endpoint_url: str = "",
        public_base: str = "",
        access_key: str = "",
        secret_key: str = "",
    ):
        self.bucket = bucket
        self.endpoint_url = endpoint_url
        self.public_base = public_base.rstrip("/")
        self.access_key = access_key
        self.secret_key = secret_key
        self._cached_client = None

    def _check_endpoint(self) -> None:
        """
        Catch the Cloudflare dashboard URL being used as the S3 endpoint.

        R2's console lives at dash.cloudflare.com/<account-id>/r2, and that is
        the URL to hand when someone copies "the R2 URL" from the browser. It
        is a web page, not an S3 API, so every request to it returns 403
        Forbidden — indistinguishable from a token with the wrong permissions,
        and it sends debugging to Cloudflare's token settings instead of to the
        one wrong character in an environment variable.

        The account ID is in that path, so the correct endpoint can be named
        exactly rather than described.
        """
        if "dash.cloudflare.com" not in (self.endpoint_url or ""):
            return
        match = re.search(r"dash\.cloudflare\.com/([0-9a-f]{32})", self.endpoint_url)
        correct = (
            f"https://{match.group(1)}.r2.cloudflarestorage.com"
            if match
            else "https://<account-id>.r2.cloudflarestorage.com"
        )
        logger.error(
            "R2 endpoint %r is the Cloudflare dashboard, not the S3 API. Every "
            "upload will fail with 403. Set R2_ENDPOINT_URL to %s",
            self.endpoint_url,
            correct,
        )

    def _client(self):
        """
        One client, reused.

        This used to build a new boto3 client per operation, so a brochure with
        40 images opened 40 TLS connections to Cloudflare in a burst — wasteful,
        and a plausible way to draw a handshake rejection. A cached client keeps
        botocore's connection pool alive across images. boto3 clients are
        thread-safe for this usage, which matters because the calls run in
        worker threads via asyncio.to_thread.
        """
        if self._cached_client is not None:
            return self._cached_client
        self._check_endpoint()
        try:
            import boto3
            from botocore.config import Config
        except ImportError as exc:  # pragma: no cover - deployment dependent
            raise StorageError("boto3 is required for S3 storage") from exc

        # Credentials are passed explicitly rather than left to boto3's
        # discovery chain: this project holds them in R2_* variables, and
        # boto3 only looks for AWS_* — so an implicit client failed with
        # NoCredentialsError on a correctly configured deployment.
        kwargs = {
            "endpoint_url": self.endpoint_url or None,
            "config": Config(
                # R2 requires SigV4 and rejects a real region name.
                signature_version="s3v4",
                # R2 serves the bucket under the account host; virtual-host
                # style would put the bucket in the TLS SNI, which its
                # certificate does not cover.
                s3={"addressing_style": "path"},
                # A burst of image uploads that trips a transient TLS or network
                # error should retry rather than lose the image.
                retries={"max_attempts": 3, "mode": "standard"},
            ),
            "region_name": "auto",
        }
        if self.access_key and self.secret_key:
            kwargs["aws_access_key_id"] = self.access_key
            kwargs["aws_secret_access_key"] = self.secret_key
        self._cached_client = boto3.client("s3", **kwargs)
        return self._cached_client

    async def save(self, key: str, data: bytes, content_type: str) -> StoredObject:
        _validate_key(key)
        try:
            await asyncio.to_thread(
                lambda: self._client().put_object(
                    Bucket=self.bucket, Key=key, Body=data, ContentType=content_type
                )
            )
        except StorageError:
            raise
        except Exception as exc:
            # Callers handle StorageError; a raw botocore ClientError escaped as
            # an unhandled 500, so a rejected bucket write looked like a crash.
            # The bucket and endpoint are named because a 403 here is almost
            # always a token scoped to the wrong bucket or missing write
            # permission, and the bare message says neither.
            raise StorageError(
                f"Could not write {key!r} to bucket {self.bucket!r} "
                f"at {self.endpoint_url or 'AWS S3'}: {exc}"
            ) from exc
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
        try:
            await asyncio.to_thread(
                lambda: self._client().delete_object(Bucket=self.bucket, Key=key)
            )
        except Exception as exc:
            raise StorageError(f"Could not delete {key!r} from {self.bucket!r}: {exc}") from exc

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
        # Fall back to the R2 settings the project already carries, so an
        # existing deployment needs only MEDIA_BACKEND=s3 rather than four new
        # variables duplicating credentials it already has.
        from core.config import settings

        bucket = os.getenv("MEDIA_S3_BUCKET") or settings.r2_bucket_name
        access_key = os.getenv("MEDIA_S3_ACCESS_KEY") or settings.r2_access_key_id
        secret_key = os.getenv("MEDIA_S3_SECRET_KEY") or settings.r2_secret_access_key

        if bucket and access_key and secret_key:
            _backend = S3Storage(
                bucket=bucket,
                endpoint_url=os.getenv("MEDIA_S3_ENDPOINT") or settings.r2_endpoint_url,
                public_base=os.getenv("MEDIA_PUBLIC_BASE") or settings.r2_public_url,
                access_key=access_key,
                secret_key=secret_key,
            )
            return _backend
        logger.warning(
            "MEDIA_BACKEND=s3 but bucket or credentials are missing — using local storage"
        )
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
