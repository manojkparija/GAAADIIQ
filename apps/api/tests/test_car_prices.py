"""
Ex-showroom prices on catalogue cars.

A new car's price belongs to the model, not to an advert: the manufacturer
publishes one figure whether or not any seller has listed the car. These tests
pin down that the price round-trips, that an unpriced model stays visibly
unpriced rather than becoming zero, and that only an admin can change what
every buyer sees.
"""
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.dependencies import get_admin_user
from db.session import get_db
from main import app
from models.user import User, UserRole


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


@pytest.fixture
def as_admin():
    """Run requests as an admin, without standing up a real Supabase session."""
    app.dependency_overrides[get_admin_user] = lambda: User(
        email="admin@test", role=UserRole.admin
    )
    yield
    app.dependency_overrides.pop(get_admin_user, None)


async def _token(client: AsyncClient, email: str = "seller@test.com") -> str:
    resp = await client.post("/auth/register", json={"email": email, "password": "password123"})
    return resp.json()["access_token"]


async def _create_car(client: AsyncClient, token: str, **overrides) -> dict:
    payload = {"make": "Maruti Suzuki", "model": "Swift", "year": 2025, "fuel_type": "petrol"}
    payload.update(overrides)
    resp = await client.post(
        "/cars", json=payload, headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_price_round_trips_without_rounding(client: AsyncClient):
    """
    Rupee amounts must survive the round trip exactly. A float column would
    turn 649000.50 into something that no longer matches the brochure.
    """
    token = await _token(client)
    car = await _create_car(client, token, ex_showroom_price="649000.50")

    assert Decimal(car["ex_showroom_price"]) == Decimal("649000.50")

    fetched = await client.get(f"/cars/{car['id']}")
    assert Decimal(fetched.json()["ex_showroom_price"]) == Decimal("649000.50")


@pytest.mark.asyncio
async def test_unpriced_car_reports_null_not_zero(client: AsyncClient):
    """
    The catalogue holds models nobody has priced yet. Those must come back as
    null so the UI can say "price on request" — a model shown at ₹0 misleads a
    buyer far more than one shown with no price.
    """
    token = await _token(client)
    car = await _create_car(client, token)

    assert car["ex_showroom_price"] is None


@pytest.mark.asyncio
async def test_priced_only_excludes_unpriced_models(client: AsyncClient):
    token = await _token(client)
    await _create_car(client, token, model="Swift", ex_showroom_price="649000")
    await _create_car(client, token, model="Baleno")  # no price entered

    resp = await client.get("/cars", params={"priced_only": True})
    body = resp.json()

    assert [c["model"] for c in body["items"]] == ["Swift"]
    assert body["total"] == 1

    # Without the flag the admin still sees the gap.
    all_cars = await client.get("/cars")
    assert {c["model"] for c in all_cars.json()["items"]} == {"Swift", "Baleno"}


@pytest.mark.asyncio
async def test_admin_can_set_and_clear_a_price(client: AsyncClient, as_admin):
    token = await _token(client)
    car = await _create_car(client, token)

    priced = await client.patch(
        f"/cars/{car['id']}", json={"ex_showroom_price": "799000"}
    )
    assert priced.status_code == 200
    assert Decimal(priced.json()["ex_showroom_price"]) == Decimal("799000")

    # Explicit null clears it back to "price on request". This is the case that
    # breaks if the router reads values rather than which fields were sent.
    cleared = await client.patch(
        f"/cars/{car['id']}", json={"ex_showroom_price": None}
    )
    assert cleared.status_code == 200
    assert cleared.json()["ex_showroom_price"] is None


@pytest.mark.asyncio
async def test_patch_leaves_omitted_fields_alone(client: AsyncClient, as_admin):
    """Setting a price must not wipe the model's specification."""
    token = await _token(client)
    car = await _create_car(client, token, transmission="manual", engine_cc=1197)

    resp = await client.patch(f"/cars/{car['id']}", json={"ex_showroom_price": "799000"})
    body = resp.json()

    assert body["transmission"] == "manual"
    assert body["engine_cc"] == 1197


@pytest.mark.asyncio
async def test_negative_price_is_rejected(client: AsyncClient, as_admin):
    token = await _token(client)
    car = await _create_car(client, token)

    resp = await client.patch(f"/cars/{car['id']}", json={"ex_showroom_price": "-1"})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_patch_requires_admin(client: AsyncClient):
    """A signed-in buyer must not be able to reprice the public catalogue."""
    token = await _token(client)
    car = await _create_car(client, token)

    resp = await client.patch(
        f"/cars/{car['id']}",
        json={"ex_showroom_price": "1"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code in (401, 403)


class TestCatalogueOptionsSuite:
    """
    The admin upload screen offers the identities the catalogue already holds.

    Make, model, variant and year are what an image is matched to its car on,
    so typing them by hand is how the catalogue acquires both "Maruti" and
    "Maruti Suzuki", and how a photograph misses the model it belongs to.
    """

    @pytest.mark.asyncio
    async def test_options_list_the_catalogue_identities(self, client: AsyncClient):
        token = await _token(client, "options1@test.com")
        await _create_car(client, token, model="Dzire", variant="ZXi", year=2026)

        resp = await client.get("/cars/catalogue/options")

        assert resp.status_code == 200
        assert {"make": "Maruti Suzuki", "model": "Dzire", "variant": "ZXi",
                "year": 2026, "ex_showroom_price": None} in resp.json()["items"]

    @pytest.mark.asyncio
    async def test_an_option_says_whether_the_model_has_a_price(self, client: AsyncClient):
        """
        "The catalogue knows this model" and "a buyer will see it" are
        different facts. New Cars renders only priced models, so an upload
        against a known-but-unpriced model succeeds, returns 201, and is never
        shown. The upload screen decides whether to ask for a price from this
        field; without it, it could only ask whether the model was known.
        """
        token = await _token(client, "options-price@test.com")
        await _create_car(client, token, make="Hyundai", model="Exter",
                          variant="SX", year=2026, ex_showroom_price="812000")
        await _create_car(client, token, make="Hyundai", model="Venue",
                          variant="S", year=2026)

        items = (await client.get("/cars/catalogue/options")).json()["items"]

        priced = next(i for i in items if i["model"] == "Exter")
        unpriced = next(i for i in items if i["model"] == "Venue")
        assert priced["ex_showroom_price"] == 812000
        assert unpriced["ex_showroom_price"] is None

    @pytest.mark.asyncio
    async def test_a_priced_row_makes_the_identity_priced(self, client: AsyncClient):
        """One priced row is enough: the model is listable."""
        token = await _token(client, "options-price2@test.com")
        await _create_car(client, token, make="Kia", model="Sonet",
                          variant="HTK", year=2026)
        await _create_car(client, token, make="Kia", model="Sonet",
                          variant="HTK", year=2026, ex_showroom_price="900000")

        items = (await client.get("/cars/catalogue/options")).json()["items"]

        sonets = [i for i in items if i["model"] == "Sonet"]
        assert len(sonets) == 1, "the identity is still offered once"
        assert sonets[0]["ex_showroom_price"] == 900000

    @pytest.mark.asyncio
    async def test_the_same_identity_is_offered_once(self, client: AsyncClient):
        token = await _token(client, "options2@test.com")
        for _ in range(2):
            await _create_car(client, token, make="Tata", model="Nexon",
                              variant="XZ", year=2026)

        resp = await client.get("/cars/catalogue/options")

        nexons = [i for i in resp.json()["items"]
                  if i["model"] == "Nexon" and i["variant"] == "XZ"]
        assert len(nexons) == 1

    @pytest.mark.asyncio
    async def test_options_do_not_require_a_login(self, client: AsyncClient):
        # Exposes nothing a buyer cannot already read from /cars.
        assert (await client.get("/cars/catalogue/options")).status_code == 200
