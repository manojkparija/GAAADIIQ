"""Nearest-mechanic search from a stranded car's GPS fix.

Deliberately not PostGIS. The search is "active mechanics within ~15km of this
point, nearest first" over a table that will hold thousands of rows, not millions,
and the test suite runs on in-memory SQLite where an extension is not available.
A bounding-box prefilter in SQL followed by an exact haversine sort in Python is
both accurate and fast enough at this size.

If the mechanic table ever reaches a scale where this hurts, the replacement is a
PostGIS `geography` column with a GiST index — the callers here would not change.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.mechanic import Mechanic, MechanicStatus

EARTH_RADIUS_KM = 6371.0088

# One degree of latitude is ~111.32km everywhere. Longitude shrinks with latitude,
# so the box is widened by 1/cos(lat) — without that, a search near the north of
# India would be narrower east-west than intended and would miss mechanics.
KM_PER_DEG_LAT = 111.32


@dataclass(frozen=True)
class MechanicMatch:
    mechanic: Mechanic
    distance_km: float


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in kilometres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def _bounding_box(lat: float, lng: float, radius_km: float) -> tuple[float, float, float, float]:
    d_lat = radius_km / KM_PER_DEG_LAT
    # Guard the poles, where cos(lat) tends to zero and the longitude span blows up.
    cos_lat = max(math.cos(math.radians(lat)), 0.01)
    d_lng = radius_km / (KM_PER_DEG_LAT * cos_lat)
    return lat - d_lat, lat + d_lat, lng - d_lng, lng + d_lng


async def find_nearest_mechanics(
    db: AsyncSession,
    latitude: float,
    longitude: float,
    radius_km: float,
    limit: int = 10,
    specialisation: str | None = None,
) -> list[MechanicMatch]:
    """Active, available mechanics within `radius_km`, nearest first.

    A mechanic is only returned when the point falls inside *both* radii — the
    customer's search radius and the mechanic's own `service_radius_km`. A shop
    that only covers its own neighbourhood should not be dispatched across the
    city just because the customer widened their search.
    """
    min_lat, max_lat, min_lng, max_lng = _bounding_box(latitude, longitude, radius_km)

    stmt = (
        select(Mechanic)
        .where(
            Mechanic.status == MechanicStatus.active,
            Mechanic.is_available.is_(True),
            Mechanic.latitude.is_not(None),
            Mechanic.longitude.is_not(None),
            Mechanic.latitude >= min_lat,
            Mechanic.latitude <= max_lat,
            Mechanic.longitude >= min_lng,
            Mechanic.longitude <= max_lng,
        )
        # Generous: the box prefilter is approximate, so over-fetch and let the
        # exact distance filter below do the real work.
        .limit(max(limit * 10, 100))
    )
    rows = (await db.execute(stmt)).scalars().all()

    matches: list[MechanicMatch] = []
    for m in rows:
        if specialisation and specialisation not in (m.specialisations or []):
            continue
        distance = haversine_km(latitude, longitude, m.latitude, m.longitude)
        if distance > radius_km:
            # Corner of the bounding box, outside the circle.
            continue
        if distance > m.service_radius_km:
            continue
        matches.append(MechanicMatch(mechanic=m, distance_km=round(distance, 2)))

    matches.sort(key=lambda match: match.distance_km)
    return matches[:limit]
