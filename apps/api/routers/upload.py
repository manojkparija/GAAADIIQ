"""
POST /upload/image — accept an image file, store in Cloudflare R2, return URL.
Used by Angular diagnosis wizard to upload photos before submitting diagnosis.

POST /upload — accept an image file for WAVE 3 media library.
Returns VehicleMedia object with WAVE 3 ML fields (OCR, safety detection, embeddings).
"""
import io
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.dependencies import get_current_user
from core.limiter import limiter
from db.session import get_db
from models.user import User
from models.vehicle_media import VehicleMedia
from services import media_library, pdf_ingest
from services.storage import StorageError, upload_image, upload_media
from services.stt import estimate_duration_seconds

router = APIRouter(prefix="/upload", tags=["upload"])

_MAX_SIZE = 20 * 1024 * 1024        # 20 MB — images
_MAX_AUDIO_SIZE = 25 * 1024 * 1024  # 25 MB — ~5 min of compressed speech
_MAX_VIDEO_SIZE = 75 * 1024 * 1024  # 75 MB — short clip of the fault

_ALLOWED_AUDIO_TYPES = {
    "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4",
    "audio/wav", "audio/x-wav", "audio/aac", "audio/3gpp",
}
_ALLOWED_VIDEO_TYPES = {
    "video/mp4", "video/webm", "video/quicktime", "video/3gpp", "video/x-matroska",
}

# Extension used when persisting, keyed by content type.
_MEDIA_EXTENSIONS = {
    "audio/webm": "webm", "audio/ogg": "ogg", "audio/mpeg": "mp3",
    "audio/mp4": "m4a", "audio/wav": "wav", "audio/x-wav": "wav",
    "audio/aac": "aac", "audio/3gpp": "3gp",
    "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
    "video/3gpp": "3gp", "video/x-matroska": "mkv",
}


def _check_av_magic_bytes(data: bytes) -> bool:
    """
    Validate audio/video container signatures, so a Content-Type header alone
    cannot smuggle an arbitrary payload past the filter (TC-S-04).
    """
    if len(data) < 12:
        return False
    # ISO-BMFF (MP4 / M4A / MOV / 3GP): 'ftyp' box at offset 4
    if data[4:8] == b"ftyp":
        return True
    # Matroska / WebM — EBML header
    if data[:4] == b"\x1a\x45\xdf\xa3":
        return True
    # Ogg
    if data[:4] == b"OggS":
        return True
    # RIFF....WAVE
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return True
    # MP3: ID3 tag, or a frame-sync header
    if data[:3] == b"ID3":
        return True
    if data[0] == 0xFF and (data[1] & 0xE0) == 0xE0:
        return True
    # ADTS AAC
    if data[0] == 0xFF and (data[1] & 0xF6) == 0xF0:
        return True
    return False



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


class MediaUploadResponse(BaseModel):
    """Response for WAVE 3 media uploads with ML fields."""
    id: UUID
    storage_key: str
    webp_url: str | None = None
    thumbnail_url: str | None = None
    file_size: int
    mime_type: str
    width: int | None = None
    height: int | None = None
    # WAVE 3 ML fields
    embedding_vector: list[float] | None = None
    ocr_text: str | None = None
    ocr_confidence: float | None = None
    ocr_entities: dict | None = None
    nsfw_score: float | None = None
    license_plate_detected: bool | None = None
    license_plate_bbox: dict | None = None
    safety_metadata: dict | None = None
    created_at: str


async def _store_av(
    request: Request,
    file: UploadFile,
    allowed_types: set[str],
    max_size: int,
    kind: str,
) -> UploadResponse:
    """Shared validate-then-store path for audio and video uploads."""
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported {kind} format.",
        )

    limit_mb = max_size // (1024 * 1024)
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > max_size:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"{kind.capitalize()} must be under {limit_mb} MB.",
        )

    content = await file.read()

    # Re-check after reading: Content-Length may be absent or spoofed.
    if len(content) > max_size:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"{kind.capitalize()} must be under {limit_mb} MB.",
        )
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Empty {kind} file.",
        )
    if not _check_av_magic_bytes(content):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"File content does not match a supported {kind} format.",
        )

    # Duration cap for audio (BR-IR-04). Only measurable without decoding for
    # WAV; compressed formats return None and rely on the byte cap above.
    if kind == "audio":
        duration = estimate_duration_seconds(content, file.content_type or "")
        if duration is not None and duration > settings.stt_max_audio_seconds:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Audio must be under {settings.stt_max_audio_seconds} seconds.",
            )

    ct = file.content_type or ""
    url = upload_media(
        io.BytesIO(content),
        content_type=ct,
        extension=_MEDIA_EXTENSIONS.get(ct, "bin"),
        folder="diagnosis",
    )
    return UploadResponse(url=url, filename=file.filename or f"{kind}-upload", size_bytes=len(content))


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


@router.post("/audio", response_model=UploadResponse)
@limiter.limit("10/minute")
async def upload_audio_endpoint(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Upload an audio recording of the fault (engine noise, etc.). Returns the public URL."""
    return await _store_av(request, file, _ALLOWED_AUDIO_TYPES, _MAX_AUDIO_SIZE, "audio")


@router.post("/video", response_model=UploadResponse)
@limiter.limit("5/minute")
async def upload_video_endpoint(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Upload a short video of the fault. Returns the public URL."""
    return await _store_av(request, file, _ALLOWED_VIDEO_TYPES, _MAX_VIDEO_SIZE, "video")


@router.post("", response_model=MediaUploadResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
async def upload_media_endpoint(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload an image for WAVE 3 media library.

    Returns VehicleMedia with ML analysis fields (OCR, safety detection, embeddings).
    ML features are non-blocking: upload completes even if analysis fails.
    """
    if file.content_type not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only JPEG, PNG, WebP and HEIC images are accepted.",
        )

    # Check Content-Length before reading
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > _MAX_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image must be under 20 MB.",
        )

    content = await file.read()

    # Enforce size after read
    if len(content) > _MAX_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image must be under 20 MB.",
        )

    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Empty image file.",
        )

    # Magic-byte validation
    if not _check_magic_bytes(content):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="File content does not match a supported image format.",
        )

    content_type = file.content_type or "image/jpeg"

    try:
        # Store the image with minimal metadata
        media = await media_library.store_image(
            db,
            content,
            content_type,
            key_prefix="user-uploads",
            source_name=file.filename or "upload.jpg",
            dedupe=True,
        )
        await db.commit()

        # Build response with storage URLs
        from services.media_storage import get_storage
        storage = get_storage()

        return MediaUploadResponse(
            id=media.id,
            storage_key=media.storage_key,
            webp_url=storage.url_for(media.webp_key) if media.webp_key else storage.url_for(media.storage_key),
            thumbnail_url=storage.url_for(media.thumbnail_key) if media.thumbnail_key else None,
            file_size=media.size_bytes,
            mime_type=media.content_type,
            width=media.width,
            height=media.height,
            embedding_vector=media.embedding_vector,
            ocr_text=media.ocr_text,
            ocr_confidence=media.ocr_confidence,
            ocr_entities=media.ocr_entities,
            nsfw_score=media.nsfw_score,
            license_plate_detected=media.license_plate_detected,
            license_plate_bbox=media.license_plate_bbox,
            safety_metadata=media.safety_metadata,
            created_at=media.created_at.isoformat() if media.created_at else "",
        )
    except StorageError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Storage error: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Upload failed: {exc}",
        ) from exc
