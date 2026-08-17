"""
What someone has actually been looking at, as opposed to what they told a quiz.

The recommender scores listings against four answers a buyer typed into a form
once. That is a statement of intent, and intent drifts: people say "sedan,
under ten lakh" and then spend an hour on compact SUVs at twelve. The form
never finds out.

This reads the listing_views table and builds a small profile — which makes,
body types and fuels a person keeps returning to, and the price range they
actually browse. It is used to *nudge* the existing score, never to replace it:
someone who says ten lakh is their ceiling must not be shown fifteen-lakh cars
because they looked at one out of curiosity.

DELIBERATE LIMITS

Only signed-in users get a profile. An anonymous browser key is enough to count
distinct viewers on one listing; following it across the catalogue to build a
taste profile is a different thing, and not one to do without an account.

A profile needs a real history behind it. Below MIN_VIEWS the profile comes
back empty and the recommender falls through to the form answers alone — three
views is not a preference, and inferring one from it produces confident,
wrong recommendations that are worse than the honest generic ones.

The window is deliberately short. A car someone looked at eight months ago says
little about what they want now; they have very likely already bought.
"""

from __future__ import annotations

import logging
import uuid
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.listing import Listing
from models.listing_view import ListingView

logger = logging.getLogger("gaadiiq.behaviour")

#: Views needed before browsing counts as a preference.
MIN_VIEWS = 5

#: How far back to look. Beyond this the buyer has probably already bought.
WINDOW_DAYS = 60

#: The most a behavioural signal may add to a listing's score.
#:
#: Small on purpose. Explicit answers are what the buyer *said*; this is what
#: they did, and when the two disagree the stated budget wins. A large weight
#: here turns a recommender into a filter bubble that shows a person more of
#: whatever they clicked first.
MAX_BOOST = 15


@dataclass
class BehaviourProfile:
    makes: Counter = field(default_factory=Counter)
    body_types: Counter = field(default_factory=Counter)
    fuel_types: Counter = field(default_factory=Counter)
    #: Interquartile-ish range of what they browse, not min/max: one look at a
    #: Fortuner should not widen the range to twenty lakh.
    typical_price_min: int = 0
    typical_price_max: int = 0
    view_count: int = 0
    has_enough_data: bool = False

    def top_make(self) -> str | None:
        return self.makes.most_common(1)[0][0] if self.makes else None

    def top_body(self) -> str | None:
        return self.body_types.most_common(1)[0][0] if self.body_types else None


async def build_profile(db: AsyncSession, user_id: uuid.UUID | None) -> BehaviourProfile:
    """The buyer's recent browsing, or an empty profile when there is too little."""
    if user_id is None:
        return BehaviourProfile()

    since = datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS)

    rows = (
        await db.execute(
            select(Listing)
            .join(ListingView, ListingView.listing_id == Listing.id)
            .options(selectinload(Listing.car))
            .where(ListingView.user_id == user_id, ListingView.viewed_at >= since)
        )
    ).scalars().all()

    profile = BehaviourProfile(view_count=len(rows))
    if len(rows) < MIN_VIEWS:
        return profile

    prices: list[float] = []
    for lst in rows:
        car = lst.car
        if car:
            if car.make:
                profile.makes[car.make] += 1
            if car.body_type is not None:
                profile.body_types[getattr(car.body_type, "value", str(car.body_type))] += 1
            if car.fuel_type is not None:
                profile.fuel_types[getattr(car.fuel_type, "value", str(car.fuel_type))] += 1
        if lst.price:
            prices.append(float(lst.price))

    if prices:
        prices.sort()
        # Trim the ends: the one aspirational look and the one bargain do not
        # describe what this person is shopping for.
        lo = prices[len(prices) // 4]
        hi = prices[(len(prices) * 3) // 4]
        profile.typical_price_min = int(lo)
        profile.typical_price_max = int(hi)

    profile.has_enough_data = True
    return profile


def behaviour_boost(listing: Listing, profile: BehaviourProfile) -> tuple[int, list[str]]:
    """
    Extra points for a listing that matches how someone actually browses.

    Returns (points, reasons). Reasons are phrased so the buyer can tell this
    came from their own browsing — a recommendation whose reason is invisible
    reads as the site pushing stock.

    `listing.car` must already be loaded. Both callers select with
    `selectinload(Listing.car)`; touching an unloaded relationship here raises
    MissingGreenlet under asyncio rather than quietly issuing a query, which is
    the correct behaviour but only if the caller knows to expect it.
    """
    if not profile.has_enough_data:
        return 0, []

    points = 0
    reasons: list[str] = []
    car = listing.car
    if car is None:
        return 0, []

    if car.make and profile.makes.get(car.make):
        points += 6
        reasons.append(f"You have been looking at {car.make} cars")

    body = getattr(car.body_type, "value", None)
    if body and profile.body_types.get(body):
        points += 5
        reasons.append(f"You browse {body} models often")

    fuel = getattr(car.fuel_type, "value", None)
    if fuel and profile.fuel_types.get(fuel):
        points += 4
        reasons.append(f"Matches the {fuel} cars you have viewed")

    if profile.typical_price_max and listing.price:
        price = float(listing.price)
        if profile.typical_price_min <= price <= profile.typical_price_max:
            points += 5
            reasons.append("In the price range you usually browse")

    return min(points, MAX_BOOST), reasons
