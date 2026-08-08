"""
The trims a model is sold in.

A catalogue row stands for a model, which is what a photograph belongs to and
what a buyer browses. What a buyer asks next is which trim to buy, and that is
entirely about the differences: what each costs, and what each gives you.

That lived in a hardcoded map in the Angular car detail page covering seven
models. Every other model showed no variants at all, and no admin action could
change it.

The research endpoint drafts trims with a language model, which will state a
plausible price with complete confidence. So nothing it produces is published:
a person reads a figure before a buyer budgets against it.
"""
import uuid
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
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
        "make": "Maruti Suzuki", "model": "S-Presso", "year": 2026,
        "fuel_type": "petrol", "ex_showroom_price": "530000",
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestVariantCrudSuite:
    @pytest.mark.asyncio
    async def test_a_variant_added_by_hand_is_shown_to_buyers(self, client, car):
        """
        An admin typing a price has already done the checking that review
        exists to force, so a manual trim needs no second approval.
        """
        resp = await client.post(f"/cars/{car['id']}/variants", json={
            "name": "VXi", "ex_showroom_price": "549000",
            "fuel_type": "Petrol", "transmission": "Manual",
            "features": ["Touchscreen", "6 Airbags"],
        })

        assert resp.status_code == 201
        body = resp.json()
        assert body["status"] == "published"
        assert body["source"] == "manual"
        assert body["features"] == ["Touchscreen", "6 Airbags"]

        listed = (await client.get(f"/cars/{car['id']}/variants")).json()
        assert [v["name"] for v in listed] == ["VXi"]

    @pytest.mark.asyncio
    async def test_a_trim_can_be_corrected(self, client, car):
        created = (await client.post(f"/cars/{car['id']}/variants", json={
            "name": "VXi", "ex_showroom_price": "549000",
        })).json()

        resp = await client.patch(
            f"/cars/{car['id']}/variants/{created['id']}",
            json={"ex_showroom_price": "559000"},
        )

        assert resp.status_code == 200
        assert resp.json()["ex_showroom_price"] == "559000.00"
        assert resp.json()["name"] == "VXi", "a patch must not blank what it omits"

    @pytest.mark.asyncio
    async def test_a_discontinued_trim_can_be_dropped(self, client, car):
        created = (await client.post(f"/cars/{car['id']}/variants", json={
            "name": "LXi",
        })).json()

        resp = await client.delete(f"/cars/{car['id']}/variants/{created['id']}")

        assert resp.status_code == 204
        assert (await client.get(f"/cars/{car['id']}/variants")).json() == []

    @pytest.mark.asyncio
    async def test_trims_are_listed_in_the_manufacturers_order(self, client, car):
        """Base to top, which is neither alphabetical nor by price."""
        for order, name in enumerate(["LXi", "VXi", "ZXi+"]):
            await client.post(f"/cars/{car['id']}/variants", json={
                "name": name, "sort_order": order,
            })

        listed = (await client.get(f"/cars/{car['id']}/variants")).json()

        assert [v["name"] for v in listed] == ["LXi", "VXi", "ZXi+"]

    @pytest.mark.asyncio
    async def test_variants_of_an_unknown_car_are_a_404(self, client):
        resp = await client.post(f"/cars/{uuid.uuid4()}/variants", json={"name": "VXi"})
        assert resp.status_code == 404


