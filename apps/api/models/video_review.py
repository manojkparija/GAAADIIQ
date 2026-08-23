"""
Owner video reviews.

WHY THIS IS NOT THE EXISTING car_reviews PATH

The car detail page writes reviews from the browser straight into Supabase,
unauthenticated (`user_id: null`), with videos going to a public bucket and no
check on what lands there. That is survivable while it is buried inside a car
page. It is not survivable as an entry in the main navigation, which is what a
"Video Review" item under More would be: a public, unauthenticated upload form
for arbitrary video files, served back under GAADIIQ's own domain.

So this table exists, and the upload goes through the API where it can be
authenticated, size- and type-checked, rate-limited and recorded.

NOTHING IS PUBLIC UNTIL A PERSON APPROVES IT

`status` starts at `pending` and only an admin moves it to `approved`. The
read endpoints filter on it. This is the whole point of the table — a video
that nobody has looked at is never served to anyone, so an upload cannot put
content under the site's name without a human deciding it should be there.

The moderation columns record who decided and when, because "why is this
video on the site" is a question that gets asked after the fact, and an
approval with no name against it cannot answer it.
"""
import enum
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from .user import User


class VideoReviewStatus(str, enum.Enum):
    """
    Where a submission is in the queue.

    `pending` and `rejected` are distinct from `withdrawn`: the first two are
    our decision and the third is the author's, and an author who deletes their
    own review should not look like someone we turned down.

    There is no `auto_approved`. If a check ever becomes confident enough to
    publish without a person, that is a change to who approves — recorded in
    `reviewed_by` — not a status that quietly means "nobody looked".
    """

    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    withdrawn = "withdrawn"


class VideoReview(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "video_reviews"
    __table_args__ = (
        CheckConstraint("rating >= 1 AND rating <= 5", name="ck_video_review_rating_range"),
        # A rejection without a reason is unanswerable when the author asks why.
        CheckConstraint(
            "status <> 'rejected' OR review_note IS NOT NULL",
            name="ck_video_review_rejection_has_reason",
        ),
        # The list every reader hits: approved reviews for one car, newest first.
        Index("ix_video_reviews_car_status", "car_id", "status"),
        # The moderation queue.
        Index("ix_video_reviews_status_created", "status", "created_at"),
    )

    # The author. NOT NULL on purpose — an anonymous video upload is the thing
    # this table exists to prevent, and a nullable column here would let it
    # back in the first time someone writes an endpoint that forgets the check.
    author_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )

    # What is being reviewed. `cars.id` is a UUID in the ORM whatever the batch
    # SQL says. No FK: the catalogue is rebuilt by ingestion and a cascade from
    # it would silently delete people's reviews.
    car_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    # Denormalised so a review still reads correctly if the catalogue row moves.
    car_label: Mapped[str | None] = mapped_column(String(200))

    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    title: Mapped[str | None] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(Text)

    # ── The video ────────────────────────────────────────────────────────────
    # A storage key, not a URL. URLs expire, move between buckets and CDNs, and
    # embed the host; the key is the thing that identifies the object.
    video_key: Mapped[str] = mapped_column(String(500), nullable=False)
    video_content_type: Mapped[str | None] = mapped_column(String(100))
    video_bytes: Mapped[int | None] = mapped_column(Integer)
    duration_seconds: Mapped[float | None] = mapped_column(Float)

    # ── Moderation ───────────────────────────────────────────────────────────
    status: Mapped[VideoReviewStatus] = mapped_column(
        Enum(VideoReviewStatus, name="video_review_status", native_enum=True),
        default=VideoReviewStatus.pending,
        nullable=False,
    )
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    reviewed_at: Mapped[object | None] = mapped_column(DateTime(timezone=True))
    # Shown to the author on a rejection, so the message is not "no".
    review_note: Mapped[str | None] = mapped_column(Text)

    author: Mapped["User"] = relationship(foreign_keys=[author_id])

    @property
    def is_public(self) -> bool:
        """Only approved reviews are ever served to a reader."""
        return self.status == VideoReviewStatus.approved

    def __repr__(self) -> str:
        return f"<VideoReview id={self.id} car={self.car_id} status={self.status.value}>"
