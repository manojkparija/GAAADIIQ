"""
Checking an entered price against a human-verified reference.

From UAT: warn when a price differs significantly from the market. The design
decision worth pinning is what this does *not* do — it never produces a
reference of its own. A figure the system invented would read exactly like one
somebody checked on the OEM site, and the publisher would believe it. That is
the same trade credit_bureau.fetch_score refuses by raising.

So the interesting cases are the absences: no reference, an unusable one, and
one nobody has revisited in months. Each has to be distinguishable from
"checked and fine", because a publisher acts differently on each.
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.dependencies import get_admin_user, get_current_user
from db.session import get_db
from main import app
from models.user import User
from services.price_reference import (
    LIKELY_TYPO_DIFFERENCE,
    SIGNIFICANT_DIFFERENCE,
    check_price,
)

TODAY = date(2026, 8, 20)


@pytest_asyncio.fixture
async def client(db_engine):
    factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    admin = User(id=uuid.uuid4(), email="admin@gaadiiq.in", role="admin")

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_admin_user] = lambda: admin
    app.dependency_overrides[get_current_user] = lambda: admin
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


def test_no_reference_is_reported_not_passed_silently():
    result = check_price(650000, reference=None)

    assert result.has_reference is False
    assert result.is_significant is False
    # Silence would be read as agreement.
    assert result.message is not None
    assert "nothing was checked" in result.message


def test_a_close_price_says_nothing():
    result = check_price(660000, reference=650000, today=TODAY)

    assert result.is_significant is False
    assert result.message is None


def test_a_price_just_inside_the_threshold_stays_quiet():
    # Ex-showroom prices drift with taxes and discounts. Warning on ordinary
    # movement teaches admins to dismiss the warning.
    reference = Decimal("1000000")
    entered = reference * (1 + SIGNIFICANT_DIFFERENCE - Decimal("0.001"))

    assert check_price(entered, reference=reference, today=TODAY).is_significant is False


def test_a_price_over_the_threshold_warns():
    reference = Decimal("1000000")
    entered = reference * (1 + SIGNIFICANT_DIFFERENCE + Decimal("0.001"))

    result = check_price(entered, reference=reference, today=TODAY)
    assert result.is_significant is True
    assert "above the reference" in result.message


def test_the_reported_fronx_overwrite_would_have_been_caught():
    # The UAT case: a base variant priced at ₹6.5L repriced to a higher trim's
    # ₹11.5L. This is the warning that should have fired.
    result = check_price(1150000, reference=650000, today=TODAY)

    assert result.is_significant is True
    assert result.difference > SIGNIFICANT_DIFFERENCE


def test_a_price_below_the_reference_warns_too():
    result = check_price(400000, reference=650000, today=TODAY)

    assert result.is_significant is True
    assert "below the reference" in result.message


def test_a_very_large_gap_is_called_out_as_a_likely_typo():
    reference = Decimal("650000")
    entered = reference * (1 + LIKELY_TYPO_DIFFERENCE + Decimal("0.5"))

    result = check_price(entered, reference=reference, today=TODAY)
    assert "digit out of place" in result.message


def test_the_source_travels_with_the_warning():
    result = check_price(
        1150000, reference=650000, source="Maruti Suzuki official site", today=TODAY
    )

    # A price alone cannot be judged; the reader needs to know where it came from.
    assert "Maruti Suzuki official site" in result.message


def test_a_stale_reference_says_it_is_stale():
    result = check_price(
        1150000, reference=650000, checked_on=date(2025, 1, 1), today=TODAY
    )

    assert result.is_stale is True
    assert "out of date" in result.message


def test_a_fresh_reference_is_not_called_stale():
    result = check_price(
        1150000, reference=650000, checked_on=date(2026, 8, 1), today=TODAY
    )

    assert result.is_stale is False
    assert "out of date" not in result.message


def test_a_zero_reference_is_refused_rather_than_divided_by():
    result = check_price(650000, reference=0)

    assert result.has_reference is False
    assert result.is_significant is False
    assert "not a usable figure" in result.message


def test_a_missing_entered_price_checks_nothing():
    result = check_price(None, reference=650000)

    assert result.is_significant is False


class TestPriceCheckEndpointSuite:
    """
    The endpoint the admin pricing screen calls before publishing.

    Kept separate from the pure comparison tests above because the behaviour
    that matters here is what the API does when there is nothing to compare
    against: it must answer, and the answer must not look like approval.
    """

    @pytest.mark.asyncio
    async def test_a_model_with_no_reference_says_so(self, client):
        car = await client.post("/cars", json={
            "make": "Maruti Suzuki", "model": "Fronx", "year": 2026,
            "ex_showroom_price": "650000",
        })
        assert car.status_code == 201
        car_id = car.json()["id"]

        resp = await client.get(f"/cars/{car_id}/price-check?price=650000")

        assert resp.status_code == 200
        body = resp.json()
        assert body["has_reference"] is False
        assert body["is_significant"] is False
        assert "nothing was checked" in body["message"]

    @pytest.mark.asyncio
    async def test_a_price_near_the_reference_raises_nothing(self, client):
        car = await client.post("/cars", json={
            "make": "Maruti Suzuki", "model": "Baleno", "year": 2026,
        })
        car_id = car.json()["id"]
        await client.patch(f"/cars/{car_id}", json={
            "reference_price": "700000",
            "reference_price_source": "Maruti Suzuki official site",
        })

        body = (await client.get(f"/cars/{car_id}/price-check?price=710000")).json()

        assert body["has_reference"] is True
        assert body["is_significant"] is False
        assert body["message"] is None

    @pytest.mark.asyncio
    async def test_the_uat_overwrite_case_is_flagged_with_its_source(self, client):
        # Base priced at ₹6.5L, then repriced to a higher trim's ₹11.5L.
        car = await client.post("/cars", json={
            "make": "Maruti Suzuki", "model": "Ignis", "year": 2026,
        })
        car_id = car.json()["id"]
        await client.patch(f"/cars/{car_id}", json={
            "reference_price": "650000",
            "reference_price_source": "Maruti Suzuki official site",
            "reference_price_checked_on": "2026-08-01",
        })

        body = (await client.get(f"/cars/{car_id}/price-check?price=1150000")).json()

        assert body["is_significant"] is True
        assert "above the reference" in body["message"]
        # The reader has to be able to judge the reference, not just the gap.
        assert "Maruti Suzuki official site" in body["message"]
        assert body["difference"] > 0.1

    @pytest.mark.asyncio
    async def test_the_reference_survives_a_round_trip(self, client):
        car = await client.post("/cars", json={
            "make": "Maruti Suzuki", "model": "Celerio", "year": 2026,
        })
        car_id = car.json()["id"]
        await client.patch(f"/cars/{car_id}", json={
            "reference_price": "560000",
            "reference_price_source": "OEM brochure",
            "reference_price_checked_on": "2026-07-15",
        })

        body = (await client.get(f"/cars/{car_id}")).json()

        assert float(body["reference_price"]) == 560000.0
        assert body["reference_price_source"] == "OEM brochure"
        assert body["reference_price_checked_on"] == "2026-07-15"

    @pytest.mark.asyncio
    async def test_an_unknown_car_is_a_404_not_a_silent_pass(self, client):
        resp = await client.get(f"/cars/{uuid.uuid4()}/price-check?price=100000")
        assert resp.status_code == 404
