"""
The one-sentence advisor, end to end.

The interesting behaviour is not that it returns three cars. It is what it
refuses to do: recommend a trim nobody published, put a fuel cost on a car
whose mileage is unrecorded, count a component it could not compute into the
total, or fill in a requirement the buyer never stated.

Each of those failures produces a *plausible* answer, which is what makes them
worth a test — none of them looks wrong on the page.
"""

import uuid
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.dependencies import get_admin_user, get_current_user
from db.session import get_db
from main import app
from models.car import BodyType, Car, FuelType
from models.car_variant import CarVariant, VariantStatus
from models.user import User

LAKH = 100_000


@pytest_asyncio.fixture
async def session_factory(db_engine):
    return async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)


@pytest_asyncio.fixture
async def client(session_factory):
    async def override_db():
        async with session_factory() as session:
            yield session
            await session.commit()

    admin = User(id=uuid.uuid4(), email="advisor-admin@test.com", hashed_password="x")
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_admin_user] = lambda: admin
    app.dependency_overrides[get_current_user] = lambda: admin
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def _add_car(
    session_factory,
    *,
    make: str,
    model: str,
    body: BodyType,
    fuel: FuelType,
    seats: int,
    trims: list[tuple[str, int, str, VariantStatus]],
) -> Car:
    """A catalogue model with trims as (name, price, mileage, status)."""
    async with session_factory() as session:
        car = Car(
            id=uuid.uuid4(), make=make, model=model, year=2026,
            fuel_type=fuel, body_type=body, seating_capacity=seats,
            ex_showroom_price=Decimal(trims[0][1]),
        )
        session.add(car)
        await session.flush()
        for order, (name, price, mileage, status) in enumerate(trims):
            session.add(CarVariant(
                id=uuid.uuid4(), car_id=car.id, name=name,
                ex_showroom_price=Decimal(price),
                fuel_type=fuel.value.capitalize(), transmission="Manual",
                seating_capacity=seats, mileage=mileage,
                status=status, sort_order=order,
            ))
        await session.commit()
        return car


@pytest_asyncio.fixture
async def catalogue(session_factory):
    """A small catalogue with the shapes the tests need to tell apart."""
    await _add_car(
        session_factory, make="Maruti Suzuki", model="Brezza",
        body=BodyType.suv, fuel=FuelType.petrol, seats=5,
        trims=[
            ("LXi", 850_000, "19.8 kmpl", VariantStatus.published),
            ("VXi", 1_050_000, "19.8 kmpl", VariantStatus.published),
            ("ZXi+", 1_400_000, "19.8 kmpl", VariantStatus.published),
        ],
    )
    await _add_car(
        session_factory, make="Tata", model="Nexon",
        body=BodyType.suv, fuel=FuelType.petrol, seats=5,
        trims=[
            ("Smart", 800_000, "17.4 kmpl", VariantStatus.published),
            ("Fearless", 1_180_000, "17.4 kmpl", VariantStatus.published),
        ],
    )
    await _add_car(
        session_factory, make="Kia", model="Carens",
        body=BodyType.muv, fuel=FuelType.diesel, seats=7,
        trims=[("Premium", 1_150_000, "21.3 kmpl", VariantStatus.published)],
    )
    # Well inside the budget but priced only in draft — must never appear.
    await _add_car(
        session_factory, make="Citroen", model="C3",
        body=BodyType.hatchback, fuel=FuelType.petrol, seats=5,
        trims=[("Feel", 700_000, "19.4 kmpl", VariantStatus.draft)],
    )


async def _brief(client, query: str, **extra) -> dict:
    resp = await client.post("/advisor/brief", json={"query": query, **extra})
    assert resp.status_code == 200, resp.text
    return resp.json()


# ── The reported scenario ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_the_reported_sentence_produces_a_costed_shortlist(client, catalogue):
    """The feature request, answered end to end."""
    body = await _brief(
        client,
        "I have ₹12 lakh budget, family of 5, mostly city driving, 1,000 km/month",
    )

    assert body["missing"] == []
    assert 1 <= len(body["items"]) <= 3

    top = body["items"][0]
    assert top["variant"] is not None
    assert top["variant"]["ex_showroom_price"] <= 12 * LAKH * 1.08
    assert top["monthly_emi"]["amount"] > 0
    assert top["five_year_total"] > 0
    assert top["cost_per_km"] is not None
    assert top["resale_five_year"] is not None


@pytest.mark.asyncio
async def test_it_echoes_what_it_read(client, catalogue):
    """
    The buyer has to be able to correct a misread before acting on the answer.
    """
    body = await _brief(
        client, "12 lakh budget, family of 5, city driving, 1000 km/month"
    )
    joined = " ".join(body["understood"]).lower()
    assert "12 lakh" in joined
    assert "5 people" in joined
    assert "1,000 km" in joined


# ── Refusals ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_draft_trim_is_never_recommended(client, catalogue):
    """
    The C3 is the cheapest thing in the catalogue and fits the budget easily,
    but its price is a draft — nobody has checked it. A buyer must not budget
    against a figure that has not been through review.
    """
    body = await _brief(client, "under 12 lakh, family of 5, city, 1000 km/month")
    assert all(item["model"] != "C3" for item in body["items"])


