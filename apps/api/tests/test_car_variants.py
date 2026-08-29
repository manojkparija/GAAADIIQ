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


class TestResearchAvailabilitySuite:
    """
    The screen can ask whether AI drafting is switched off.

    Reported: "Draft trims with AI" appeared to do nothing, and the screen
    said "Nothing new found. Trims already recorded are left alone."

    The research endpoint answers 200 with an empty list when drafting is
    unavailable, and that is deliberate — test_research_being_unavailable_is
    _not_an_error above holds it in place, because a shortcut that cannot run
    must leave the manual form working rather than replace it with an error.

    The cost is that an empty list means two things, and the screen reported
    both as a fact about the car. Asking separately lets the screen tell them
    apart without the research endpoint changing what it returns to anyone.
    """

    @pytest.mark.asyncio
    async def test_reports_available_when_a_key_is_configured(self, client):
        with patch("services.variant_research.available", return_value=True):
            resp = await client.get("/cars/variants/research-availability")

        assert resp.status_code == 200
        assert resp.json() == {"available": True, "reason": None}

    @pytest.mark.asyncio
    async def test_names_the_missing_key_when_it_is_not(self, client):
        with patch("services.variant_research.available", return_value=False):
            resp = await client.get("/cars/variants/research-availability")

        assert resp.status_code == 200
        body = resp.json()
        assert body["available"] is False
        # The admin needs to know it is a deployment setting, not the car.
        assert "GEMINI_API_KEY" in body["reason"]
        # And that the manual route still works, so they are not simply stuck.
        assert "by hand" in body["reason"]

    @pytest.mark.asyncio
    async def test_the_path_is_not_swallowed_by_the_car_id_route(self, client):
        """
        /cars/variants/... must not be read as /cars/{car_id} with car_id
        "variants".

        It resolves because car_id is typed uuid.UUID, which compiles to a
        UUID-shaped path regex that "variants" cannot match — so the request
        falls through to this route even though GET /{car_id} is declared
        first. Declaration order is NOT what saves it, which is worth stating
        because the obvious assumption is the opposite: moving this route
        after the car-id ones changes nothing, and I checked.

        What this does catch is car_id being loosened to str, or the literal
        segment being renamed to something a UUID could match. Either would
        turn the request into a 422 that reads as a broken endpoint.
        """
        with patch("services.variant_research.available", return_value=True):
            resp = await client.get("/cars/variants/research-availability")

        assert resp.status_code != 422, (
            "the literal path lost to /cars/{car_id}: move the route above it"
        )
        assert "available" in resp.json()

    @pytest.mark.asyncio
    async def test_the_research_endpoint_still_answers_200_when_unavailable(self, client, car):
        """
        The contract this endpoint exists to preserve.

        Adding a way to ask about availability must not have turned the
        shortcut itself into an error, which is what a first attempt at this
        did — it raised 503 and broke five existing tests.
        """
        with patch("services.variant_research.available", return_value=False):
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

    def test_features_are_bounded(self):
        from services.variant_research import _clean
        cleaned = _clean({"variants": [
            {"name": "VXi", "features": [f"Feature {i}" for i in range(20)]}
        ]})
        assert len(cleaned[0]["features"]) == 6

    def test_numbers_are_not_treated_as_features(self):
        """
        This assertion used to be the opposite, under the name
        "..._and_stringified": it fed list(range(20)) and expected six
        features out, pinning a str() call on each item.

        That str() is what put "{'feature': 'Head-Up Display'}" in front of
        buyers when the model returned objects instead of strings, reported
        from UAT. Stringifying whatever arrives is not robustness — a features
        list reading "0, 1, 2, 3, 4, 5" is nonsense with the confidence of
        data, so a value that is not a phrase is now dropped.
        """
        from services.variant_research import _clean
        cleaned = _clean({"variants": [{"name": "VXi", "features": list(range(20))}]})
        assert cleaned[0]["features"] == []

    def test_features_returned_as_objects_are_unwrapped(self):
        from services.variant_research import _clean
        cleaned = _clean({"variants": [
            {"name": "VXi", "features": [{"feature": "Head-Up Display"}]}
        ]})
        assert cleaned[0]["features"] == ["Head-Up Display"]

    def test_nonsense_shapes_produce_nothing(self):
        from services.variant_research import _clean
        assert _clean(None) == []
        assert _clean({"variants": "VXi, ZXi"}) == []
        assert _clean({"variants": [42, None]}) == []


