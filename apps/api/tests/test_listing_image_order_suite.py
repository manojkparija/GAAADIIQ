"""
A listing photograph can be moved to the front of its car's gallery.

WHY THIS ENDPOINT EXISTS

The Baleno card on New Cars led with a photograph of the boot. The car, the
approval and the images were all correct — the gallery simply had no order
anyone had chosen. `car_images.sort_order` is written once at upload as
`startAt + i`, the sequence the dealer happened to drag files in, and nothing
could change it afterwards.

The media-library half was already solved: vehicle_media carries is_primary and
sort_order, and PATCH /media-admin/{id} has always accepted both. car_images —
the store holding this car's only photographs — had no write path at all.

Position 0 is the cover, because urls_for_cars reads these with
`ORDER BY sort_order NULLS LAST, created_at` and the listing card takes the
head of the gallery.

WHAT CI DOES NOT COVER HERE

Same gap as the read path this pairs with: car_images is created by the
hand-run Supabase migrations and is in neither CI database, so the UPDATE
itself is never executed by the suite. These tests drive the handler with a
fake session, which pins the contract — the guard, the read-back, the 404 —
but not the SQL. The statement is deliberately plain UPDATE ... RETURNING for
that reason: there is nothing dialect-specific in it to get wrong.
"""
import pytest
from fastapi import HTTPException

from routers.media_admin import ListingImageOrderPatch, reorder_listing_image


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return self._rows


class FakeDb:
    """Records what was executed, and answers the UPDATE with `rows`."""

    def __init__(self, rows):
        self.rows = rows
        self.statements = []
        self.params = []
        self.committed = False

    async def execute(self, stmt, params=None):
        self.statements.append(str(stmt))
        self.params.append(params)
        # set_config calls come first and return nothing anyone reads.
        if "set_config" in str(stmt):
            return _Rows([])
        return _Rows(self.rows)

    async def commit(self):
        self.committed = True


class _Admin:
    email = "admin@gaadiiq.com"


async def _call(db, image_id=7, sort_order=0):
    return await reorder_listing_image(
        request=None, image_id=image_id,
        patch=ListingImageOrderPatch(sort_order=sort_order),
        admin=_Admin(), db=db,
    )


@pytest.mark.asyncio
async def test_moving_a_photograph_to_the_front():
    # The reported case: the front three-quarter shot becomes position 0, and
    # therefore the card's cover.
    db = FakeDb([{"id": 7, "sort_order": 0}])

    result = await _call(db, image_id=7, sort_order=0)

    assert result == {"id": "7", "sort_order": 0}
    assert db.committed is True


@pytest.mark.asyncio
async def test_the_admin_claim_is_set_before_the_update():
    # car_images carries a BEFORE UPDATE trigger reading auth.jwt(), which
    # PostgREST would normally populate. This service connects straight to
    # Postgres, so without this the statement raises 42501 — the removal
    # endpoint learned that against the live database.
    db = FakeDb([{"id": 7, "sort_order": 2}])

    await _call(db, sort_order=2)

    assert any("set_config" in s for s in db.statements[:2])
    assert any("UPDATE public.car_images" in s for s in db.statements)


@pytest.mark.asyncio
async def test_a_negative_position_is_refused_by_name():
    # 0 is the cover, so there is nothing below it. Saying so beats storing a
    # position that sorts ahead of the image an admin chose.
    db = FakeDb([{"id": 7, "sort_order": -1}])

    with pytest.raises(HTTPException) as exc:
        await _call(db, sort_order=-1)

    assert exc.value.status_code == 422
    assert "cover" in exc.value.detail
    assert db.statements == []


@pytest.mark.asyncio
async def test_an_unknown_image_is_a_404():
    db = FakeDb([])

    with pytest.raises(HTTPException) as exc:
        await _call(db)

    assert exc.value.status_code == 404
    assert db.committed is False


@pytest.mark.asyncio
async def test_the_stored_position_is_read_back():
    # A returned row says the statement matched something; it says nothing
    # about what the row now holds. The review screen spent a week reporting
    # rejections that never happened for exactly this reason, so an ordering
    # change must not repeat it — a silent no-op here looks like success and
    # leaves the boot shot on the card.
    db = FakeDb([{"id": 7, "sort_order": 3}])

    with pytest.raises(HTTPException) as exc:
        await _call(db, sort_order=0)

    assert exc.value.status_code == 500
    assert "was not applied" in exc.value.detail
    assert db.committed is False