@pytest.mark.asyncio
async def test_the_best_affordable_trim_is_picked_not_the_top_one(client, catalogue):
    """
    Brezza spans ₹8.5L to ₹14L. On a twelve-lakh budget the answer is VXi:
    ZXi+ is out of reach, and recommending LXi wastes the headroom the buyer
    told us about.
    """
    body = await _brief(client, "12 lakh budget, family of 5, city, 1000 km/month")
    brezza = next((i for i in body["items"] if i["model"] == "Brezza"), None)
    assert brezza is not None
    assert brezza["variant"]["name"] == "VXi"
    assert "ZXi+" in brezza["variant"]["priced_out"]


@pytest.mark.asyncio
async def test_seven_seats_rules_out_five_seat_cars(client, catalogue):
    """
    A stated seat count is a requirement, not a preference to trade off.

    Scored as a penalty rather than a filter, a five-seat Brezza still came
    third for a family of seven — visibly wrong on the page, and the reason
    this is a hard exclusion. A car that cannot carry the family is not a
    worse answer, it is not an answer.
    """
    body = await _brief(client, "15 lakh budget, family of 7, city, 1000 km/month")

    assert body["items"], "expected the seven-seater to be offered"
    for item in body["items"]:
        assert item["variant"]["seating_capacity"] >= 7, (
            f"{item['model']} seats {item['variant']['seating_capacity']} "
            "but was offered for a family of 7"
        )
    assert body["items"][0]["model"] == "Carens"


@pytest.mark.asyncio
async def test_a_missing_requirement_is_asked_for_not_invented(client, catalogue):
    """
    No monthly distance means no fuel cost. The endpoint must say so rather
    than assume an average and print a running cost off it.
    """
    body = await _brief(client, "12 lakh budget, family of 5")

    assert "km_per_month" in body["missing"]
    top = body["items"][0]
    fuel = next(line for line in top["five_year"] if line["label"] == "Fuel")
    assert fuel["basis"] == "unavailable"
    assert fuel["amount"] is None
    assert "Fuel" in top["five_year_excludes"]
    assert top["cost_per_km"] is None


@pytest.mark.asyncio
async def test_an_uncomputable_component_is_excluded_from_the_total_not_zeroed(
    client, catalogue
):
    """
    A total that silently drops fuel is lower than the truth and looks
    complete, which is worse than showing no total at all.
    """
    body = await _brief(client, "12 lakh budget, family of 5")
    top = body["items"][0]

    known = [line["amount"] for line in top["five_year"] if line["amount"] is not None]
    assert top["five_year_total"] == sum(known)
    assert top["five_year_excludes"]


@pytest.mark.asyncio
async def test_every_cost_line_declares_its_provenance(client, catalogue):
    """
    The whole reason this moved off the hardcoded brand ratios in the browser.
    A reader must be able to tell a computed figure from an applied rule.
    """
    body = await _brief(client, "12 lakh budget, family of 5, city, 1000 km/month")

    for line in body["items"][0]["five_year"]:
        assert line["basis"] in {"calculated", "estimated", "unavailable"}
        # A figure that is not straight arithmetic has to explain itself.
        if line["basis"] != "calculated":
            assert line["note"], f"{line['label']} gave no basis for its figure"


@pytest.mark.asyncio
async def test_nonsense_input_asks_again_instead_of_guessing(client, catalogue):
    body = await _brief(client, "hello")
    assert body["items"] == []
    assert body["message"]
    assert set(body["missing"]) == {"budget", "seats", "km_per_month", "usage"}


@pytest.mark.asyncio
async def test_an_impossible_budget_returns_nothing_rather_than_the_cheapest_car(
    client, catalogue
):
    """
    Two lakh buys nothing here. Showing an eight-lakh car anyway would be
    four times the stated ceiling.
    """
    body = await _brief(client, "2 lakh budget, family of 5, city, 1000 km/month")
    assert body["items"] == []
    assert body["message"]


# ── Supplying what was missing ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_answers_collected_afterwards_complete_the_costing(client, catalogue):
    """
    The caller asks for what `missing` named and sends it back. The fuel line
    that was unavailable must now compute.
    """
    body = await _brief(client, "12 lakh budget, family of 5", km_per_month=1000)

    assert "km_per_month" not in body["missing"]
    top = body["items"][0]
    fuel = next(line for line in top["five_year"] if line["label"] == "Fuel")
    assert fuel["basis"] == "calculated"
    assert fuel["amount"] > 0
    assert top["cost_per_km"] > 0


@pytest.mark.asyncio
async def test_assumptions_travel_with_the_numbers(client, catalogue):
    """
    A running cost is meaningless without the fuel price it assumed, and an
    EMI without its rate and tenure.
    """
    body = await _brief(client, "12 lakh budget, family of 5, city, 1000 km/month")

    assert body["assumptions"]["fuel_prices"]["petrol"] > 0
    assert body["assumptions"]["fuel_prices_as_of"]
    assert body["assumptions"]["interest_pct"] > 0
    assert body["assumptions"]["tenure_months"] > 0

    emi_note = body["items"][0]["monthly_emi"]["note"]
    assert "%" in emi_note