class TestVariantPriceBandSuite:
    """
    What a listing card is told about a model's trims.

    A card renders one catalogue row and never fetches that row's trims, so the
    only price within its reach was `cars.ex_showroom_price` — a figure kept by
    hand, separately from the trims, which drifts. The same Fronx read
    "₹9.30L onwards · 1 Variant" on the New Cars card and "₹6.84 - 11.98 Lakh"
    on its own detail page, which reads the trims. The band and the count are
    served from here so both screens answer from the same source.
    """

    @pytest.mark.asyncio
    async def test_the_band_spans_the_published_trims(self, client, car):
        for name, price in [("LXi", "684000"), ("VXi", "820000"), ("ZXi", "1198000")]:
            await client.post(f"/cars/{car['id']}/variants", json={
                "name": name, "ex_showroom_price": price,
            })

        body = (await client.get(f"/cars/{car['id']}")).json()

        assert body["variant_count"] == 3
        assert float(body["variant_price_min"]) == 684000
        assert float(body["variant_price_max"]) == 1198000
        # The catalogue figure is untouched and still disagrees — which is the
        # whole point: the card must not read it while trims exist.
        assert float(body["ex_showroom_price"]) == 530000

    @pytest.mark.asyncio
    async def test_a_draft_price_is_not_in_the_band(self, client, car):
        """A draft is a figure nobody has checked; quoting it would price a car
        against a number the language model invented."""
        await client.post(f"/cars/{car['id']}/variants", json={
            "name": "VXi", "ex_showroom_price": "820000",
        })
        with patch("services.variant_research.research_variants",
                   AsyncMock(return_value={"variants": [
                       {"name": "Cheap Draft", "ex_showroom_price": "100000"},
                   ]})):
            await client.post(f"/cars/{car['id']}/variants/research")

        body = (await client.get(f"/cars/{car['id']}")).json()

        assert body["variant_count"] == 1
        assert float(body["variant_price_min"]) == 820000

    @pytest.mark.asyncio
    async def test_an_unpriced_trim_does_not_vote(self, client, car):
        """
        min()/max() ignore NULL, so a trim with no price neither drags the band
        to zero nor discards it. A card showing "₹0.00L onwards" because one
        trim is half-entered would be worse than showing the priced range.
        """
        await client.post(f"/cars/{car['id']}/variants", json={
            "name": "VXi", "ex_showroom_price": "820000",
        })
        await client.post(f"/cars/{car['id']}/variants", json={"name": "Base"})

        body = (await client.get(f"/cars/{car['id']}")).json()

        assert body["variant_count"] == 2
        assert float(body["variant_price_min"]) == 820000
        assert float(body["variant_price_max"]) == 820000

    @pytest.mark.asyncio
    async def test_a_car_with_no_trims_reports_no_band(self, client, car):
        """The caller falls back to the catalogue price, which is all such a
        car has."""
        body = (await client.get(f"/cars/{car['id']}")).json()

        assert body["variant_count"] == 0
        assert body["variant_price_min"] is None
        assert body["variant_price_max"] is None

    @pytest.mark.asyncio
    async def test_the_listing_endpoint_carries_the_band_too(self, client, car):
        """The listing page is where the wrong price was rendered, and it does
        not call the single-car endpoint."""
        await client.post(f"/cars/{car['id']}/variants", json={
            "name": "LXi", "ex_showroom_price": "684000",
        })

        listed = (await client.get("/cars")).json()["items"]
        row = next(c for c in listed if c["id"] == car["id"])

        assert row["variant_count"] == 1
        assert float(row["variant_price_min"]) == 684000
