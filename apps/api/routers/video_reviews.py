"""
Owner video reviews.

    POST   /video-reviews              signed in — submit a video review
    GET    /video-reviews/mine         signed in — your own, any status
    GET    /video-reviews/car/{car_id} public    — approved only
    GET    /video-reviews/pending      admin     — the moderation queue
    POST   /video-reviews/{id}/approve admin
    POST   /video-reviews/{id}/reject  admin     — reason required
    DELETE /video-reviews/{id}         author or admin

WHY THIS EXISTS RATHER THAN EXTENDING THE BROWSER'S SUPABASE PATH

The car detail page writes its reviews from the browser directly into Supabase
with `user_id: null` and pushes videos into a public bucket. As an entry in the
site's main navigation that becomes a public, unauthenticated upload form for
arbitrary files served back under GAADIIQ's domain. Every check below — who is
uploading, what the bytes actually are, how large, how often — needs a server
to be true, so the upload comes here.

NOTHING IS SERVED BEFORE A PERSON APPROVES IT

Submissions land as `pending`. The public read filters on `approved`, and the
object itself is stored privately and only ever handed out as a short-lived
signed URL — so an unapproved video is not merely unlisted, it is unfetchable.
Holding the row while the bytes are public at a guessable URL would be
theatre.
"""
# NOTE: deliberately NOT using `from __future__ import annotations` — PEP 563
# turns annotations into strings and FastAPI then reads body params as query
# params.

import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_admin_user, get_current_user
from core.limiter import limiter
from db.session import get_db
from models.user import User
from models.video_review import VideoReview, VideoReviewStatus
from services import storage
from services.video_review import (
    MAX_BODY_CHARS,
    MAX_TITLE_CHARS,
    MAX_VIDEO_BYTES,
    VideoRejected,
    clean_text,
    content_type_for,
    storage_key,
    validate_video,
)

logger = logging.getLogger("gaadiiq.video_reviews")

router = APIRouter(prefix="/video-reviews", tags=["video-reviews"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]
AdminUser = Annotated[User, Depends(get_admin_user)]


class VideoReviewOut(BaseModel):
    id: uuid.UUID
    car_id: uuid.UUID
    car_label: str | None
    rating: int
    title: str | None
    body: str | None
    status: str
    author_name: str | None
    created_at: datetime | None
    # Short-lived and regenerated per response; never stored.
    video_url: str | None
    review_note: str | None


def _out(review: VideoReview, *, include_video: bool) -> VideoReviewOut:
    """
    Map a row to its response.

    `include_video` is passed by each endpoint rather than derived from the
    status here, because the two differ: an admin moderating a pending review
    must be able to watch it, and the author of a rejected one must not have to
    guess which file was refused. A public reader gets a URL only for approved
    reviews, and that is enforced by the query, not by this flag.
    """
    return VideoReviewOut(
        id=review.id,
        car_id=review.car_id,
        car_label=review.car_label,
        rating=review.rating,
        title=review.title,
        body=review.body,
        status=review.status.value,
        author_name=getattr(review.author, "full_name", None) if review.author else None,
        created_at=review.created_at,
        video_url=storage.signed_url(review.video_key) if include_video else None,
        review_note=review.review_note,
    )


@router.post("", response_model=VideoReviewOut, status_code=status.HTTP_201_CREATED)
# Deliberately tight. Each request can carry 50 MB, so this is a bandwidth and
# storage limit as much as an abuse one — and nobody legitimately reviews five
# cars an hour.
@limiter.limit("5/hour")
async def submit_video_review(
    request: Request,
    db: DbDep,
    current_user: CurrentUser,
    car_id: uuid.UUID = Form(...),
    rating: int = Form(...),
    car_label: str = Form(""),
    title: str = Form(""),
    body: str = Form(""),
    video: UploadFile = File(...),
):
    """Submit a video review. It is held for moderation and is not public."""
    if not 1 <= rating <= 5:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Rating must be 1 to 5.")

    # Read with a hard ceiling rather than .read() outright: the ceiling is the
    # point, and reading the whole body first to measure it is how you get
    # exhausted by the request you were about to reject.
    data = await video.read(MAX_VIDEO_BYTES + 1)
    if len(data) > MAX_VIDEO_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"Video must be under {MAX_VIDEO_BYTES // (1024 * 1024)} MB.",
        )

    try:
        container = validate_video(data)
    except VideoRejected as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, exc.reason) from exc

    key = storage_key(str(car_id), str(current_user.id), container)
    try:
        storage.upload_private(data, key, content_type_for(container))
    except RuntimeError as exc:
        logger.exception("Video upload failed for user %s", current_user.id)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "We could not store that video just now. Please try again.",
        ) from exc

    review = VideoReview(
        author_id=current_user.id,
        car_id=car_id,
        car_label=clean_text(car_label, 200),
        rating=rating,
        title=clean_text(title, MAX_TITLE_CHARS),
        body=clean_text(body, MAX_BODY_CHARS),
        video_key=key,
        video_content_type=content_type_for(container),
        video_bytes=len(data),
        status=VideoReviewStatus.pending,
    )
    db.add(review)
    await db.commit()
    await db.refresh(review)

    logger.info("Video review %s submitted by %s for car %s", review.id, current_user.id, car_id)
    return _out(review, include_video=True)


