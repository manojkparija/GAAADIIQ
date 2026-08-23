"""
Owner video reviews.

The upload form for these sits in the site's main navigation, so the input is
whatever anyone chooses to send. What is asserted here is the boundary: that an
anonymous caller cannot upload, that the bytes are identified as a video by
their content rather than their name, and — the one that matters most — that
nothing reaches a reader before a person has approved it.
"""

import uuid as _uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.dependencies import get_admin_user, get_current_user
from db.session import get_db
from main import app
from models.user import User
from models.video_review import VideoReview, VideoReviewStatus
from services.video_review import (
    MAX_VIDEO_BYTES,
    MIN_VIDEO_BYTES,
    VideoRejected,
    clean_text,
    content_type_for,
    sniff_container,
    storage_key,
    validate_video,
)

# Real container headers. An ISO-BMFF file is [size][ftyp][brand]; Matroska is
# an EBML stream. Padded past the minimum size so the size check passes.
MP4 = b"\x00\x00\x00\x20ftypisom" + b"\x00" * MIN_VIDEO_BYTES
MOV = b"\x00\x00\x00\x20ftypqt  " + b"\x00" * MIN_VIDEO_BYTES
WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * MIN_VIDEO_BYTES


# ── What the bytes actually are ──────────────────────────────────────────────


def test_real_containers_are_recognised():
    assert sniff_container(MP4[:32]) == "mp4"
    assert sniff_container(MOV[:32]) == "quicktime"
    assert sniff_container(WEBM[:32]) == "webm"


def test_a_renamed_file_is_rejected_however_it_is_labelled():
    """
    The extension and the Content-Type are both written by the client. Neither
    is evidence. An HTML file called clip.mp4 is one line of work for someone
    who wants a phishing page hosted on the site's own domain, and the bucket
    will serve back whatever type it was handed.
    """
    hostile = [
        b"<!DOCTYPE html><html><body><script>alert(1)</script></body></html>",
        b"<?php system($_GET['c']); ?>",
        b"GIF89a" + b"\x00" * 100,                    # a real image, not a video
        b"%PDF-1.7\n" + b"\x00" * 100,
        b"PK\x03\x04" + b"\x00" * 100,                # zip
        b"\x00\x00\x00\x20ftypEVIL" + b"\x00" * 100,  # ISO box, brand we do not accept
    ]
    for payload in hostile:
        data = payload + b"\x00" * MIN_VIDEO_BYTES
        with pytest.raises(VideoRejected) as caught:
            validate_video(data)
        assert caught.value.code == "unsupported_format"


def test_oversized_and_empty_uploads_are_refused_with_distinct_reasons():
    with pytest.raises(VideoRejected) as too_big:
        validate_video(b"\x00" * (MAX_VIDEO_BYTES + 1))
    assert too_big.value.code == "too_large"
    # The uploader is told the limit — there is nothing secret about it.
    assert "50" in too_big.value.reason

    with pytest.raises(VideoRejected) as too_small:
        validate_video(b"\x00\x00\x00\x20ftypisom")
    assert too_small.value.code == "too_small"


def test_the_served_content_type_comes_from_the_bytes_not_the_client():
    """
    Stored type is looked up from the sniffed container. If it came from the
    upload's Content-Type, a caller could have their file served back as
    text/html from the site's own origin.
    """
    assert content_type_for(validate_video(MP4)) == "video/mp4"
    assert content_type_for(validate_video(MOV)) == "video/quicktime"
    assert content_type_for(validate_video(WEBM)) == "video/webm"


# ── Where it is stored ───────────────────────────────────────────────────────


def test_the_storage_key_never_uses_the_uploaders_filename():
    """
    The filename is attacker-controlled and arrives with separators and unicode
    in it. Nothing downstream needs it, so it is not used at all.
    """
    key = storage_key("../../etc/passwd", "../../../root", "mp4")
    assert ".." not in key
    assert key.startswith("video-reviews/")
    assert key.endswith(".mp4")
    # Two uploads of the same file by the same author must not collide.
    assert storage_key("car", "author", "mp4") != storage_key("car", "author", "mp4")


