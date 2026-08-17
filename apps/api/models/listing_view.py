"""
One row per time somebody looked at a listing.

`listings.views_count` already existed and is a bare integer — it can say a car
has been seen 240 times and nothing else. Every question the marketplace
actually needs answered is about *when*: how many people looked in the last
24 hours, whether interest is rising or dying, how long a car has been sitting.
None of those can be recovered from a counter, and none of them can be
backfilled later, which is why this exists before the features that read it.

The counter stays. It is denormalised, cheap to read on a list page, and
dropping it would mean a COUNT over this table for every card in a grid.

WHAT IS NOT STORED

No IP address, no user agent, no cookie beyond the anonymous id the browser
already sends. A signed-in viewer's id is kept because the seller's analytics
and the matchmaker both need "the same person came back", and it is deleted
with the user. An anonymous viewer gets a random id from their own browser that
means nothing on its own and is never joined to anything else.
"""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base, UUIDMixin

if TYPE_CHECKING:
    from .listing import Listing


class ListingView(UUIDMixin, Base):
    __tablename__ = "listing_views"

    listing_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("listings.id", ondelete="CASCADE"), nullable=False
    )

    # Null for a signed-out visitor. ON DELETE SET NULL rather than CASCADE: a
    # user closing their account should not silently rewrite a seller's traffic
    # history for the past six months.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Browser-generated, opaque, and the only way to tell two anonymous viewers
    # apart. Never joined to anything outside this table.
    visitor_key: Mapped[str | None] = mapped_column(String(64), nullable=True)

    viewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    listing: Mapped["Listing"] = relationship()

    __table_args__ = (
        # Every read is "this listing, since this moment", so the index has to
        # carry the timestamp — listing_id alone still walks the whole history
        # of a popular car to count the last 24 hours.
        Index("ix_listing_views_listing_time", "listing_id", "viewed_at"),
        # For the matchmaker: what has this person been looking at lately.
        Index("ix_listing_views_user_time", "user_id", "viewed_at"),
    )

    def __repr__(self) -> str:
        return f"<ListingView listing={self.listing_id} at={self.viewed_at}>"
