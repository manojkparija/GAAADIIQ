"""Where the EMI calculator's rates come from.

`/loans/bank-rates` held its own list of banks and rates in `routers/loans.py`,
separate from the `lender_rate_slabs` cards the offer engine prices from. Two
hand-maintained copies of the same numbers drift, and nothing fails when they
do: the calculator would keep quoting last quarter's figure while an
application returned this quarter's, and the only symptom is a user saying the
rate changed between two screens.

The second, larger problem is what the number means. Every figure is a
lender's lowest slab — the excellent-credit rate they advertise. An applicant
who supplies no score is priced in `unknown`: 10.50% at SBI against the 8.45%
shown. On ₹3.4L over 60 months that is ₹8,383 a month rather than ₹6,976, a
20% difference between the screen someone plans with and the offer they get.
The endpoint now says so; the UI shows what it says.
"""
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from db.session import get_db
from main import app
from models.lending_partner import CreditBand, LenderRateSlab, LendingPartner


def _partner(name: str, slug: str, order: int, rates: dict[str, float]) -> LendingPartner:
    p = LendingPartner(
        name=name, slug=slug, partner_type="bank",
        min_loan_amount=100000, max_loan_amount=5000000,
        min_tenure_months=12, max_tenure_months=84,
        min_monthly_income=25000, min_credit_score=700,
        max_ltv_pct=90, max_foir_pct=50, finances_used_cars=True,
        max_vehicle_age_years=10, processing_fee_pct=0.5,
        processing_fee_min=1000, processing_fee_max=7500, sort_order=order,
    )
    p.rate_slabs = [
        LenderRateSlab(credit_band=CreditBand(band), annual_rate_pct=rate)
        for band, rate in rates.items()
    ]
    return p


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
        yield c, session_factory
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_rates_come_from_the_lenders_own_cards(client):
    c, session_factory = client
    async with session_factory() as db:
        db.add(_partner("Test Bank", "testbank", 1,
                        {"excellent": 7.11, "good": 9.0, "unknown": 12.5}))
        await db.commit()

    body = (await c.get("/loans/bank-rates")).json()
    names = {b["name"]: b["rate"] for b in body["banks"]}

    # 7.11 appears in no source file — it can only have come from the card.
    assert names["Test Bank"] == 7.11


@pytest.mark.asyncio
async def test_the_advertised_rate_is_the_best_band_not_the_average(client):
    # The lowest slab, because that is the number a lender markets. Which is
    # exactly why it has to be labelled.
    c, session_factory = client
    async with session_factory() as db:
        db.add(_partner("Wide Bank", "wide", 1,
                        {"excellent": 8.0, "good": 9.5, "fair": 11.0, "poor": 14.0}))
        await db.commit()

    body = (await c.get("/loans/bank-rates")).json()

    assert body["banks"][0]["rate"] == 8.0
    assert body["rate_basis"] == "excellent"


@pytest.mark.asyncio
async def test_it_says_whose_rate_this_is(client):
    c, session_factory = client
    async with session_factory() as db:
        db.add(_partner("A Bank", "a", 1, {"excellent": 8.45}))
        await db.commit()

    note = (await c.get("/loans/bank-rates")).json()["note"].lower()

    assert "excellent credit" in note
    assert "your own rate" in note or "depends on" in note


@pytest.mark.asyncio
async def test_a_lender_with_no_rate_card_is_left_out(client):
    # A partner row with no slabs has no rate to advertise. Publishing it with
    # a zero or a null would put "0% p.a." on the comparison table.
    c, session_factory = client
    async with session_factory() as db:
        db.add(_partner("Priced Bank", "priced", 1, {"excellent": 8.2}))
        db.add(_partner("Unpriced Bank", "unpriced", 2, {}))
        await db.commit()

    names = [b["name"] for b in (await c.get("/loans/bank-rates")).json()["banks"]]

    assert "Priced Bank" in names
    assert "Unpriced Bank" not in names


@pytest.mark.asyncio
async def test_an_empty_rate_table_still_returns_something_to_show(client):
    # A calculator with no rates at all is worse than one showing the seeded
    # defaults, so the fallback list stands in rather than an empty table.
    c, _ = client

    body = (await c.get("/loans/bank-rates")).json()

    assert len(body["banks"]) > 0
    assert all(b["rate"] > 0 for b in body["banks"])


@pytest.mark.asyncio
async def test_the_ordering_is_the_lenders_sort_order(client):
    c, session_factory = client
    async with session_factory() as db:
        db.add(_partner("Second", "second", 2, {"excellent": 8.0}))
        db.add(_partner("First", "first", 1, {"excellent": 9.0}))
        await db.commit()

    names = [b["name"] for b in (await c.get("/loans/bank-rates")).json()["banks"]]

    assert names == ["First", "Second"]