class TestResearchSuite:
    """
    A language model drafts the list; a person publishes it.

    The figures are prices a buyer budgets against, and a model will invent one
    as readily as it recalls one. Nothing it returns may reach a buyer unread.
    """

    DRAFT = [
        {"name": "LXi", "ex_showroom_price": 499000.0, "fuel_type": "Petrol",
         "transmission": "Manual", "engine_cc": 998, "seating_capacity": 5,
         "mileage": "24.76 km/l", "features": ["Dual Airbags"]},
        {"name": "VXi", "ex_showroom_price": 549000.0, "fuel_type": "Petrol",
         "transmission": "Manual", "engine_cc": 998, "seating_capacity": 5,
         "mileage": "24.76 km/l", "features": ["Touchscreen"]},
    ]

    @pytest.mark.asyncio
    async def test_researched_trims_land_as_drafts(self, client, car):
        with patch("services.variant_research.research_variants",
                   AsyncMock(return_value=self.DRAFT)):
            resp = await client.post(f"/cars/{car['id']}/variants/research")

        assert resp.status_code == 200
        drafted = resp.json()
        assert len(drafted) == 2
        assert all(v["status"] == "draft" for v in drafted)
        assert all(v["source"] == "ai" for v in drafted)

    @pytest.mark.asyncio
    async def test_a_draft_is_not_shown_to_buyers(self, client, car):
        with patch("services.variant_research.research_variants",
                   AsyncMock(return_value=self.DRAFT)):
            await client.post(f"/cars/{car['id']}/variants/research")

        public = (await client.get(f"/cars/{car['id']}/variants")).json()
        admin = (await client.get(
            f"/cars/{car['id']}/variants?include_drafts=true"
        )).json()

        assert public == [], "an unread figure must not reach a buyer"
        assert len(admin) == 2, "but an admin has to be able to see it to check it"

    @pytest.mark.asyncio
    async def test_publishing_a_draft_shows_it(self, client, car):
        with patch("services.variant_research.research_variants",
                   AsyncMock(return_value=self.DRAFT)):
            drafted = (await client.post(f"/cars/{car['id']}/variants/research")).json()

        await client.patch(
            f"/cars/{car['id']}/variants/{drafted[0]['id']}",
            json={"status": "published"},
        )

        public = (await client.get(f"/cars/{car['id']}/variants")).json()
        assert [v["name"] for v in public] == ["LXi"]

    @pytest.mark.asyncio
    async def test_research_does_not_overwrite_a_checked_price(self, client, car):
        """A published figure an admin vouched for must survive a later guess."""
        await client.post(f"/cars/{car['id']}/variants", json={
            "name": "VXi", "ex_showroom_price": "561000",
        })

        with patch("services.variant_research.research_variants",
                   AsyncMock(return_value=self.DRAFT)):
            created = (await client.post(f"/cars/{car['id']}/variants/research")).json()

        assert [v["name"] for v in created] == ["LXi"], "VXi was already recorded"
        all_variants = (await client.get(
            f"/cars/{car['id']}/variants?include_drafts=true"
        )).json()
        vxi = next(v for v in all_variants if v["name"] == "VXi")
        assert vxi["ex_showroom_price"] == "561000.00"
        assert vxi["source"] == "manual"

    @pytest.mark.asyncio
    async def test_research_being_unavailable_is_not_an_error(self, client, car):
        """
        The admin screen offers a shortcut. A shortcut that cannot run must
        leave the manual form working rather than replace it with an error.
        """
        with patch("services.variant_research.research_variants",
                   AsyncMock(return_value=[])):
            resp = await client.post(f"/cars/{car['id']}/variants/research")

        assert resp.status_code == 200
        assert resp.json() == []


class TestResearchCleaningSuite:
    """
    What comes back from a language model is not yet data.

    Each of these was chosen because the failure it prevents is silent: a price
    parsed out of "5.49 Lakh" as 549 would be stored, rendered, and read as a
    price.
    """

    @pytest.mark.parametrize("raw,expected", [
        (549000, 549000.0),
        ("549000", 549000.0),
        ("₹5,49,000", 549000.0),
        # Lakh notation lands outside the plausible band rather than as ₹5.49.
        ("5.49 Lakh", None),
        (5.49, None),
        (0, None),
        (-100, None),
        (99_999_999, None),
        (None, None),
        (True, None),
        ({"amount": 549000}, None),
    ])
    def test_only_a_plausible_rupee_figure_survives(self, raw, expected):
        from services.variant_research import _clean_price
        assert _clean_price(raw) == expected

    def test_a_trim_with_no_name_is_dropped(self):
        from services.variant_research import _clean
        cleaned = _clean({"variants": [
            {"name": "", "ex_showroom_price": 500000},
            {"name": "  ", "ex_showroom_price": 500000},
            {"name": "VXi"},
        ]})
        assert [v["name"] for v in cleaned] == ["VXi"]

    def test_a_repeated_trim_is_kept_once(self):
        """
        The unique index is on the lower-cased name, so a duplicate would fail
        the insert for the whole batch rather than for itself.
        """
        from services.variant_research import _clean
        cleaned = _clean({"variants": [
            {"name": "VXi"}, {"name": "vxi "}, {"name": "ZXi"},
        ]})
        assert [v["name"] for v in cleaned] == ["VXi", "ZXi"]

    def test_features_are_bounded_and_stringified(self):
        from services.variant_research import _clean
        cleaned = _clean({"variants": [{"name": "VXi", "features": list(range(20))}]})
        assert len(cleaned[0]["features"]) == 6

    def test_nonsense_shapes_produce_nothing(self):
        from services.variant_research import _clean
        assert _clean(None) == []
        assert _clean({"variants": "VXi, ZXi"}) == []
        assert _clean({"variants": [42, None]}) == []
