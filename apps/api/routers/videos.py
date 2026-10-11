"""
GAADIIQ's own videos, for the Reviews & News hub.

  GET    /videos            published videos, newest first (public)
  POST   /videos            add one from a YouTube link (admin)
  PATCH  /videos/{id}       edit, publish, unpublish (admin)
  DELETE /videos/{id}       remove (admin)

The public list is readable without signing in, like the rest of that hub.

No `from __future__ import annotations` here: it breaks FastAPI's signature
introspection and body params start being read as query params.
"""
import re
import uuid
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_admin_user
from db.session import get_db
from models.user import User
from models.video import Video

router = APIRouter(prefix="/videos", tags=["videos"])

#: Exactly what YouTube uses, and nothing else.
YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")

#: The hosts a GAADIIQ video can legitimately come from. An allow-list rather
#: than a pattern: "contains youtube.com" is satisfied by
#: evil.com/youtube.com and by youtube.com.attacker.net.
_HOSTS = {
    "youtube.com", "www.youtube.com", "m.youtube.com",
    "youtu.be", "www.youtu.be",
    "youtube-nocookie.com", "www.youtube-nocookie.com",
}


def extract_youtube_id(value: str) -> str:
    """
    The eleven-character id, from a link in any of the shapes people paste.

    WHY THIS IS STRICTER THAN IT LOOKS

    The returned id is interpolated into an iframe `src` in the browser. A
    function that is merely permissive here is what turns a pasted string into
    script execution on the page, so this refuses anything it cannot positively
    identify rather than making a best effort.

    Accepted:
      https://www.youtube.com/watch?v=ID       the share link
      https://youtu.be/ID                      the short link
      https://www.youtube.com/embed/ID         an embed someone copied
      https://www.youtube.com/shorts/ID        a Short
      https://www.youtube.com/live/ID          a stream
      ID                                       the bare id

    Everything else raises, including a link to a playlist or a channel: those
    are real YouTube URLs that are not one video, and quietly taking the first
    eleven characters of something would publish the wrong thing.
    """
    raw = (value or "").strip()
    if not raw:
        raise ValueError("No YouTube link or id given.")

    # A bare id. Checked first so a paste of just the id needs no URL parsing.
    if YOUTUBE_ID.match(raw):
        return raw

    # urlparse treats a scheme-less string as a path, so "youtu.be/ID" would
    # arrive with no host and fall through to the error below. People paste it
    # that way constantly.
    if "://" not in raw:
        raw = "https://" + raw

    try:
        parsed = urlparse(raw)
    except ValueError as exc:                                 # pragma: no cover
        raise ValueError("That does not parse as a link.") from exc

    host = (parsed.hostname or "").lower()
    if host not in _HOSTS:
        raise ValueError(
            "Only YouTube links are accepted, and that host is not one of them."
        )

    # /watch?v=ID
    if parsed.path == "/watch":
        candidate = parse_qs(parsed.query or "").get("v", [""])[0]
    # youtu.be/ID, /embed/ID, /shorts/ID, /live/ID
    else:
        parts = [p for p in (parsed.path or "").split("/") if p]
        if host in {"youtu.be", "www.youtu.be"}:
            candidate = parts[0] if parts else ""
        elif len(parts) >= 2 and parts[0] in {"embed", "shorts", "live", "v"}:
            candidate = parts[1]
        else:
            candidate = ""

    if not YOUTUBE_ID.match(candidate or ""):
        raise ValueError(
            "That is a YouTube link but not to a single video — a playlist or "
            "a channel cannot be embedded as one."
        )
    return candidate


class VideoOut(BaseModel):
    id: uuid.UUID
    youtube_id: str
    title: str
    description: str | None = None
    car_id: uuid.UUID | None = None
    car_label: str | None = None
    is_published: bool
    published_at: datetime | None = None

    model_config = {"from_attributes": True}


class VideoCreate(BaseModel):
    #: A link in any shape, or the bare id. Named `url` because that is what an
    #: admin is pasting.
    url: str
    title: str
    description: str | None = None
    car_id: uuid.UUID | None = None
    car_label: str | None = None
    published_at: datetime | None = None

    @field_validator("title")
    @classmethod
    def _title_present(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("A title is required — the hub lists videos by it.")
        return v[:200]


class VideoUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    car_id: uuid.UUID | None = None
    car_label: str | None = None
    is_published: bool | None = None
    published_at: datetime | None = None


@router.get("", response_model=list[VideoOut])
async def list_videos(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(24, ge=1, le=100),
):
    """
    Published videos, newest first.

    Published only, and that filter lives here rather than in the browser: it
    is the same question for every caller, and a page that has to remember to
    apply it is a page that will one day forget.

    An unpublished video is ordered last by published_at being NULL, but it is
    excluded outright — ordering is not access control.
    """
    rows = (
        await db.execute(
            select(Video)
            .where(Video.is_published.is_(True))
            .order_by(Video.published_at.desc().nullslast(), Video.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    return [VideoOut.model_validate(v) for v in rows]


@router.get("/all", response_model=list[VideoOut])
async def list_all_videos(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    """Everything, published or not — what the admin screen lists."""
    rows = (
        await db.execute(
            select(Video).order_by(
                Video.published_at.desc().nullslast(), Video.created_at.desc()
            )
        )
    ).scalars().all()
    return [VideoOut.model_validate(v) for v in rows]


@router.post("", response_model=VideoOut, status_code=status.HTTP_201_CREATED)
async def add_video(
    payload: VideoCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    try:
        youtube_id = extract_youtube_id(payload.url)
    except ValueError as exc:
        # 400 with the reason: an admin pasting a playlist link needs to be told
        # which part was wrong, not that the request was bad.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    video = Video(
        youtube_id=youtube_id,
        title=payload.title,
        description=payload.description,
        car_id=payload.car_id,
        car_label=payload.car_label,
        published_at=payload.published_at or datetime.now(timezone.utc),
    )
    db.add(video)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        # The unique constraint. Publishing the same video twice is a mistake,
        # and saying so beats a 500.
        raise HTTPException(
            status.HTTP_409_CONFLICT, "That video is already on the hub."
        ) from exc
    await db.refresh(video)
    return VideoOut.model_validate(video)


@router.patch("/{video_id}", response_model=VideoOut)
async def update_video(
    video_id: uuid.UUID,
    payload: VideoUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    video = (
        await db.execute(select(Video).where(Video.id == video_id))
    ).scalar_one_or_none()
    if video is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such video.")

    # exclude_unset, so a PATCH that only unpublishes does not blank the title
    # by sending None for every field the caller did not mention.
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(video, field, value)

    await db.commit()
    await db.refresh(video)
    return VideoOut.model_validate(video)


@router.delete("/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_video(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    """
    Remove it entirely.

    Unpublishing is the softer action and is what the admin screen offers
    first; this is here for a video added by mistake, where keeping the row
    records nothing worth keeping.
    """
    video = (
        await db.execute(select(Video).where(Video.id == video_id))
    ).scalar_one_or_none()
    if video is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such video.")
    await db.delete(video)
    await db.commit()
