"""
"Manage images already on the site" must show what is actually on the site.

Reported: an e Vitara with two approved photographs listed as "No images on
the site for this vehicle", while the same car showed those photographs to
buyers.

The panel queried vehicle_media alone. Photographs arriving through the
listing and dealer flows are written to car_images — a Supabase-era table
with an integer id and no ORM model — so the screen was blind to them while
telling the admin it showed "exactly what buyers see".

Measured in production at the time:

    vehicle_media   Fronx 7, Grand Vitara 5, S-Presso 15   (all model_year 2026)
    car_images      e Vitara 2, approved

Listing rows are now included and are NOT removable from that screen:
removing a dealer's photograph is a reviewed decision that requires a reason
and records who made it, and a second delete path here would bypass that.

These tests drive the helper directly rather than the endpoint, because the
endpoint needs an admin dependency and storage; the helper is where the SQL
and the flags live.
"""
import pytest

from routers.media_admin import _listing_images


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def scalar(self):
        return self._rows

    def mappings(self):
        return self

    def all(self):
        return self._rows


class _FakeConn:
    """Stands in for the AsyncConnection the helper inspects."""

    def __init__(self, table_exists):
        self.table_exists = table_exists

    async def run_sync(self, fn):
        # The helper asks the inspector whether car_images is there. The real
        # call needs a live sync connection; the answer is all that matters.
        return bool(self.table_exists)


class FakeDb:
    """
    Answers what the helper asks: does the table exist, then the query.

    The existence check goes through the SQLAlchemy inspector rather than
    to_regclass, which is Postgres-only — an earlier version used it and took
    the endpoint down under SQLite, where these tests run.
    """

    def __init__(self, *, table_exists=True, rows=None):
        self.table_exists = table_exists
        self.rows = rows or []
        self.statements = []
        self.params = []

    async def connection(self):
        return _FakeConn(self.table_exists)

    async def execute(self, stmt, params=None):
        self.statements.append(str(stmt))
        self.params.append(params)
        return _Result(self.rows)


class _When:
    def isoformat(self):
        return "2026-08-27T21:13:18+00:00"


def _row(id_=1, url="https://cdn.example/img/front-view.webp"):
    return {"id": id_, "url": url, "created_at": _When(), "submitted_by": "dealer@x.in"}


@pytest.mark.asyncio
async def test_lists_approved_listing_photographs():
    db = FakeDb(rows=[_row()])

    out = await _listing_images(db, make="Maruti Suzuki", model="e Vitara", model_year=2026)

    assert len(out) == 1
    assert out[0].origin == "listing"
    assert out[0].url == "https://cdn.example/img/front-view.webp"


@pytest.mark.asyncio
async def test_listing_photographs_are_not_removable_here():
    db = FakeDb(rows=[_row()])

    out = await _listing_images(db, make="Maruti Suzuki", model="e Vitara", model_year=None)

    # The whole point of option B: visible, but taken down where the decision
    # is recorded. A removable listing row would be the bug this avoids.
    assert out[0].removable is False
    assert out[0].manage_at == "/admin/image-review"


@pytest.mark.asyncio
async def test_only_approved_rows_are_listed():
    db = FakeDb(rows=[])
    await _listing_images(db, make="M", model="X", model_year=None)

    sql = db.statements[-1]
    assert "i.status = 'approved'" in sql, (
        "pending and rejected photographs are not on the site; listing them "
        "restates the same falsehood in the other direction"
    )


@pytest.mark.asyncio
async def test_matches_make_and_model_case_insensitively():
    db = FakeDb(rows=[])
    await _listing_images(db, make="  MARUTI Suzuki ", model=" E Vitara ", model_year=None)

    assert db.params[-1]["make"] == "maruti suzuki"
    assert db.params[-1]["model"] == "e vitara"


@pytest.mark.asyncio
async def test_year_filters_only_when_given():
    with_year = FakeDb(rows=[])
    await _listing_images(with_year, make="M", model="X", model_year=2026)
    assert "c.year = :year" in with_year.statements[-1]
    assert with_year.params[-1]["year"] == 2026

    without = FakeDb(rows=[])
    await _listing_images(without, make="M", model="X", model_year=None)
    assert "c.year = :year" not in without.statements[-1]


@pytest.mark.asyncio
async def test_a_missing_table_is_empty_not_an_error():
    # car_images exists only where the hand-run Supabase migrations have been
    # applied. An environment without it has no listing photographs, which is
    # what an empty list says — raising would take down the whole panel.
    db = FakeDb(table_exists=False)

    out = await _listing_images(db, make="M", model="X", model_year=None)

    assert out == []
    assert db.statements == [], "should not query a table it just found absent"


@pytest.mark.asyncio
async def test_filename_falls_back_to_the_last_path_segment():
    # car_images stores a URL and no filename. The admin recognises the file
    # by its name, so show that rather than the whole URL.
    db = FakeDb(rows=[_row(url="https://cdn.example/a/b/rear-quarter.jpg")])

    out = await _listing_images(db, make="M", model="X", model_year=None)

    assert out[0].filename == "rear-quarter.jpg"


@pytest.mark.asyncio
async def test_an_integer_id_survives_as_a_string():
    # car_images keys on an integer; vehicle_media on a UUID. The response
    # carries both, so the field is a string.
    db = FakeDb(rows=[_row(id_=42)])

    out = await _listing_images(db, make="M", model="X", model_year=None)

    assert out[0].id == "42"


def test_the_helper_reads_car_images_not_vehicle_media():
    # A guard against the obvious wrong fix: querying vehicle_media twice
    # would return the same rows and still show nothing for the e Vitara.
    import inspect

    src = inspect.getsource(_listing_images)
    assert "public.car_images" in src
    assert "vehicle_media" not in src.split('"""')[2]