@router.get("/mine", response_model=list[VideoReviewOut])
async def my_video_reviews(db: DbDep, current_user: CurrentUser):
    """Your own submissions, whatever their status — including why one was refused."""
    rows = (
        await db.execute(
            select(VideoReview)
            .where(VideoReview.author_id == current_user.id)
            .order_by(VideoReview.created_at.desc())
        )
    ).scalars().all()
    return [_out(r, include_video=True) for r in rows]


@router.get("/car/{car_id}", response_model=list[VideoReviewOut])
@limiter.limit("60/minute")
async def approved_reviews_for_car(request: Request, car_id: uuid.UUID, db: DbDep):
    """
    Approved reviews for one car.

    The status filter is in the query rather than applied to the results,
    so a pending review cannot leak through a change to the serialiser.
    """
    rows = (
        await db.execute(
            select(VideoReview)
            .where(
                VideoReview.car_id == car_id,
                VideoReview.status == VideoReviewStatus.approved,
            )
            .order_by(VideoReview.created_at.desc())
            .limit(50)
        )
    ).scalars().all()
    return [_out(r, include_video=True) for r in rows]


@router.get("/pending", response_model=list[VideoReviewOut])
async def pending_queue(db: DbDep, admin: AdminUser):
    """The moderation queue, oldest first — the order they should be dealt with."""
    rows = (
        await db.execute(
            select(VideoReview)
            .where(VideoReview.status == VideoReviewStatus.pending)
            .order_by(VideoReview.created_at.asc())
            .limit(200)
        )
    ).scalars().all()
    return [_out(r, include_video=True) for r in rows]


class ModerationBody(BaseModel):
    note: str | None = None


@router.post("/{review_id}/approve", response_model=VideoReviewOut)
async def approve(review_id: uuid.UUID, payload: ModerationBody, db: DbDep, admin: AdminUser):
    review = await db.get(VideoReview, review_id)
    if review is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such review.")

    review.status = VideoReviewStatus.approved
    review.reviewed_by = admin.id
    review.reviewed_at = datetime.now(timezone.utc)
    review.review_note = clean_text(payload.note, 1000)
    await db.commit()
    await db.refresh(review)

    # Named, because "why is this on the site" is asked after the fact and an
    # approval with nobody against it cannot answer.
    logger.info("Video review %s approved by %s", review_id, admin.id)
    return _out(review, include_video=True)


@router.post("/{review_id}/reject", response_model=VideoReviewOut)
async def reject(review_id: uuid.UUID, payload: ModerationBody, db: DbDep, admin: AdminUser):
    """A rejection needs a reason — the author is shown it, and "no" is not an answer."""
    note = clean_text(payload.note, 1000)
    if not note:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Please give a reason — the author is shown it.",
        )

    review = await db.get(VideoReview, review_id)
    if review is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such review.")

    review.status = VideoReviewStatus.rejected
    review.reviewed_by = admin.id
    review.reviewed_at = datetime.now(timezone.utc)
    review.review_note = note
    await db.commit()
    await db.refresh(review)

    logger.info("Video review %s rejected by %s", review_id, admin.id)
    return _out(review, include_video=True)


@router.delete("/{review_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_video_review(review_id: uuid.UUID, db: DbDep, current_user: CurrentUser):
    """
    Withdraw your own review, or remove any as an admin.

    The stored object goes too. A takedown that leaves the file fetchable by
    anyone holding an old signed URL has not taken anything down, and for a
    review the author asked to remove, keeping their video is not defensible.
    """
    review = await db.get(VideoReview, review_id)
    if review is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such review.")

    is_admin = bool(getattr(current_user, "is_admin", False))
    if review.author_id != current_user.id and not is_admin:
        # 404 rather than 403: whether a review id exists is not a stranger's
        # business, and 403 confirms it does.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such review.")

    storage.delete_key(review.video_key)
    await db.delete(review)
    await db.commit()

    logger.info("Video review %s deleted by %s (admin=%s)", review_id, current_user.id, is_admin)
