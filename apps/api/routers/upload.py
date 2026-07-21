"""
POST /upload/image — accept an image file, store in Cloudflare R2, return URL.
Used by Angular diagnosis wizard to upload photos before submitting diagnosis.
"""
import io

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel

from core.dependencies import get_current_user
from core.limiter import limiter
from models.user import User
from services.storage import upload_image

router = APIRouter(prefix="/upload", tags=["upload"])

_MAX_SIZE = 20 * 1024 * 1024  # 20 MB

# Magic byte signatures for allowed image types
_MAGIC_SIGNATURES: list[tuple[bytes, str]] = [
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"RIFF", "image/webp"),   # WebP: RIFF....WEBP — checked further below
    (b"\x00\x00\x00", "image/heic"),  # HEIC/HEIF ftyp box — partial match
]
_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}


def _check_magic_bytes(data: bytes) -> bool:
    """Return True if the file starts with a known image magic signature."""
    if data[:3] == b"\xff\xd8\xff":
        return True
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return True
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return True
    # HEIC/HEIF: ftyp box at offset 4 with brand heic/heix/hevc/mif1/msf1
    if len(data) >= 12 and data[4:8] == b"ftyp":
        brand = data[8:12]
        if brand in (b"heic", b"heix", b"hevc", b"mif1", b"msf1"):
            return True
    return False


class UploadResponse(BaseModel):
    url: str
    filename: str
    size_bytes: int


@router.post("/image", response_model=UploadResponse)
@limiter.limit("20/minute")
async def upload_image_endpoint(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Upload an image to R2 storage. Returns the public URL."""
    # 1. Reject unknown Content-Type header early (before reading body)
    if file.content_type not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only JPEG, PNG, WebP and HEIC images are accepted.",
        )

    # 2. Check Content-Length header before reading to avoid buffering huge bodies
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > _MAX_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image must be under 20 MB.",
        )

    content = await file.read()

    # 3. Enforce size after read (Content-Length may be absent or spoofed)
    if len(content) > _MAX_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image must be under 20 MB.",
        )

    # 4. Magic-byte validation — prevents Content-Type spoofing
    if not _check_magic_bytes(content):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="File content does not match a supported image format.",
        )

    url = upload_image(io.BytesIO(content), content_type=file.content_type or "image/jpeg", folder="diagnosis")
    return UploadResponse(url=url, filename=file.filename or "upload", size_bytes=len(content))