def test_clean_text_bounds_length_and_drops_control_characters():
    assert clean_text("a" * 500, 200) == "a" * 200
    assert "\x00" not in (clean_text("hi\x00there", 200) or "")
    assert clean_text("   ", 200) is None
    assert clean_text(None, 200) is None
    # Newlines survive: a review body is prose.
    assert "\n" in (clean_text("line one\nline two", 200) or "")


# ── The moderation gate ──────────────────────────────────────────────────────


def test_a_submission_is_not_public_until_approved():
    """
    The property the whole table exists for. A row starts pending and
    is_public stays false through every state except approved — including
    withdrawn, which must not read as approved just because it is not rejected.
    """
    from models.video_review import VideoReview, VideoReviewStatus

    review = VideoReview(status=VideoReviewStatus.pending)
    assert review.is_public is False

    for status in (VideoReviewStatus.rejected, VideoReviewStatus.withdrawn):
        review.status = status
        assert review.is_public is False, f"{status} must not be public"

    review.status = VideoReviewStatus.approved
    assert review.is_public is True


def test_the_status_enum_has_no_auto_approved_state():
    """
    Guards a shortcut rather than a bug. A state meaning "published without a
    person looking" is the thing the queue exists to prevent, and adding one is
    a decision to make deliberately — not something to slip in because a check
    seemed confident enough that day.
    """
    from models.video_review import VideoReviewStatus

    assert {s.value for s in VideoReviewStatus} == {
        "pending", "approved", "rejected", "withdrawn",
    }


def test_upload_private_does_not_make_the_object_public(monkeypatch):
    """
    Holding the row while the bytes sit at a public URL is theatre: the
    uploader already has a working gaadiiq.com link to hand round, which is
    most of what they wanted if the intent was to host something unpleasant.

    upload_image() and upload_media() both pass ACL "public-read". This path
    must not.
    """
    from services import storage

    captured: dict = {}

    class _Client:
        def put_object(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(storage, "_r2_available", lambda: True)
    monkeypatch.setattr(storage, "_r2_client", lambda: _Client())

    storage.upload_private(b"data", "video-reviews/a/b/c.mp4", "video/mp4")

    assert captured["Key"] == "video-reviews/a/b/c.mp4"
    assert captured["ContentType"] == "video/mp4"
    assert "ACL" not in captured, "a moderated object must not be uploaded public-read"


def test_storage_helpers_degrade_rather_than_raise_without_credentials(monkeypatch):
    """Dev and CI have no R2. The key is still the identifier; only fetching fails."""
    from services import storage

    monkeypatch.setattr(storage, "_r2_available", lambda: False)

    assert storage.upload_private(b"x", "k/e/y.mp4", "video/mp4") == "k/e/y.mp4"
    assert storage.signed_url("k/e/y.mp4") is None
    storage.delete_key("k/e/y.mp4")  # must not raise


def test_signed_urls_are_short_lived(monkeypatch):
    """
    A signed URL pasted somewhere public should stop working before it
    spreads. Fifteen minutes is long enough to watch a two-minute clip.
    """
    from services import storage

    captured: dict = {}

    class _Client:
        def generate_presigned_url(self, op, Params, ExpiresIn):  # noqa: N803
            captured["expires"] = ExpiresIn
            return "https://signed.example/x"

    monkeypatch.setattr(storage, "_r2_available", lambda: True)
    monkeypatch.setattr(storage, "_r2_client", lambda: _Client())

    assert storage.signed_url("k") == "https://signed.example/x"
    assert captured["expires"] <= 3600, "a signed URL for held content must expire promptly"


def test_the_upload_endpoint_requires_a_signed_in_user():
    """
    The reason this router exists. The browser's existing car-review path
    inserts with user_id null; putting an upload form in the main navigation
    on top of that is an open door.
    """
    import inspect

    from routers import video_reviews

    sig = inspect.signature(video_reviews.submit_video_review)
    assert "current_user" in sig.parameters, "upload must depend on an authenticated user"


def test_rejecting_without_a_reason_is_refused():
    """The author is shown the note, and "no" is not an answer."""
    import inspect

    from routers import video_reviews

    source = inspect.getsource(video_reviews.reject)
    assert "if not note" in source


# ── The moderation queue ─────────────────────────────────────────────────────


def test_the_queue_can_show_settled_rows_not_just_pending():
    """
    A decision has to be revisitable. An approved video that turns out to be a
    problem needs taking down, and a rejection the author disputes needs
    looking at again — a screen that can only ever see the untouched pile makes
    both of those a database job.
    """
    import inspect

    from routers import video_reviews

    sig = inspect.signature(video_reviews.moderation_queue)
    assert "status_filter" in sig.parameters

    source = inspect.getsource(video_reviews.moderation_queue)
    # The filter is applied in the query, not to the results — so a pending row
    # cannot leak through a change to the serialiser.
    assert "VideoReview.status == wanted" in source


def test_an_unknown_queue_status_is_refused_rather_than_ignored():
    """
    Falling back to a default on a bad filter would show the wrong list while
    looking like it worked — worse than an error on an admin screen where the
    list drives an irreversible decision.
    """
    import inspect

    from routers import video_reviews

    source = inspect.getsource(video_reviews.moderation_queue)
    assert "except ValueError" in source
    assert "422" in source or "HTTP_422" in source


def test_the_queue_and_counts_require_an_admin():
    """Both expose every submission, including ones nobody has looked at yet."""
    import inspect

    from routers import video_reviews

    for fn in (video_reviews.moderation_queue, video_reviews.queue_counts):
        params = inspect.signature(fn).parameters
        assert "admin" in params, f"{fn.__name__} must require an admin"


def test_approve_and_reject_require_an_admin():
    import inspect

    from routers import video_reviews

    for fn in (video_reviews.approve, video_reviews.reject):
        params = inspect.signature(fn).parameters
        assert "admin" in params, f"{fn.__name__} must require an admin"


def test_a_moderation_decision_records_who_made_it():
    """
    "Why is this video on the site" gets asked after the fact, and an approval
    with nobody against it cannot answer.
    """
    import inspect

    from routers import video_reviews

    for fn in (video_reviews.approve, video_reviews.reject):
        source = inspect.getsource(fn)
        assert "reviewed_by = admin.id" in source, f"{fn.__name__} must record the decider"
        assert "reviewed_at" in source, f"{fn.__name__} must record when"


# ── Functional: the gate actually holds ──────────────────────────────────────
#
# The tests above read the source. These drive the real endpoints through the
# app, which is what decides whether the queue works — a check that a call site
# LOOKS right has already, in this session, passed against code with the call
# site deleted.



@pytest_asyncio.fixture
async def session_factory(db_engine):
    return async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)


