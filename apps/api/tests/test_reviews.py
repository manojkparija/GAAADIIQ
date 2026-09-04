"""
Tests for the reviews and ratings system.
"""
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from db.session import get_db
from main import app

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture
async def client(db_engine):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def _register_token(client: AsyncClient, email: str) -> str:
    r = await client.post("/auth/register", json={"email": email, "password": "pass1234"})
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"]


async def _make_listing(client: AsyncClient, token: str, price: int = 500_000) -> dict:
    car = await client.post("/cars", json={
        "make": "Toyota", "model": "Innova", "year": 2020,
        "fuel_type": "diesel", "transmission": "manual", "body_type": "suv",
    }, headers={"Authorization": f"Bearer {token}"})
    listing = await client.post("/listings", json={
        "car_id": car.json()["id"], "listing_type": "used",
        "price": price, "km_driven": 40000, "owners_count": 1,
        "condition": "good", "city": "Chennai",
    }, headers={"Authorization": f"Bearer {token}"})
    assert listing.status_code == 201, listing.text
    return listing.json()


# ── Basic review CRUD ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_review(client):
    seller_token = await _register_token(client, "rev_seller@test.com")
    listing = await _make_listing(client, seller_token)
    buyer_token = await _register_token(client, "rev_buyer@test.com")

    r = await client.post("/reviews", json={
        "listing_id": listing["id"],
        "rating": 4,
        "title": "Great car",
        "body": "Very well maintained.",
    }, headers={"Authorization": f"Bearer {buyer_token}"})
    assert r.status_code == 201
    data = r.json()
    assert data["rating"] == 4
    assert data["title"] == "Great car"
    assert data["is_verified"] is False  # no completed booking


