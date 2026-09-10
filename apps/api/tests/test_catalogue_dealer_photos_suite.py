"""
Approved dealer photographs reach buyers, not just the admin panel.

Reported three times: eight Baleno photographs approved in Image Review, and
Baleno absent from New Cars entirely.

car_images.car_id references public.cars — the catalogue table, not a listing
— so an approved row there IS a photograph of that catalogue model, and
/media-admin/list has always agreed: it unions both tables into the admin
browse panel. urls_for_cars, which fills image_urls for every buyer-facing
surface, selected VehicleMedia alone.

So one API told an admin the car had photographs and told buyers it had none.
Worse than a missing gallery: isShowable() on the client hides a catalogue row
with no photograph, so the model vanished from New Cars altogether — which is
why the page read "2 models available" against five in the catalogue.

WHY THESE TESTS EXIST AT ALL

Neither CI job executes this query.

  - "Lint & Test" runs on SQLite, where car_images does not exist, so the
    helper returns at its table check and the SQL is never reached.
  - "Test on Postgres" builds its database from the Alembic chain, and
    car_images is not in it — the table is created by the hand-run Supabase
    migrations (see CLAUDE.md on schema living in two places).

A green CI therefore says nothing about this code, which is exactly the trap
the twelve excluded test files carry. These drive the helper directly so the
guard and the append order are pinned by something.

What they still cannot cover is the SQL executing against a real car_images
table. That is why the statement uses an expanding bindparam rather than
`= ANY(:ids)`: ANY() is Postgres-only and hands asyncpg a bare list whose
array type it must infer, and a mistake there would first appear in
production, on every /cars request, as a 500 that empties the catalogue.
"""
import uuid

import pytest

from services.media_library import _append_approved_dealer_photos


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


@pytest.mark.asyncio
async def test_an_approved_photograph_reaches_the_gallery():
    # The reported case: a catalogue car whose only photographs came through
    # the review queue.
    out = {CAR: []}
    db = FakeDb([{"car_id": CAR, "url": "https://cdn.test/baleno-front.jpg"}])

    await _append_approved_dealer_photos(db, out, 8)

    assert out[CAR] == ["https://cdn.test/baleno-front.jpg"]


@pytest.mark.asyncio
async def test_it_goes_behind_a_curated_photograph():
    # Where both exist the admin's own upload stays the hero shot: it is the
    # curated one, and the card's first image is what a buyer sees in the grid.
    out = {CAR: ["https://cdn.test/curated.webp"]}
    db = FakeDb([{"car_id": CAR, "url": "https://cdn.test/dealer.jpg"}])

    await _append_approved_dealer_photos(db, out, 8)

    assert out[CAR] == ["https://cdn.test/curated.webp", "https://cdn.test/dealer.jpg"]


@pytest.mark.asyncio
async def test_per_car_is_respected():
    # per_car keeps a hundred-car page from carrying thousands of URLs. A
    # dealer photograph must not be the one that ignores it.
    out = {CAR: ["a", "b"]}
    db = FakeDb([
        {"car_id": CAR, "url": "c"},
        {"car_id": CAR, "url": "d"},
    ])

    await _append_approved_dealer_photos(db, out, 3)

    assert out[CAR] == ["a", "b", "c"]


@pytest.mark.asyncio
async def test_a_car_that_is_already_full_is_not_queried_for():
    # Nothing to add means nothing to ask. This also keeps the query off the
    # hot path for a fully-illustrated catalogue.
    out = {CAR: ["a", "b"]}
    db = FakeDb([])

    await _append_approved_dealer_photos(db, out, 2)

    assert db.executed is False


@pytest.mark.asyncio
async def test_a_missing_table_is_not_an_error():
    # car_images exists only where the hand-run Supabase migrations have been
    # applied. An environment without it has no dealer photographs — which is
    # what an untouched gallery says. The check must not raise, and must not
    # take /cars down with it.
    out = {CAR: []}
    db = FakeDb([{"car_id": CAR, "url": "never-read"}], table_exists=False)

    await _append_approved_dealer_photos(db, out, 8)

    assert out[CAR] == []
    assert db.executed is False


@pytest.mark.asyncio
async def test_a_row_for_a_car_outside_this_page_is_ignored():
    # The query is bounded by the page's car ids, but a defensive skip keeps a
    # stray row from creating a key that the caller never asked about.
    out = {CAR: []}
    db = FakeDb([{"car_id": OTHER, "url": "https://cdn.test/other.jpg"}])

    await _append_approved_dealer_photos(db, out, 8)

    assert out[CAR] == []
    assert OTHER not in out


@pytest.mark.asyncio
async def test_a_row_with_no_url_is_skipped():
    # car_images is written by several flows and its url column is not
    # guaranteed. An empty string in a gallery renders as a broken image.
    out = {CAR: []}
    db = FakeDb([
        {"car_id": CAR, "url": ""},
        {"car_id": CAR, "url": "https://cdn.test/real.jpg"},
    ])

    await _append_approved_dealer_photos(db, out, 8)

    assert out[CAR] == ["https://cdn.test/real.jpg"]
