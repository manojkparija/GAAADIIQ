"""
Buyer ratings on the catalogue endpoints.

WHAT THIS IS ABOUT

Every card in the app rendered "0.0 (0)". Not as an edge case on unreviewed
cars -- on every car, because both mappers in the Angular service hardcoded
`reviews: 0` and the API had no rating field at all to read. Three screens
ended up hiding the zero rather than sourcing it.

The reviews existed the whole time. The Angular app writes them straight to
`car_reviews` in Supabase through supabase-js, and that table lives in the
same database this service connects to. Nothing aggregated them back.

WHY THESE TESTS LOOK THE WAY THEY DO

car_reviews is owned by supabase/migrations, not Alembic, so it is NOT in
Base.metadata and does not exist in the test database unless a test makes it.
That gives two cases worth pinning, and the second is the one that would take
the catalogue down:

  - the table exists and holds reviews  -> the aggregate is correct
  - the table is absent                 -> the catalogue still serves

The absent case is the normal state of the test database, so most of the file
exercises it without trying.
"""
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.dependencies import get_admin_user, get_current_user
from db.session import get_db
from main import app
from models.user import User


@pytest_asyncio.fixture
async def client(db_engine):
    factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)

    async def override_db():
        async with factory() as session:
            yield session
            await session.commit()

    admin = User(id=uuid.uuid4(), email="admin@test.com", hashed_password="x")
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_admin_user] = lambda: admin
    app.dependency_overrides[get_current_user] = lambda: admin
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def car(client) -> dict:
    resp = await client.post("/cars", json={
        "make": "Hyundai", "model": "Creta", "year": 2026,
        "fuel_type": "petrol", "transmission": "manual",
        "ex_showroom_price": "1100000",
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _make_car_reviews(db_engine) -> bool:
    """
    Stand up a minimal car_reviews, mirroring the columns this code reads.

    Deliberately not the full Supabase definition: copying it here would be a
    third place the schema lives, and the aggregate only ever touches car_id
    and rating. Returns False where the dialect will not take it, so the test
    can skip rather than fail for a reason that is not about ratings.
    """
    try:
        async with db_engine.begin() as conn:
            await conn.execute(text("DROP TABLE IF EXISTS car_reviews"))
            await conn.execute(text(
                "CREATE TABLE car_reviews ("
                " id TEXT PRIMARY KEY,"
                " car_id TEXT NOT NULL,"
                " rating SMALLINT NOT NULL,"
                " body TEXT)"
            ))
        return True
    except Exception:
        return False


async def _add_review(db_engine, car_id: str, rating: int) -> None:
    async with db_engine.begin() as conn:
        await conn.execute(
            text("INSERT INTO car_reviews (id, car_id, rating, body)"
                 " VALUES (:i, :c, :r, 'x')"),
            {"i": str(uuid.uuid4()), "c": str(car_id), "r": rating},
        )


async def _drop_car_reviews(db_engine) -> None:
    async with db_engine.begin() as conn:
        await conn.execute(text("DROP TABLE IF EXISTS car_reviews"))


# ── The table is absent, which is the test database's normal state ──────────

@pytest.mark.asyncio
async def test_catalogue_serves_when_car_reviews_is_missing(client, car):
    """
    The whole catalogue must not fail because a Supabase-owned table has not
    been created. A deployment that has not run supabase/migrations is in
    exactly this state.
    """
    resp = await client.get("/cars?bucket=new")
    assert resp.status_code == 200, resp.text
    assert resp.json()["items"], "the catalogue came back empty"


@pytest.mark.asyncio
async def test_unrated_car_reports_null_rather_than_zero(client, car):
    """
    None, not 0. A zero here is what travelled to the UI as "0.0 stars" and
    read as rated worst; the client has to be able to tell the two apart.
    """
    resp = await client.get(f"/cars/{car['id']}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["rating"] is None
    assert body["review_count"] == 0


@pytest.mark.asyncio
async def test_the_session_still_works_after_the_missing_table(client, car):
    """
    The savepoint earns its place here.

    On Postgres a failed statement aborts the transaction, so catching the
    error and carrying on would raise InFailedSqlTransaction on the next
    query. This asks for a car AFTER a request that already hit the missing
    table in the same session-per-request cycle, and then asks again.
    """
    assert (await client.get(f"/cars/{car['id']}")).status_code == 200
    second = await client.get("/cars?bucket=new")
    assert second.status_code == 200, second.text


# ── The table exists ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_rating_is_averaged_and_counted(client, car, db_engine):
    if not await _make_car_reviews(db_engine):
        pytest.skip("this dialect would not take the car_reviews stand-in")
    try:
        for r in (5, 4, 3):
            await _add_review(db_engine, car["id"], r)

        resp = await client.get(f"/cars/{car['id']}")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["review_count"] == 3
        assert body["rating"] == 4.0
    finally:
        await _drop_car_reviews(db_engine)


@pytest.mark.asyncio
async def test_rating_is_rounded_to_one_decimal(client, car, db_engine):
    if not await _make_car_reviews(db_engine):
        pytest.skip("this dialect would not take the car_reviews stand-in")
    try:
        # 5, 4, 4 -> 4.333..., which must not reach a card as 4.333333333.
        for r in (5, 4, 4):
            await _add_review(db_engine, car["id"], r)

        body = (await client.get(f"/cars/{car['id']}")).json()
        assert body["rating"] == 4.3
    finally:
        await _drop_car_reviews(db_engine)


@pytest.mark.asyncio
async def test_reviews_of_another_car_do_not_leak(client, car, db_engine):
    if not await _make_car_reviews(db_engine):
        pytest.skip("this dialect would not take the car_reviews stand-in")
    try:
        await _add_review(db_engine, str(uuid.uuid4()), 1)

        body = (await client.get(f"/cars/{car['id']}")).json()
        assert body["rating"] is None
        assert body["review_count"] == 0
    finally:
        await _drop_car_reviews(db_engine)


@pytest.mark.asyncio
async def test_the_list_carries_the_same_figures_as_the_detail(client, car, db_engine):
    """
    A card and the page it opens must not disagree. They are computed by the
    same helper precisely so this cannot drift, and this is what says so.
    """
    if not await _make_car_reviews(db_engine):
        pytest.skip("this dialect would not take the car_reviews stand-in")
    try:
        for r in (5, 3):
            await _add_review(db_engine, car["id"], r)

        detail = (await client.get(f"/cars/{car['id']}")).json()
        listed = next(
            c for c in (await client.get("/cars?bucket=new")).json()["items"]
            if c["id"] == car["id"]
        )
        assert listed["rating"] == detail["rating"] == 4.0
        assert listed["review_count"] == detail["review_count"] == 2
    finally:
        await _drop_car_reviews(db_engine)
