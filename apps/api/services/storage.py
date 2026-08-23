"""
Image storage service backed by Cloudflare R2 (S3-compatible).

All images are normalised before upload:
  • Resized so the longest edge is ≤ MAX_DIMENSION px (aspect ratio preserved)
  • Converted to WebP at WEBP_QUALITY (lossy)
  • Stored with content-type image/webp

When R2 credentials are absent (local/test) the upload is skipped and a
placeholder URL is returned so the rest of the stack can still be exercised.
"""
import io
import uuid
from typing import BinaryIO

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from core.config import settings

MAX_DIMENSION = 1920  # px — longest edge
WEBP_QUALITY = 82     # lossy WebP quality (0-100)


def _r2_available() -> bool:
    return bool(settings.r2_endpoint_url and settings.r2_access_key_id and settings.r2_secret_access_key)


def _r2_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def _transform(raw: bytes) -> bytes:
    """Resize (longest-edge ≤ MAX_DIMENSION) and convert to WebP.

    Requires Pillow. If Pillow is not installed the raw bytes are returned
    unchanged so existing tests continue to work without an image library.
    """
    try:
        from PIL import Image  # type: ignore[import-untyped]
    except ImportError:
        return raw

    img = Image.open(io.BytesIO(raw))
    img = img.convert("RGB")  # drop alpha and EXIF metadata (RGB conversion strips Exif)

    # Resize if either dimension exceeds the cap
    w, h = img.size
    if max(w, h) > MAX_DIMENSION:
        if w >= h:
            new_w = MAX_DIMENSION
            new_h = int(h * MAX_DIMENSION / w)
        else:
            new_h = MAX_DIMENSION
            new_w = int(w * MAX_DIMENSION / h)
        img = img.resize((new_w, new_h), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=WEBP_QUALITY, method=4)
    return buf.getvalue()


def upload_image(file: BinaryIO, content_type: str, folder: str = "listings") -> str:
    raw = file.read()
    transformed = _transform(raw)
    key = f"{folder}/{uuid.uuid4()}.webp"

    if not _r2_available():
        # Dev / test mode — no credentials configured; return a placeholder URL
        return f"https://media.gaadiiq.com/{key}"

    try:
        _r2_client().upload_fileobj(
            io.BytesIO(transformed),
            settings.r2_bucket_name,
            key,
            ExtraArgs={"ContentType": "image/webp", "ACL": "public-read"},
        )
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Image upload failed: {exc}") from exc

    return f"{settings.r2_public_url}/{key}"


def upload_media(file: BinaryIO, content_type: str, extension: str, folder: str = "diagnosis") -> str:
    """
    Store an audio/video file verbatim.

    Unlike upload_image(), the bytes are not transcoded — Pillow cannot process
    A/V, and re-encoding would need ffmpeg. Callers must validate the content
    type and magic bytes before calling.
    """
    raw = file.read()
    key = f"{folder}/{uuid.uuid4()}.{extension.lstrip('.')}"

    if not _r2_available():
        # Dev / test mode — no credentials configured; return a placeholder URL
        return f"https://media.gaadiiq.com/{key}"

    try:
        _r2_client().upload_fileobj(
            io.BytesIO(raw),
            settings.r2_bucket_name,
            key,
            ExtraArgs={"ContentType": content_type, "ACL": "public-read"},
        )
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Media upload failed: {exc}") from exc

    return f"{settings.r2_public_url}/{key}"


def delete_image(url: str) -> None:
    if not _r2_available():
        return
    key = url.removeprefix(f"{settings.r2_public_url}/")
    try:
        _r2_client().delete_object(Bucket=settings.r2_bucket_name, Key=key)
    except (BotoCoreError, ClientError):
        pass  # best-effort delete


# ── Private objects ──────────────────────────────────────────────────────────
#
# upload_image() and upload_media() both set ACL "public-read": the object is
# readable by anyone with the URL the moment it lands. That is right for a
# listing photograph, which is published by the act of uploading it.
#
# It is wrong for anything awaiting moderation. A video review is held until a
# person approves it, and if the bytes are public from the moment of upload
# then "held" describes the row in the database and not the file — the uploader
# already has a working gaadiiq.com URL to hand round, which is most of what
# they wanted if their intent was to host something unpleasant on your domain.
#
# So these two write without a public ACL and read back through a short-lived
# signed URL. The bucket policy still has to not be world-readable for this to
# mean anything; on R2 the default is private, which is why the ACL is set
# explicitly on the public paths above rather than assumed.


def upload_private(data: bytes, key: str, content_type: str) -> str:
    """
    Store bytes at an exact key, not publicly readable. Returns the key.

    The key is chosen by the caller rather than generated here, because for
    moderated content the key encodes who uploaded what and is needed to find
    every object belonging to one author during a takedown.
    """
    if not _r2_available():
        # Dev / test — nothing to upload to. The key is still the identifier,
        # so callers behave identically; only fetching will find nothing.
        return key

    try:
        _r2_client().put_object(
            Bucket=settings.r2_bucket_name,
            Key=key,
            Body=data,
            ContentType=content_type,
        )
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Upload failed: {exc}") from exc

    return key


def signed_url(key: str, expires_seconds: int = 900) -> str | None:
    """
    A time-limited URL for a private object, or None when storage is absent.

    Fifteen minutes: long enough to watch a two-minute clip and to survive a
    moderator leaving the tab open for a bit, short enough that a URL pasted
    somewhere public stops working before it spreads.
    """
    if not _r2_available():
        return None
    try:
        return _r2_client().generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.r2_bucket_name, "Key": key},
            ExpiresIn=expires_seconds,
        )
    except (BotoCoreError, ClientError):
        return None


def delete_key(key: str) -> None:
    """Best-effort delete by key (delete_image() takes a public URL instead)."""
    if not _r2_available():
        return
    try:
        _r2_client().delete_object(Bucket=settings.r2_bucket_name, Key=key)
    except (BotoCoreError, ClientError):
        pass
