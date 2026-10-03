"""
The billed nearby lookup is asked once per question, not once per search.

WHY THIS MATTERS MORE THAN A USUAL CACHE TEST

_stations_live has no table behind it — the Google adapter may not be copied
into charging_stations, so before this every search was an invoice. The rate
limit above it is 60/minute per IP, and double that in practice while Redis is
unreachable and production runs two instances, so the ceiling on billed calls
was set by how fast a button can be pressed.

Two things are asserted here, and the second is the one that could go wrong
quietly:

1. A repeat of the same question does not call Google again.
2. A cached answer reports WHEN IT WAS FETCHED, not "now". This provider
   carries live availability counts; serving a ten-minute-old count stamped as
   current is AC-07's failure — a driver detours to an occupied charger — and
   it would look exactly like a working cache.

The rest pin the ways a cache quietly becomes useless or harmful: a key so
specific it never hits, a key so loose it answers the wrong question, an empty
result frozen in, and an expiry that never arrives.
"""
import asyncio
from datetime import datetime, timedelta, timezone

from models.ev_charging import StationStatus
from services.ev_charging import nearby_cache
from services.ev_charging.providers import (
    GoogleMapsProvider,
    NormalisedCharger,
    NormalisedStation,
)

# The cache is emptied between tests by clear_ev_nearby_cache in conftest.py,
# which every test in the suite needs — not just these.


def _station(name: str = "Ather Grid - Park Street") -> NormalisedStation:
    return NormalisedStation(
        source="google",
        source_station_id="place-1",
        name=name,
        latitude=22.5536,
        longitude=88.3520,
        address="Park Street, Kolkata",
        status=StationStatus.unknown,
        chargers=[NormalisedCharger(power_kw=22.0, total_ports=2, status_is_live=True)],
    )


def test_a_repeat_question_is_served_from_the_cache():
    key = nearby_cache.build_key("google", 22.5536, 88.3520, 15.0, 20)
    asyncio.run(nearby_cache.put(key, [_station()]))

    got = asyncio.run(nearby_cache.get(key))

    assert got is not None
    stations, _ = got
    assert [s.name for s in stations] == ["Ather Grid - Park Street"]


def test_the_fetch_time_survives_so_a_cached_answer_cannot_claim_to_be_now():
    # The assertion the live-availability promise rests on.
    earlier = datetime.now(timezone.utc) - timedelta(minutes=7)
    key = nearby_cache.build_key("google", 22.5536, 88.3520, 15.0, 20)
    asyncio.run(nearby_cache.put(key, [_station()], earlier))

    _, fetched_at = asyncio.run(nearby_cache.get(key))

    assert fetched_at == earlier


def test_the_station_carries_its_own_fetch_time_too():
    # This is the field the router reads for last_updated, so a round trip that
    # dropped it would re-introduce the "now" claim without failing the test
    # above.
    earlier = datetime.now(timezone.utc) - timedelta(minutes=7)
    station = _station()
    station.source_updated_at = earlier
    key = nearby_cache.build_key("google", 22.5536, 88.3520, 15.0, 20)
    asyncio.run(nearby_cache.put(key, [station], earlier))

    stations, _ = asyncio.run(nearby_cache.get(key))

    assert stations[0].source_updated_at == earlier


def test_nearby_coordinates_share_one_key_or_the_cache_never_hits():
    # A GPS fix carries seven decimal places and differs on every reading, so
    # without rounding every search would be a fresh key and the whole module
    # would be a no-op that looked like a saving.
    a = nearby_cache.build_key("google", 22.5536123, 88.3520456, 15.0, 20)
    b = nearby_cache.build_key("google", 22.5536987, 88.3520001, 15.0, 20)

    assert a == b


def test_a_different_question_does_not_reuse_an_answer():
    base = nearby_cache.build_key("google", 22.5536, 88.3520, 15.0, 20)

    assert nearby_cache.build_key("google", 22.5536, 88.3520, 50.0, 20) != base
    assert nearby_cache.build_key("google", 22.5536, 88.3520, 15.0, 5) != base
    assert nearby_cache.build_key("ocm", 22.5536, 88.3520, 15.0, 20) != base
    # Two cities apart, far beyond the rounding grid.
    assert nearby_cache.build_key("google", 19.0760, 72.8777, 15.0, 20) != base


def test_an_empty_result_is_not_cached():
    # Caching "nothing here" would hide a provider that started working again.
    key = nearby_cache.build_key("google", 22.5536, 88.3520, 15.0, 20)
    asyncio.run(nearby_cache.put(key, []))

    assert asyncio.run(nearby_cache.get(key)) is None


def test_an_expired_entry_is_a_miss(monkeypatch):
    key = nearby_cache.build_key("google", 22.5536, 88.3520, 15.0, 20)
    asyncio.run(nearby_cache.put(key, [_station()]))

    # Walk the clock past the window rather than sleeping through it.
    real_monotonic = nearby_cache.time.monotonic
    monkeypatch.setattr(
        nearby_cache.time,
        "monotonic",
        lambda: real_monotonic() + nearby_cache.TTL_SECONDS + 1,
    )

    assert asyncio.run(nearby_cache.get(key)) is None


def test_an_unreadable_entry_is_a_miss_rather_than_an_error():
    # A shape written by an older build. One extra upstream call is the right
    # price; raising would fail the driver's search.
    key = nearby_cache.build_key("google", 22.5536, 88.3520, 15.0, 20)
    nearby_cache._memory[key] = (nearby_cache.time.monotonic() + 600, "{not json")

    assert asyncio.run(nearby_cache.get(key)) is None


def test_chargers_and_their_live_flag_survive_the_round_trip():
    # The expensive half of the payload, and the only reason to be on Google.
    key = nearby_cache.build_key("google", 22.5536, 88.3520, 15.0, 20)
    asyncio.run(nearby_cache.put(key, [_station()]))

    stations, _ = asyncio.run(nearby_cache.get(key))

    assert len(stations[0].chargers) == 1
    assert stations[0].chargers[0].power_kw == 22.0
    assert stations[0].chargers[0].total_ports == 2
    assert stations[0].chargers[0].status_is_live is True
    assert stations[0].status is StationStatus.unknown
    assert stations[0].address == "Park Street, Kolkata"


def test_the_provider_skips_the_http_call_on_a_hit(monkeypatch):
    # End to end through the adapter: a hit must not reach httpx at all. This
    # is the test that actually measures the saving.
    provider = GoogleMapsProvider()
    key = nearby_cache.build_key(provider.name, 22.5536, 88.3520, 15.0, 20)
    asyncio.run(nearby_cache.put(key, [_station()]))

    def _explode(*args, **kwargs):  # pragma: no cover - must never run
        raise AssertionError("Google Places was called despite a warm cache")

    monkeypatch.setattr("httpx.AsyncClient", _explode)

    stations = asyncio.run(provider.nearby(22.5536, 88.3520, 15.0, 20))

    assert [s.name for s in stations] == ["Ather Grid - Park Street"]


def test_disabling_the_window_turns_the_cache_off_without_removing_it(monkeypatch):
    monkeypatch.setattr(nearby_cache, "TTL_SECONDS", 0)
    key = nearby_cache.build_key("google", 22.5536, 88.3520, 15.0, 20)

    asyncio.run(nearby_cache.put(key, [_station()]))

    assert asyncio.run(nearby_cache.get(key)) is None
