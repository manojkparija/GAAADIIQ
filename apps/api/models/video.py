"""
GAADIIQ's own videos, shown on the Reviews & News hub.

WHY THIS TABLE EXISTS RATHER THAN A COLUMN ON `news`

The obvious home looked like the news surface, and it is not one. GET /news is
a LIVE THIRD-PARTY FEED -- services/news_feed.fetch() pulls Indian motoring
press headlines -- so there is nowhere in it to put something of ours. There
is also a `news` table in supabase/migrations/001, and nothing in the frontend
or this API reads it; it shipped and was never wired up. Adding a column to a
table no query touches would have looked like progress and shipped nothing.

WHY A YOUTUBE ID AND NOT A URL

`youtube_id` is the eleven-character video id, not a link. Two reasons, and
the second is the important one:

- A URL carries a host, and the same video has several (youtube.com,
  youtu.be, m.youtube.com, with or without query junk). The id is the thing
  that identifies the video.
- The id is what gets interpolated into an iframe `src`. Storing a free-text
  URL and pasting it into an embed is how a stored value becomes script
  execution on the page. A column that can only hold [A-Za-z0-9_-]{11} cannot
  express a javascript: URL or a different origin, so the embed is safe by
  construction rather than by remembering to escape at every call site.

The CHECK constraint is on the column, not only in the API. Validation in a
request handler protects the one path somebody remembered to route through it.

`car_id` has NO foreign key, for the same reason video_reviews.car_id has
none: the catalogue is rebuilt by ingestion and a cascade from it would
silently delete the editorial record of a video that still exists.
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base, TimestampMixin, UUIDMixin


class Video(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "videos"
    __table_args__ = (
        # Postgres-only, and ddl_if rather than a bare constraint because `~`
        # is a syntax error in SQLite -- which part of the test suite runs on,
        # so an unguarded constraint fails CREATE TABLE and every test in the
        # file errors before it starts. Found that way, not predicted: an
        # earlier draft of this comment asserted SQLite would accept and
        # ignore it.
        #
        # Where the constraint is absent the API's own validation is the only
        # guard, which is exactly why extract_youtube_id refuses anything it
        # cannot positively identify rather than making a best effort.
        CheckConstraint(
            "youtube_id ~ '^[A-Za-z0-9_-]{11}$'",
            name="ck_video_youtube_id_shape",
        ).ddl_if(dialect="postgresql"),
        # The list everyone hits: published videos, newest first.
        Index("ix_videos_published", "is_published", "published_at"),
    )

    #: The eleven characters YouTube identifies a video by. Unique, because
    #: publishing the same video twice is a mistake rather than a use case.
    youtube_id: Mapped[str] = mapped_column(String(11), nullable=False, unique=True)

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    #: Which car this is about, where it is about one. Optional: a channel
    #: trailer or a buying-guide video is about no single model, and forcing a
    #: car onto it would mean inventing one.
    car_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    #: Denormalised label, so a video still reads correctly if the catalogue
    #: row it points at moves or is rebuilt. Same reasoning as
    #: video_reviews.car_label.
    car_label: Mapped[str | None] = mapped_column(String(200))

    #: Unpublishing is not deleting. A video taken off the hub is still a
    #: record of something that was published, and a delete loses the reason
    #: it was ever there.
    is_published: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    #: Editorial order. Separate from created_at so a video added late can be
    #: dated to when it went out, rather than to when somebody got round to
    #: pasting the link in.
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    def __repr__(self) -> str:
        return f"<Video id={self.id} youtube_id={self.youtube_id!r}>"
