"""
A short-lived cache in front of a billed nearby-station lookup.

## Why this exists

`_stations_live` in routers/ev_charging.py exists because Google Places may not
be copied into our tables, so that path asks upstream on *every* search. Its own
docstring calls the cost out: "an upstream call per search, where OCM pays for
one and serves the rest from our own table".

That is the only uncached billable call in the service, and the rate limit above
it is 60/minute per IP — doubled in practice, because core/limiter.py falls back
to per-process counters when Redis is unreachable and production runs more than
one instance. So the ceiling on billed calls is set by how fast someone can
press a button, not by how much distinct data they are asking for.

Two readers searching the same city minutes apart were paying twice for an
identical answer. Now the second is free.

## Storing versus caching, which is the whole point

The licence distinction this rests on is already drawn in `_stations_live`:
Google's terms "allow showing the data and caching it briefly, not accumulating
it". This is the first half and not the second:

  * it expires, by `TTL_SECONDS` below, and nothing renews an entry in place;
  * it is keyed by the question, not by station, so it never becomes a
    directory of places that can be listed, searched or joined against;
  * it is Redis or process memory, never a table, so `may_store` stays False
    and the database path remains closed to this provider.

**This is a judgement call about a contract, not a fact about the code, and it
should be confirmed against the Google Maps Platform terms the account is on
before it carries real traffic.** `TTL_SECONDS` is the dial if a shorter window
is wanted; setting it to 0 disables the cache without removing anything.

## Why ten minutes, and not the twenty-four hours ai_cache uses

Because this provider reports live availability — `live_availability = True`,
per-charger counts from operators who report to Google. A day-old count served
as current is the failure AC-07 names: a driver detours to a charger that is
occupied. Ten minutes bounds that staleness to something a driver can act on,
and still collapses the case this is actually for — several people searching
one city, or one person retrying.

For the same reason the fetch time travels *with* the entry rather than being
assumed to be now. `_stations_live` sets each station's `last_updated` from it,
so a cached answer reports when it was really obtained. Reporting "now" for a
ten-minute-old count would make the cache a correctness bug instead of a saving.

## Failure

Never raises, and never fails a search. Redis when reachable; otherwise a
bounded in-process dict with the same expiry; otherwise every lookup misses and
the caller behaves exactly as it did before this file existed.
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import asdict
from datetime import datetime, timezone

from models.ev_charging import ChargerStatus, ConnectorType, CurrentType, StationStatus
from services import redis_support

logger = logging.getLogger("gaadiiq.ev_charging.nearby_cache")

_LABEL = "EV nearby cache"

#: Ten minutes. See the module docstring — this is bounded by live availability
#: going stale, not by how long a station stays where it is. Set to 0 to disable.
TTL_SECONDS = 10 * 60

#: The in-process fallback is not the production path; this only stops it
#: growing without limit on a deployment that has no Redis.
MAX_MEMORY_ENTRIES = 256

#: Decimal places kept when a search's centre becomes part of its key.
#:
#: Two places is about 1.1 km of latitude, so the worst case is a reader served
#: the answer for a point ~0.8 km from where they stood. The smallest radius the
#: page offers is 5 km, and the router re-filters every station by true distance
#: from the *caller's* coordinates afterwards, so the window moves slightly and
#: the distances stay honest.
#:
#: Without rounding this cache would never hit: a GPS fix carries seven decimal
#: places and is different every reading, so every search would be a fresh key
#: and the whole file would be a no-op that looked like a saving.
_COORD_DP = 2

#: key -> (expires_at_monotonic, payload)
_memory: dict[str, tuple[float, str]] = {}

_stats = {"hits": 0, "misses": 0, "stores": 0, "skips": 0}


def stats() -> dict:
    """Counters. A hit rate near zero means the key is too specific."""
    total = _stats["hits"] + _stats["misses"]
    return {
        **_stats,
        "hit_rate": round(_stats["hits"] / total, 3) if total else 0.0,
        "ttl_seconds": TTL_SECONDS,
    }


def build_key(
    provider: str, latitude: float, longitude: float, radius_km: float, limit: int
) -> str:
    """One key per question asked, with the centre rounded to a grid."""
    raw = "|".join(
        [
            provider,
            f"{round(float(latitude), _COORD_DP):.{_COORD_DP}f}",
            f"{round(float(longitude), _COORD_DP):.{_COORD_DP}f}",
            f"{float(radius_km):.1f}",
            str(int(limit)),
        ]
    )
    return "ev_nearby:" + hashlib.sha256(raw.encode()).hexdigest()[:40]


def _encode(stations: list, fetched_at: datetime) -> str:
    rows = []
    for station in stations:
        row = asdict(station)
        # Enums and datetimes do not survive json.dumps, and `raw` is never
        # populated by the provider this guards: normalise_google_place sets
        # raw=None deliberately, because raw exists to be stored.
        row["status"] = station.status.value
        row["source_updated_at"] = (
            station.source_updated_at.isoformat() if station.source_updated_at else None
        )
        row["raw"] = None
        row["chargers"] = [
            {
                **asdict(charger),
                "connector_type": charger.connector_type.value,
                "current_type": charger.current_type.value,
                "status": charger.status.value,
            }
            for charger in station.chargers
        ]
        rows.append(row)
    return json.dumps({"fetched_at": fetched_at.isoformat(), "stations": rows})


def _decode(payload: str) -> tuple[list, datetime] | None:
    # Imported here rather than at module scope: providers.py imports this
    # module, so a top-level import back into it would be circular.
    from services.ev_charging.providers import NormalisedCharger, NormalisedStation

    try:
        data = json.loads(payload)
        fetched_at = datetime.fromisoformat(data["fetched_at"])
        stations = []
        for row in data["stations"]:
            chargers = [
                NormalisedCharger(
                    connector_type=ConnectorType(c["connector_type"]),
                    current_type=CurrentType(c["current_type"]),
                    power_kw=c.get("power_kw"),
                    voltage=c.get("voltage"),
                    amperage=c.get("amperage"),
                    total_ports=c.get("total_ports"),
                    status=ChargerStatus(c["status"]),
                    status_is_live=bool(c.get("status_is_live")),
                )
                for c in row.get("chargers") or []
            ]
            updated = row.get("source_updated_at")
            stations.append(
                NormalisedStation(
                    source=row["source"],
                    source_station_id=row["source_station_id"],
                    name=row["name"],
                    latitude=row["latitude"],
                    longitude=row["longitude"],
                    operator_name=row.get("operator_name"),
                    address=row.get("address"),
                    city=row.get("city"),
                    state=row.get("state"),
                    country=row.get("country"),
                    postcode=row.get("postcode"),
                    status=StationStatus(row["status"]),
                    source_url=row.get("source_url"),
                    source_updated_at=(
                        datetime.fromisoformat(updated) if updated else None
                    ),
                    data_confidence=row.get("data_confidence"),
                    raw=None,
                    chargers=chargers,
                )
            )
        return stations, fetched_at
    except Exception as exc:
        # A shape written by an older build, or a truncated value. Treating it
        # as a miss costs one upstream call; raising would fail the search.
        logger.info("EV nearby cache: unreadable entry dropped (%s)", exc)
        return None


async def get(key: str) -> tuple[list, datetime] | None:
    """The stations for this question, and when they were really fetched."""
    if TTL_SECONDS <= 0:
        return None

    raw = None
    client = await redis_support.client(_LABEL, logger)
    if client is not None:
        try:
            raw = await client.get(key)
        except Exception as exc:
            logger.info("EV nearby cache: Redis read failed (%s); using fallback", exc)
            redis_support.forget(_LABEL)
            raw = None

    if raw is None:
        entry = _memory.get(key)
        if entry is not None:
            expires_at, payload = entry
            if time.monotonic() < expires_at:
                raw = payload
            else:
                # Expiry is checked on read because nothing sweeps this dict.
                _memory.pop(key, None)

    if raw is None:
        _stats["misses"] += 1
        return None

    decoded = _decode(raw if isinstance(raw, str) else raw.decode())
    if decoded is None:
        _stats["misses"] += 1
        return None

    _stats["hits"] += 1
    return decoded


async def put(key: str, stations: list, fetched_at: datetime | None = None) -> None:
    """Store an answer. Never raises: the caller already has what it needs."""
    if TTL_SECONDS <= 0:
        return
    if not stations:
        # An empty result is cheap to re-ask for and may simply mean the area
        # had nothing indexed at that moment. Caching it would hide a provider
        # that started working again.
        _stats["skips"] += 1
        return

    try:
        payload = _encode(stations, fetched_at or datetime.now(timezone.utc))
    except Exception as exc:
        logger.info("EV nearby cache: could not encode (%s)", exc)
        _stats["skips"] += 1
        return

    client = await redis_support.client(_LABEL, logger)
    if client is not None:
        try:
            await client.setex(key, TTL_SECONDS, payload)
            _stats["stores"] += 1
            return
        except Exception as exc:
            logger.info("EV nearby cache: Redis write failed (%s); using fallback", exc)
            redis_support.forget(_LABEL)

    if len(_memory) >= MAX_MEMORY_ENTRIES:
        # Crude, but the fallback is not the production path and an LRU here
        # would be more machinery than the situation earns.
        _memory.clear()
    _memory[key] = (time.monotonic() + TTL_SECONDS, payload)
    _stats["stores"] += 1


def _reset_for_tests() -> None:
    _memory.clear()
    for name in _stats:
        _stats[name] = 0
