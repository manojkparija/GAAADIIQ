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

Listing rows are included and removable from that screen. Removal is carried
out as a rejection, not a delete: the row stays, buyers stop seeing it, the
review queue's Rejected tab holds it, and approving it there puts it back.

That path needs the Supabase JWT claim set for the transaction, because
car_images carries a BEFORE UPDATE trigger that refuses a review change
unless auth.jwt() names an admin — and this service talks to Postgres
directly, never through PostgREST, so the setting is otherwise empty.

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
async def test_listing_photographs_are_removable_and_undoable():
    db = FakeDb(rows=[_row()])

    out = await _listing_images(db, make="Maruti Suzuki", model="e Vitara", model_year=None)

    # Removable from this panel, as the admin asked. Carried out as a
    # rejection rather than a delete, so manage_at still points at where the
    # photograph can be approved back — a removal with no way back would
    # break the panel's own promise that removals can be undone.
    assert out[0].removable is True
    # The Rejected tab specifically. A removal makes the photograph rejected,
    # so a link to the queue's default Pending tab showed "Nothing waiting for
    # review" and read as a broken link.
    assert out[0].manage_at == "/admin/image-review?status=rejected"


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


# ---------------------------------------------------------------------------
# Removing a listing photograph
# ---------------------------------------------------------------------------
#
# car_images carries a BEFORE UPDATE trigger that raises unless auth.jwt()
# names an admin. auth.jwt() reads current_setting('request.jwt.claim'), which
# PostgREST sets per request; this service connects straight to Postgres and
# never goes through PostgREST, so that setting is empty and the update raised.
# Verified against the live database: the same statement without a session
# failed with 42501 "Only an admin can review a photograph."
#
# So the claim is set for the transaction, from the admin FastAPI has already
# authenticated. These check that it is set, that it is transaction-scoped,
# and that the outcome is read back rather than assumed.

from fastapi import HTTPException  # noqa: E402

from routers.media_admin import remove_listing_image  # noqa: E402


class _Admin:
    email = "manojkparija@gaadiiq.com"
    id = "00000000-0000-4000-8000-00000000000a"


class RemoveDb:
    def __init__(self, *, returning=None):
        self.returning = returning if returning is not None else [
            {"id": 1, "status": "rejected"}
        ]
        self.statements = []
        self.params = []
        self.committed = False

    async def execute(self, stmt, params=None):
        self.statements.append(str(stmt))
        self.params.append(params)
        if "set_config" in str(stmt):
            return _Result([])
        return _Result(self.returning)

    async def commit(self):
        self.committed = True


class _Req:
    headers: dict = {}
    client = None


@pytest.mark.asyncio
async def test_sets_the_jwt_claim_so_the_trigger_accepts_the_change():
    db = RemoveDb()

    await remove_listing_image(_Req(), image_id=1, admin=_Admin(), db=db)

    claim_calls = [p for p in db.params if p and "k" in p]
    keys = {p["k"] for p in claim_calls}
    assert keys == {"request.jwt.claim", "request.jwt.claims"}, (
        "auth.jwt() coalesces over both spellings; setting one is a coin flip"
    )
    assert all(_Admin.email in p["v"] for p in claim_calls)


@pytest.mark.asyncio
async def test_the_claim_is_scoped_to_the_transaction():
    # is_local=True. Without it the setting outlives the request on a pooled
    # connection and the next caller inherits this admin's identity.
    db = RemoveDb()

    await remove_listing_image(_Req(), image_id=1, admin=_Admin(), db=db)

    set_config = next(s for s in db.statements if "set_config" in s)
    assert "true" in set_config.lower()


@pytest.mark.asyncio
async def test_rejects_rather_than_deletes():
    db = RemoveDb()

    await remove_listing_image(_Req(), image_id=1, admin=_Admin(), db=db)

    sql = " ".join(db.statements)
    assert "status = 'rejected'" in sql
    assert "DELETE" not in sql.upper(), (
        "a delete cannot be undone, and the panel promises removals can be"
    )


@pytest.mark.asyncio
async def test_the_reason_names_the_admin_and_the_screen():
    # A CHECK constraint requires a reason, and the dealer reads it. A
    # placeholder would satisfy the constraint and tell them nothing.
    db = RemoveDb()

    await remove_listing_image(_Req(), image_id=1, admin=_Admin(), db=db)

    reason = next(p["reason"] for p in db.params if p and "reason" in p)
    assert _Admin.email in reason
    assert "Manage images" in reason


@pytest.mark.asyncio
async def test_a_missing_row_is_a_404():
    db = RemoveDb(returning=[])

    with pytest.raises(HTTPException) as caught:
        await remove_listing_image(_Req(), image_id=999, admin=_Admin(), db=db)

    assert caught.value.status_code == 404
    assert not db.committed


@pytest.mark.asyncio
async def test_a_row_that_came_back_unchanged_is_not_reported_as_removed():
    # The defect this whole area kept producing: a returned row says the
    # statement matched something, not that the row now holds what was asked
    # for. The review screen reported rejections that never happened for a
    # week on exactly this.
    db = RemoveDb(returning=[{"id": 1, "status": "approved"}])

    with pytest.raises(HTTPException) as caught:
        await remove_listing_image(_Req(), image_id=1, admin=_Admin(), db=db)

    assert caught.value.status_code == 500
    assert "approved" in caught.value.detail
    assert not db.committed, "a failed removal must not commit"


@pytest.mark.asyncio
async def test_a_successful_removal_commits_and_says_where_to_undo():
    db = RemoveDb()

    out = await remove_listing_image(_Req(), image_id=1, admin=_Admin(), db=db)

    assert db.committed
    assert out["status"] == "rejected"
    assert out["undo_at"] == "/admin/image-review?status=rejected"
