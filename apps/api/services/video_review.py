"""
Accepting a video file from the public.

The upload form for these sits in the site's main navigation, so the input is
whatever anyone chooses to send. Everything below is about the file itself;
who may upload is the router's job, and nothing here assumes it was checked.

WHY THE EXTENSION IS NOT CONSULTED

The browser's `accept="video/*"` is a file-picker filter, and the Content-Type
on the part is whatever the client wrote. Neither is evidence. A `.mp4`
suffix on an HTML file is one line of work for anyone who wants to host a
phishing page on your domain, and the storage bucket will serve it back with
whatever type it was told. So the container is identified from the bytes.
"""
import logging
import re

logger = logging.getLogger("gaadiiq.video_review")

# 50 MB. Chosen to match the limit the existing car-review form already told
# users about rather than to be defensible on its own — a couple of minutes of
# phone video at 1080p sits well inside it.
MAX_VIDEO_BYTES = 50 * 1024 * 1024

# Small enough that it is not a real video, and the upload is a mistake or a
# probe. Reported as its own error so the message can say something useful.
MIN_VIDEO_BYTES = 8 * 1024

MAX_TITLE_CHARS = 200
MAX_BODY_CHARS = 5000


class VideoRejected(ValueError):
    """The uploaded file is not something we will store. Carries a public reason."""

    def __init__(self, reason: str, code: str):
        super().__init__(reason)
        self.reason = reason
        self.code = code


# Container signatures, checked against the bytes.
#
# ISO-BMFF (mp4, m4v, mov) puts a four-byte size then 'ftyp' at offset 4, with
# the brand following. WebM/Matroska is an EBML stream starting 1A 45 DF A3.
_ISO_BRANDS = {
    b"isom", b"iso2", b"iso4", b"iso5", b"iso6", b"mp41", b"mp42",
    b"avc1", b"M4V ", b"qt  ", b"XAVC",
}
_EBML_MAGIC = b"\x1a\x45\xdf\xa3"

# What each container is stored and served as. The stored type comes from this
# table, never from the client, so the bucket cannot be told to serve
# text/html for a file we accepted as a video.
_CONTENT_TYPE = {
    "mp4": "video/mp4",
    "quicktime": "video/quicktime",
    "webm": "video/webm",
}


def sniff_container(head: bytes) -> str | None:
    """
    The container these bytes actually are, or None.

    `head` needs to be at least the first 32 bytes; anything shorter cannot
    carry either signature and is treated as unrecognised.
    """
    if len(head) < 12:
        return None

    if head[:4] == _EBML_MAGIC:
        return "webm"

    if head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in _ISO_BRANDS:
            # QuickTime and mp4 share the box structure; the brand separates
            # them and they are served as different types.
            return "quicktime" if brand == b"qt  " else "mp4"
        # An ftyp box with a brand we do not know is still ISO-BMFF, but we do
        # not accept containers we cannot name — "probably fine" is how a
        # polyglot file gets in.
        return None

    return None


def content_type_for(container: str) -> str:
    return _CONTENT_TYPE.get(container, "application/octet-stream")


def validate_video(data: bytes) -> str:
    """
    Check an uploaded file and return the container name.

    Raises VideoRejected with a reason meant to be shown to the uploader —
    a size limit they exceeded is useful to know, and there is nothing secret
    about it.
    """
    size = len(data)
    if size > MAX_VIDEO_BYTES:
        raise VideoRejected(
            f"That video is {size / (1024 * 1024):.0f} MB. The limit is "
            f"{MAX_VIDEO_BYTES // (1024 * 1024)} MB — please trim it or record at a lower quality.",
            "too_large",
        )
    if size < MIN_VIDEO_BYTES:
        raise VideoRejected("That file is too small to be a video.", "too_small")

    container = sniff_container(data[:32])
    if container is None:
        raise VideoRejected(
            "That file is not a video we can play. Please upload MP4, MOV or WebM.",
            "unsupported_format",
        )
    return container


def storage_key(car_id: str, author_id: str, container: str) -> str:
    """
    Where the object lives.

    Namespaced by car and author so a listing's videos are enumerable and one
    author's uploads can be found and removed together — which is what a
    takedown actually needs.

    The uploader's filename is never used. It is attacker-controlled, arrives
    with path separators and unicode in it, and nothing downstream needs it.
    """
    import uuid as _uuid

    ext = {"mp4": "mp4", "quicktime": "mov", "webm": "webm"}[container]
    safe_car = re.sub(r"[^a-zA-Z0-9-]", "", str(car_id))[:64] or "unknown"
    safe_author = re.sub(r"[^a-zA-Z0-9-]", "", str(author_id))[:64] or "unknown"
    return f"video-reviews/{safe_car}/{safe_author}/{_uuid.uuid4().hex}.{ext}"


def clean_text(value: str | None, limit: int) -> str | None:
    """Trim, drop control characters, and bound the length."""
    if value is None:
        return None
    text = "".join(c for c in value if c.isprintable() or c in "\n\t").strip()
    return text[:limit] or None