@pytest_asyncio.fixture
async def people(session_factory):
    """An author and an admin, both real rows — author_id is NOT NULL."""
    async with session_factory() as s:
        author = User(
            id=_uuid.uuid4(), email="author@test.local", hashed_password="x",
            full_name="Ada Author", role="buyer", is_verified=False, is_active=True,
        )
        admin = User(
            id=_uuid.uuid4(), email="admin@test.local", hashed_password="x",
            full_name="Ann Admin", role="admin", is_verified=True, is_active=True,
        )
        s.add_all([author, admin])
        await s.commit()
        return {"author": author, "admin": admin}


@pytest_asyncio.fixture
async def client(session_factory):
    async def override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def _seed(session_factory, author, status=VideoReviewStatus.pending, note=None):
    async with session_factory() as s:
        row = VideoReview(
            author_id=author.id, car_id=_uuid.uuid4(), car_label="Tata Nexon EV",
            rating=4, title="Two years in", video_key="video-reviews/a/b/c.mp4",
            status=status, review_note=note,
        )
        s.add(row)
        await s.commit()
        await s.refresh(row)
        return row


@pytest.mark.asyncio
async def test_a_pending_review_is_not_served_to_the_public(client, session_factory, people):
    """
    The property the whole feature rests on, driven end to end rather than read
    off the source.
    """
    row = await _seed(session_factory, people["author"])

    resp = await client.get(f"/video-reviews/car/{row.car_id}")
    assert resp.status_code == 200
    assert resp.json() == [], "a pending review must not appear on the public endpoint"


