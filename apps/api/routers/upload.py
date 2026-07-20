"""
POST /upload/image — accept an image file, store in Cloudflare R2, return URL.
Used by Angular diagnosis wizard to upload photos before submitting diagnosis.
"""
from __future__ import annotations

import io

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel

from core.dependencies import get_current_user
from core.limiter import limiter
from models.user import User
from services.storage import upload_image

router = APIRouter(prefix="/upload", tags=["upload"])


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
    if file.content_type not in ("image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only JPEG, PNG, WebP and HEIC images are accepted.",
        )

    content = await file.read()
    if len(content) > 20 * 1024 * 1024:  # 20 MB
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image must be under 20 MB.",
        )

    url = upload_image(io.BytesIO(content), prefix="diagnosis")
    return UploadResponse(url=url, filename=file.filename or "upload", size_bytes=len(content))
