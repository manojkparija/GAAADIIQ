"""
Owner video reviews.

The upload form for these sits in the site's main navigation, so the input is
whatever anyone chooses to send. What is asserted here is the boundary: that an
anonymous caller cannot upload, that the bytes are identified as a video by
their content rather than their name, and — the one that matters most — that
nothing reaches a reader before a person has approved it.
"""

import pytest

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