@pytest.mark.asyncio
async def test_an_approved_review_is_served(client, session_factory, people):
    row = await _seed(session_factory, people["author"], VideoReviewStatus.approved)

    body = (await client.get(f"/video-reviews/car/{row.car_id}")).json()
    assert len(body) == 1
    assert body[0]["status"] == "approved"


@pytest.mark.asyncio
async def test_rejected_and_withdrawn_are_not_served_either(client, session_factory, people):
    """Not-approved is the rule, not not-rejected."""
    for status in (VideoReviewStatus.rejected, VideoReviewStatus.withdrawn):
        row = await _seed(
            session_factory, people["author"], status,
            note="reason" if status == VideoReviewStatus.rejected else None,
        )
        body = (await client.get(f"/video-reviews/car/{row.car_id}")).json()
        assert body == [], f"{status.value} must not be public"


@pytest.mark.asyncio
async def test_the_queue_refuses_an_anonymous_caller_in_production(
    client, session_factory, people, monkeypatch
):
    """
    The queue exposes every submission, including ones nobody has looked at.

    Note what this has to do to be a real test. core.dependencies.get_admin_user
    carries a DEVELOPMENT BYPASS: with no credentials and is_production false it
    returns a synthetic "Dev Admin" and the request succeeds. That is a
    project-wide convention, not something this router chose — but it means the
    obvious version of this test (call it anonymously, expect 401) passes
    against a wide-open endpoint in dev and proves nothing about production.

    It is also why ENVIRONMENT being wrong in a deployment would open every
    admin endpoint at once, this one included.
    """
    from core.config import settings

    await _seed(session_factory, people["author"])

    monkeypatch.setattr(type(settings), "is_production", property(lambda self: True))
    resp = await client.get("/video-reviews/queue")
    assert resp.status_code in (401, 403), f"got {resp.status_code}"


@pytest.mark.asyncio
async def test_an_admin_sees_the_pending_queue(client, session_factory, people):
    await _seed(session_factory, people["author"])
    app.dependency_overrides[get_admin_user] = lambda: people["admin"]

    body = (await client.get("/video-reviews/queue")).json()
    assert len(body) == 1
    assert body[0]["status"] == "pending"


@pytest.mark.asyncio
async def test_an_unknown_queue_status_is_refused(client, people):
    app.dependency_overrides[get_admin_user] = lambda: people["admin"]
    resp = await client.get("/video-reviews/queue", params={"status_filter": "nonsense"})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_approving_makes_it_public_and_records_the_decider(
    client, session_factory, people
):
    row = await _seed(session_factory, people["author"])
    app.dependency_overrides[get_admin_user] = lambda: people["admin"]

    resp = await client.post(f"/video-reviews/{row.id}/approve", json={"note": ""})
    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"

    # Now visible to the public.
    assert len((await client.get(f"/video-reviews/car/{row.car_id}")).json()) == 1

    async with session_factory() as s:
        stored = await s.get(VideoReview, row.id)
        assert stored.reviewed_by == people["admin"].id
        assert stored.reviewed_at is not None


@pytest.mark.asyncio
async def test_rejecting_without_a_reason_is_refused_by_the_endpoint(
    client, session_factory, people
):
    row = await _seed(session_factory, people["author"])
    app.dependency_overrides[get_admin_user] = lambda: people["admin"]

    resp = await client.post(f"/video-reviews/{row.id}/reject", json={"note": "   "})
    assert resp.status_code == 422

    async with session_factory() as s:
        assert (await s.get(VideoReview, row.id)).status == VideoReviewStatus.pending


@pytest.mark.asyncio
async def test_a_stranger_cannot_delete_someone_elses_review(
    client, session_factory, people
):
    """404 rather than 403 — whether an id exists is not a stranger's business."""
    row = await _seed(session_factory, people["author"])
    stranger = User(
        id=_uuid.uuid4(), email="nosy@test.local", hashed_password="x",
        full_name="Nosy", role="buyer", is_verified=False, is_active=True,
    )
    async with session_factory() as s:
        s.add(stranger)
        await s.commit()

    app.dependency_overrides[get_current_user] = lambda: stranger
    resp = await client.delete(f"/video-reviews/{row.id}")
    assert resp.status_code == 404

    async with session_factory() as s:
        assert await s.get(VideoReview, row.id) is not None, "the row must survive"