@pytest.mark.asyncio
async def test_review_requires_auth(client):
    seller_token = await _register_token(client, "rev_noauth_seller@test.com")
    listing = await _make_listing(client, seller_token)

    client.cookies.clear()  # remove session cookie so the request is truly unauthenticated
    r = await client.post("/reviews", json={"listing_id": listing["id"], "rating": 3})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_cannot_review_own_listing(client):
    seller_token = await _register_token(client, "own_rev@test.com")
    listing = await _make_listing(client, seller_token)

    r = await client.post("/reviews", json={"listing_id": listing["id"], "rating": 5},
                          headers={"Authorization": f"Bearer {seller_token}"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_duplicate_review_rejected(client):
    seller_token = await _register_token(client, "dup_seller@test.com")
    listing = await _make_listing(client, seller_token)
    buyer_token = await _register_token(client, "dup_buyer@test.com")

    await client.post("/reviews", json={"listing_id": listing["id"], "rating": 3},
                      headers={"Authorization": f"Bearer {buyer_token}"})
    r = await client.post("/reviews", json={"listing_id": listing["id"], "rating": 4},
                          headers={"Authorization": f"Bearer {buyer_token}"})
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_review_nonexistent_listing(client):
    buyer_token = await _register_token(client, "rev_404@test.com")
    r = await client.post("/reviews", json={
        "listing_id": "00000000-0000-0000-0000-000000000000", "rating": 4,
    }, headers={"Authorization": f"Bearer {buyer_token}"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_verified_review_after_completed_booking(client):
    """is_verified=True when buyer has a completed test drive booking."""
    seller_token = await _register_token(client, "ver_seller@test.com")
    listing = await _make_listing(client, seller_token)
    buyer_token = await _register_token(client, "ver_buyer@test.com")

    # Create and complete a booking (seller marks completed)
    booking = await client.post("/bookings", json={"listing_id": listing["id"]},
                                headers={"Authorization": f"Bearer {buyer_token}"})
    booking_id = booking.json()["id"]
    await client.patch(f"/bookings/{booking_id}/status",
                       json={"status": "completed"},
                       headers={"Authorization": f"Bearer {seller_token}"})

    r = await client.post("/reviews", json={"listing_id": listing["id"], "rating": 5},
                          headers={"Authorization": f"Bearer {buyer_token}"})
    assert r.status_code == 201
    assert r.json()["is_verified"] is True


@pytest.mark.asyncio
async def test_delete_own_review(client):
    seller_token = await _register_token(client, "del_seller@test.com")
    listing = await _make_listing(client, seller_token)
    buyer_token = await _register_token(client, "del_buyer@test.com")

    rev = await client.post("/reviews", json={"listing_id": listing["id"], "rating": 3},
                            headers={"Authorization": f"Bearer {buyer_token}"})
    rev_id = rev.json()["id"]

    r = await client.delete(
        f"/reviews/{rev_id}",
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_cannot_delete_others_review(client):
    seller_token = await _register_token(client, "prv_seller@test.com")
    listing = await _make_listing(client, seller_token)
    buyer_token = await _register_token(client, "prv_buyer@test.com")
    other_token = await _register_token(client, "prv_other@test.com")

    rev = await client.post("/reviews", json={"listing_id": listing["id"], "rating": 4},
                            headers={"Authorization": f"Bearer {buyer_token}"})
    rev_id = rev.json()["id"]

    r = await client.delete(
        f"/reviews/{rev_id}",
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert r.status_code == 404


# ── Listing reviews ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_listing_reviews_endpoint(client):
    seller_token = await _register_token(client, "lr_seller@test.com")
    listing = await _make_listing(client, seller_token)
    for i in range(3):
        buyer_token = await _register_token(client, f"lr_buyer{i}@test.com")
        await client.post("/reviews", json={"listing_id": listing["id"], "rating": i + 3},
                          headers={"Authorization": f"Bearer {buyer_token}"})

    r = await client.get(f"/reviews/listing/{listing['id']}")
    assert r.status_code == 200
    assert len(r.json()) == 3


@pytest.mark.asyncio
async def test_my_reviews(client):
    seller_token = await _register_token(client, "mr_seller@test.com")
    listing = await _make_listing(client, seller_token)
    listing2 = await _make_listing(client, seller_token)
    buyer_token = await _register_token(client, "mr_buyer@test.com")

    # Two listings with same seller — only one review each allowed
    await client.post("/reviews", json={"listing_id": listing["id"], "rating": 5},
                      headers={"Authorization": f"Bearer {buyer_token}"})
    await client.post("/reviews", json={"listing_id": listing2["id"], "rating": 4},
                      headers={"Authorization": f"Bearer {buyer_token}"})

    r = await client.get("/reviews/my", headers={"Authorization": f"Bearer {buyer_token}"})
    assert r.status_code == 200
    assert len(r.json()) == 2


# ── Seller rating summary ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_seller_rating_summary_no_reviews(client):
    seller_token = await _register_token(client, "sum0_seller@test.com")
    # Get seller_id from auth
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {seller_token}"})
    seller_id = me.json()["id"]

    r = await client.get(f"/reviews/seller/{seller_id}/summary")
    assert r.status_code == 200
    data = r.json()
    assert data["review_count"] == 0
    assert data["average_rating"] is None


@pytest.mark.asyncio
async def test_seller_rating_summary_aggregate(client):
    seller_token = await _register_token(client, "sum_seller@test.com")
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {seller_token}"})
    seller_id = me.json()["id"]

    listing = await _make_listing(client, seller_token)
    listing2 = await _make_listing(client, seller_token)
    listing3 = await _make_listing(client, seller_token)

    for i, rating in enumerate([5, 3, 4]):
        buyer_token = await _register_token(client, f"sum_buyer{i}@test.com")
        listing_ids = [listing["id"], listing2["id"], listing3["id"]]
        await client.post("/reviews", json={"listing_id": listing_ids[i], "rating": rating},
                          headers={"Authorization": f"Bearer {buyer_token}"})

    r = await client.get(f"/reviews/seller/{seller_id}/summary")
    assert r.status_code == 200
    data = r.json()
    assert data["review_count"] == 3
    assert data["average_rating"] == 4.0  # (5+3+4)/3
    assert data["rating_distribution"]["5"] == 1
    assert data["rating_distribution"]["3"] == 1
    assert data["rating_distribution"]["4"] == 1


@pytest.mark.asyncio
async def test_seller_reviews_list(client):
    seller_token = await _register_token(client, "srl_seller@test.com")
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {seller_token}"})
    seller_id = me.json()["id"]

    listing = await _make_listing(client, seller_token)
    buyer_token = await _register_token(client, "srl_buyer@test.com")
    await client.post("/reviews", json={"listing_id": listing["id"], "rating": 4, "body": "Nice"},
                      headers={"Authorization": f"Bearer {buyer_token}"})

    r = await client.get(f"/reviews/seller/{seller_id}")
    assert r.status_code == 200
    reviews = r.json()
    assert len(reviews) == 1
    assert reviews[0]["body"] == "Nice"


# ── How the summary is computed, not just what it returns ────────────────────
#
# The correctness tests above passed both before and after the rewrite, because
# the numbers never changed. What changed is the work done to produce them: the
# summary used to SELECT every review row the seller had, hydrate each into an
# ORM object, and count them in Python — cost growing with the seller's history,
# on every view of their profile, for seven numbers.
#
# A performance property that nothing asserts is one that gets undone by the
# next person who finds the aggregate harder to read than a loop. These tests
# watch the SQL the endpoint actually emits.

from sqlalchemy import event  # noqa: E402


class _SqlSpy:
    """Records the SQL a block of work emits, so a test can assert on shape."""

    def __init__(self, engine):
        self.engine = engine.sync_engine
        self.statements: list[str] = []

    def _record(self, conn, cursor, statement, params, context, executemany):
        self.statements.append(" ".join(statement.split()).lower())

    def __enter__(self):
        event.listen(self.engine, "before_cursor_execute", self._record)
        return self

    def __exit__(self, *exc):
        event.remove(self.engine, "before_cursor_execute", self._record)

    def selecting_review_rows(self) -> list[str]:
        """Statements that pull whole review rows rather than an aggregate."""
        return [
            s for s in self.statements
            if s.startswith("select") and "from reviews" in s
            and "count(" not in s
        ]


@pytest.mark.asyncio
async def test_the_summary_aggregates_in_sql_rather_than_reading_the_rows(client, db_engine):
    seller_token = await _register_token(client, "spy_seller@test.com")
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {seller_token}"})
    seller_id = me.json()["id"]

    for i, rating in enumerate([5, 4, 4]):
        listing = await _make_listing(client, seller_token)
        buyer_token = await _register_token(client, f"spy_buyer{i}@test.com")
        await client.post("/reviews", json={"listing_id": listing["id"], "rating": rating},
                          headers={"Authorization": f"Bearer {buyer_token}"})

    with _SqlSpy(db_engine) as spy:
        r = await client.get(f"/reviews/seller/{seller_id}/summary")

    assert r.status_code == 200
    assert r.json()["review_count"] == 3

    assert any("count(" in s and "group by" in s for s in spy.statements), (
        "the summary should ask the database to count and group; "
        f"statements were: {spy.statements}"
    )
    assert spy.selecting_review_rows() == [], (
        "the summary fetched whole review rows — the work it exists to avoid"
    )


@pytest.mark.asyncio
async def test_the_summary_cost_does_not_grow_with_the_review_count(client, db_engine):
    """One query whatever the history length.

    Row-reading would still be one statement, so this is not sufficient on its
    own — it pairs with the test above, which is the one that catches a reader.
    What this adds is that nobody has replaced the aggregate with a per-rating
    query, which would be five.
    """
    seller_token = await _register_token(client, "spyn_seller@test.com")
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {seller_token}"})
    seller_id = me.json()["id"]

    for i, rating in enumerate([5, 4, 3, 2, 1, 5, 4]):
        listing = await _make_listing(client, seller_token)
        buyer_token = await _register_token(client, f"spyn_buyer{i}@test.com")
        await client.post("/reviews", json={"listing_id": listing["id"], "rating": rating},
                          headers={"Authorization": f"Bearer {buyer_token}"})

    with _SqlSpy(db_engine) as spy:
        await client.get(f"/reviews/seller/{seller_id}/summary")

    review_queries = [s for s in spy.statements if "from reviews" in s]
    assert len(review_queries) == 1, f"expected one aggregate, got {review_queries}"


# ── The list endpoints are bounded ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_seller_reviews_are_capped(client):
    """Both list endpoints returned every matching row, with no bound at all.

    The default is above anything the current data reaches, so this changed no
    response on the day it landed — it is a ceiling for later.
    """
    seller_token = await _register_token(client, "cap_seller@test.com")
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {seller_token}"})
    seller_id = me.json()["id"]

    for i in range(4):
        listing = await _make_listing(client, seller_token)
        buyer_token = await _register_token(client, f"cap_buyer{i}@test.com")
        await client.post("/reviews", json={"listing_id": listing["id"], "rating": 4},
                          headers={"Authorization": f"Bearer {buyer_token}"})

    assert len((await client.get(f"/reviews/seller/{seller_id}")).json()) == 4
    assert len((await client.get(f"/reviews/seller/{seller_id}?limit=2")).json()) == 2

    # The summary still reports the true total, so a caller that needs "how
    # many" never has to fetch rows to find out — which is what makes capping
    # the list safe rather than lossy.
    summary = (await client.get(f"/reviews/seller/{seller_id}/summary")).json()
    assert summary["review_count"] == 4


@pytest.mark.asyncio
async def test_the_cap_cannot_be_raised_without_bound(client):
    seller_token = await _register_token(client, "capmax_seller@test.com")
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {seller_token}"})
    seller_id = me.json()["id"]

    # 422 rather than silently serving everything: an unbounded request is the
    # thing the cap exists to refuse.
    assert (await client.get(f"/reviews/seller/{seller_id}?limit=100000")).status_code == 422
    assert (await client.get(f"/reviews/seller/{seller_id}?limit=0")).status_code == 422
