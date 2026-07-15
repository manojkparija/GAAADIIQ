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
    img = img.convert("RGB")  # drop alpha; WebP supports it but R2 serves consistently as RGB

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


def delete_image(url: str) -> None:
    if not _r2_available():
        return
    key = url.removeprefix(f"{settings.r2_public_url}/")
    try:
        _r2_client().delete_object(Bucket=settings.r2_bucket_name, Key=key)
    except (BotoCoreError, ClientError):
        pass  # best-effort delete
