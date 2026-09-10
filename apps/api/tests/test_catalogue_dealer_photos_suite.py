"""
Approved dealer photographs reach buyers, and can be put in order.

TWO REPORTS, ONE AREA

First: eight Baleno photographs approved in Image Review, and Baleno absent
from New Cars entirely. car_images.car_id references public.cars — the
catalogue table, not a listing — so an approved row there IS a photograph of
that catalogue model, and /media-admin/list has always agreed. urls_for_cars,
which fills image_urls for every buyer-facing surface, selected VehicleMedia
alone. So one API told an admin the car had photographs and told buyers it had
none, and because isShowable() hides a catalogue row with no photograph, the
model vanished rather than merely losing its pictures.

Second, once those photographs were visible: the card led with the boot, and
pressing ↑ on the first dealer photograph did nothing. The gallery was two
lists concatenated, each table numbering its own rows from zero, so a position
meant nothing outside its own list and no dealer photograph could ever lead.
On this car that mattered — every real exterior shot was a dealer photograph.

THE RULE UNDER TEST

_gallery_order merges the two, and decides how from the data itself:

  - positions collide across the stores -> nobody has arranged this car, so
    curated first then dealer, which is exactly the order it always had.
  - positions are distinct              -> the reorder endpoint has renumbered
    every photograph into one 0..n-1 sequence, so honour it.

That is what lets one car be rearranged without shuffling every gallery that
nobody has touched, with no marker column and no migration.

WHY THESE TESTS EXIST AT ALL

Neither CI job executes the car_images query.

  - "Lint & Test" runs on SQLite, where the table does not exist, so the
    helper returns at its table check.
  - "Test on Postgres" builds its database from the Alembic chain, and
    car_images is not in it — the table comes from the hand-run Supabase
    migrations (see CLAUDE.md on schema living in two places).

A green CI therefore says nothing about this code. These drive it directly.
"""
import uuid

import pytest

from services.media_library import (
    _LISTING,
    _MEDIA_LIBRARY,
    _add_approved_dealer_photos,
    _gallery_order,
    gallery_is_arranged,
)


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return self._rows


class _FakeConn:
    def __init__(self, table_exists):
        self.table_exists = table_exists

    async def run_sync(self, fn):
        # The helper asks the inspector whether car_images is there; the real
        # call needs a live sync connection and the answer is all that matters.
        return bool(self.table_exists)


class FakeDb:
    def __init__(self, rows, table_exists=True):
        self.rows = rows
        self.table_exists = table_exists
        self.executed = False

    async def connection(self):
        return _FakeConn(self.table_exists)

    async def execute(self, stmt, params=None):
        self.executed = True
        self.params = params
        return _Rows(self.rows)


CAR = uuid.uuid4()
OTHER = uuid.uuid4()


def curated(position, url, seq=0):
    return (position, _MEDIA_LIBRARY, seq, url)


def dealer(position, url, seq=0):
    return (position, _LISTING, seq, url)


# ── the dealer photographs reach the gallery at all ─────────────────────────

@pytest.mark.asyncio
async def test_an_approved_photograph_reaches_the_gallery():
    # The first report: a catalogue car whose only photographs came through
    # the review queue.
    entries = {CAR: []}
    db = FakeDb([{"car_id": CAR, "url": "https://cdn.test/baleno-front.jpg", "sort_order": 0}])

    await _add_approved_dealer_photos(db, entries)

    assert _gallery_order(entries[CAR]) == ["https://cdn.test/baleno-front.jpg"]


@pytest.mark.asyncio
async def test_a_missing_table_is_not_an_error():
    # car_images exists only where the hand-run Supabase migrations have been
    # applied. An environment without it has no dealer photographs — which is
    # what an untouched gallery says. It must not take /cars down.
    entries = {CAR: []}
    db = FakeDb([{"car_id": CAR, "url": "never-read", "sort_order": 0}], table_exists=False)

    await _add_approved_dealer_photos(db, entries)

    assert entries[CAR] == []
    assert db.executed is False


@pytest.mark.asyncio
async def test_a_row_for_a_car_outside_this_page_is_ignored():
    entries = {CAR: []}
    db = FakeDb([{"car_id": OTHER, "url": "https://cdn.test/other.jpg", "sort_order": 0}])

    await _add_approved_dealer_photos(db, entries)

    assert entries[CAR] == []
    assert OTHER not in entries


@pytest.mark.asyncio
async def test_a_row_with_no_url_is_skipped():
    # car_images is written by several flows and its url column is not
    # guaranteed. An empty string in a gallery renders as a broken image.
    entries = {CAR: []}
    db = FakeDb([
        {"car_id": CAR, "url": "", "sort_order": 0},
        {"car_id": CAR, "url": "https://cdn.test/real.jpg", "sort_order": 1},
    ])

    await _add_approved_dealer_photos(db, entries)

    assert _gallery_order(entries[CAR]) == ["https://cdn.test/real.jpg"]


# ── the order a buyer gets ──────────────────────────────────────────────────

def test_an_unarranged_gallery_keeps_curated_photographs_first():
    # THE REGRESSION GUARD. Both stores number from zero, so ordering on the
    # number alone would interleave them and shuffle every gallery in the
    # catalogue. Colliding positions mean nobody has arranged this car.
    items = [
        curated(0, "c0"), curated(1, "c1"),
        dealer(0, "d0"), dealer(1, "d1"),
    ]

    assert _gallery_order(items) == ["c0", "c1", "d0", "d1"]


def test_an_arranged_gallery_lets_a_dealer_photograph_lead():
    # The reported case, after the admin moves the front shot to the top. The
    # reorder endpoint renumbers everything into one sequence, so the
    # positions no longer collide and the numbers are honoured.
    items = [
        curated(1, "boot"), curated(2, "interior"),
        dealer(0, "front"), dealer(3, "rear"),
    ]

    assert _gallery_order(items) == ["front", "boot", "interior", "rear"]


def test_a_flagged_hero_still_leads():
    # is_primary outranks every number in the media-library half; urls_for_cars
    # passes it as position -1. A gallery that ignored it would disagree with
    # the flag the admin set.
    items = [curated(-1, "hero", seq=1), curated(0, "first-by-number", seq=0)]

    assert _gallery_order(items)[0] == "hero"


def test_a_curated_photograph_wins_a_tied_position():
    # Two photographs claiming the same place is the un-arranged state, and
    # there the curated one has always gone first.
    items = [dealer(0, "d"), curated(0, "c")]

    assert _gallery_order(items) == ["c", "d"]


def test_the_arranged_check_is_the_overlap():
    # Stated directly because both the read path and the admin listing ask it,
    # and them answering differently is the fault this area keeps producing.
    assert gallery_is_arranged({0, 1, 2}, {3, 4}) is True
    assert gallery_is_arranged({0, 1}, {0, 1, 2}) is False
    assert gallery_is_arranged(set(), {0, 1}) is True
    assert gallery_is_arranged({0}, set()) is True
