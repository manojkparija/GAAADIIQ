"""
Typing a car's features and specs by hand.

## What was reported

The Maruti Suzuki Victoris page, with images uploaded and variants listed,
showing under Features:

    Feature details for this Maruti Suzuki Victoris haven't been added yet.

`cars.features` had exactly one writer in the codebase: POST
/cars/{id}/research-details, which asks a language model. That is fine when
the model knows the car and useless when it does not — which is exactly a
launch whose price is not announced yet. CarUpdate accepted variant, fuel,
transmission, body type, seating, engine and the price fields, and not these.
So there was no route at all to a populated Features tab for that car.

## The thing these tests are really protecting

Not the new fields. The OLD ones.

PATCH /cars/{id} is what Admin → Pricing calls to publish a price and correct
a fuel type, and it applies `model_dump(exclude_unset=True)`. Adding two
optional fields must leave that exactly as it was: a price edit that says
nothing about features must not blank them, and a features edit must not
restate the price. Both directions are tested below, because the failure is
silent — the save succeeds and the other tab quietly empties.

The second is the AI draft. research_car_details fills a field only when it is
empty, so it has always been gap-filling rather than overwriting. That property
now protects hand-typed content too, and a test pins it: a person who curates a
feature list must not have it replaced by a model's guess the next time
somebody presses the button.
"""
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.dependencies import get_admin_user
from db.session import get_db
from main import app
from models.car import Car, FuelType
from models.user import User, UserRole


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

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_admin_user] = lambda: User(
        email="admin@test", role=UserRole.admin
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def car(db_engine):
    """One catalogue car, as an image upload would have created it: no details."""
    factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)
    row = Car(
        id=uuid.uuid4(),
        make="Maruti Suzuki",
        model="Victoris",
        year=2026,
        fuel_type=FuelType.petrol,
    )
    async with factory() as session:
        session.add(row)
        await session.commit()
    return row


# ── the new capability ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_features_can_be_typed_and_come_back(client, car):
    """THE REPORTED GAP. Before this, CarUpdate had no such field."""
    resp = await client.patch(
        f"/cars/{car.id}",
        json={"features": ["360° camera", "Ventilated front seats", "Six airbags"]},
    )

    assert resp.status_code == 200
    assert resp.json()["features"] == [
        "360° camera", "Ventilated front seats", "Six airbags",
    ]

    # And on the page's own read, not only the write's echo.
    assert (await client.get(f"/cars/{car.id}")).json()["features"] == [
        "360° camera", "Ventilated front seats", "Six airbags",
    ]


@pytest.mark.asyncio
async def test_specs_can_be_typed_as_label_value_pairs(client, car):
    resp = await client.patch(
        f"/cars/{car.id}",
        json={"specs": [
            {"label": "Engine", "value": "1462 cc"},
            {"label": "Boot space", "value": "308 litres"},
        ]},
    )

    assert resp.status_code == 200
    assert resp.json()["specs"] == [
        {"label": "Engine", "value": "1462 cc"},
        {"label": "Boot space", "value": "308 litres"},
    ]


@pytest.mark.asyncio
async def test_blank_rows_are_dropped_rather_than_rejected(client, car):
    """The editor renders empty rows to type into.

    Refusing the whole save because one was left blank is a validation failure
    with no visible cause — the person sees a row they never touched.
    """
    resp = await client.patch(
        f"/cars/{car.id}",
        json={
            "features": ["  Sunroof  ", "", "   "],
            "specs": [
                {"label": "Engine", "value": "1462 cc"},
                {"label": "", "value": "orphan"},
                {"label": "Boot", "value": ""},
            ],
        },
    )

    body = resp.json()
    assert body["features"] == ["Sunroof"]
    assert body["specs"] == [{"label": "Engine", "value": "1462 cc"}]


@pytest.mark.asyncio
async def test_the_same_bounds_as_the_ai_draft(client, car):
    # A hand-entered list the drafted path would have truncated is the same
    # list rendered differently: the tab cannot tell which route a value took.
    resp = await client.patch(
        f"/cars/{car.id}",
        json={"features": [f"Feature {n}" for n in range(40)]},
    )

    assert len(resp.json()["features"]) == 16  # MAX_FEATURES


@pytest.mark.asyncio
async def test_features_can_be_cleared(client, car):
    await client.patch(f"/cars/{car.id}", json={"features": ["Wrong list"]})

    resp = await client.patch(f"/cars/{car.id}", json={"features": []})

    assert resp.json()["features"] == []


# ── what must not have changed ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_price_edit_does_not_blank_the_features(client, car):
    """THE ONE THAT MATTERS MOST.

    Admin → Pricing PATCHes this endpoint with a price and nothing else. If
    adding these fields made an omitted list read as "clear it", every price
    edit would silently empty the Features tab, and nothing in that screen
    would show it.
    """
    await client.patch(f"/cars/{car.id}", json={"features": ["Six airbags"]})

    await client.patch(f"/cars/{car.id}", json={"ex_showroom_price": "1050000"})

    body = (await client.get(f"/cars/{car.id}")).json()
    assert body["features"] == ["Six airbags"]
    assert body["ex_showroom_price"] == "1050000.00"


@pytest.mark.asyncio
async def test_a_features_edit_does_not_disturb_the_price(client, car):
    # The mirror image, and the same failure with the columns swapped.
    await client.patch(f"/cars/{car.id}", json={"ex_showroom_price": "1050000"})

    await client.patch(f"/cars/{car.id}", json={"features": ["Six airbags"]})

    body = (await client.get(f"/cars/{car.id}")).json()
    assert body["ex_showroom_price"] == "1050000.00"
    assert body["fuel_type"] == "petrol"


@pytest.mark.asyncio
async def test_an_unrelated_edit_leaves_both_alone(client, car):
    await client.patch(
        f"/cars/{car.id}",
        json={"features": ["Six airbags"], "specs": [{"label": "Engine", "value": "1462 cc"}]},
    )

    await client.patch(f"/cars/{car.id}", json={"seating_capacity": 5})

    body = (await client.get(f"/cars/{car.id}")).json()
    assert body["features"] == ["Six airbags"]
    assert body["specs"] == [{"label": "Engine", "value": "1462 cc"}]


@pytest.mark.asyncio
async def test_the_ai_draft_does_not_overwrite_what_a_person_typed(client, car, monkeypatch):
    """Curated content outranks a model's guess.

    research_car_details has always written a field only when it is empty. That
    was about not overwriting earlier research; it now protects hand-typed
    lists too, and this pins it — the button is one click away from the editor
    and pressing it must never be destructive.
    """
    async def _fake_details(make, model, year):
        return {
            "specs": [{"label": "Engine", "value": "AI SAYS 9999 cc"}],
            "features": ["AI feature"],
        }

    monkeypatch.setattr(
        "routers.cars.variant_research.research_model_details", _fake_details
    )

    await client.patch(
        f"/cars/{car.id}",
        json={
            "features": ["Typed by a person"],
            "specs": [{"label": "Engine", "value": "1462 cc"}],
        },
    )

    await client.post(f"/cars/{car.id}/research-details")

    body = (await client.get(f"/cars/{car.id}")).json()
    assert body["features"] == ["Typed by a person"]
    assert body["specs"] == [{"label": "Engine", "value": "1462 cc"}]


@pytest.mark.asyncio
async def test_the_ai_draft_still_fills_an_empty_car(client, car, monkeypatch):
    # The other half: gap-filling must keep working, or this change has broken
    # the feature it was built beside.
    async def _fake_details(make, model, year):
        return {
            "specs": [{"label": "Engine", "value": "1462 cc"}],
            "features": ["Researched feature"],
        }

    monkeypatch.setattr(
        "routers.cars.variant_research.research_model_details", _fake_details
    )

    await client.post(f"/cars/{car.id}/research-details")

    body = (await client.get(f"/cars/{car.id}")).json()
    assert body["features"] == ["Researched feature"]


def test_the_edit_is_gated_on_an_admin():
    """This is what every buyer sees for a model, not one seller's advert.

    ASSERTED ON THE ROUTE, NOT BY DRIVING IT.

    The obvious version of this test — PATCH with no credentials, expect 401 —
    passes for the wrong reason and would have been worthless. get_admin_user
    returns a fabricated dev admin whenever the app is not in production and no
    token is presented (core/dependencies.py, "for testing only and should
    NEVER be used in production"). So an unauthenticated PATCH in a test run
    reaches the handler and 404s on the car id, and the assertion that it was
    refused can only be written by misreading that.

    What can be checked here is that the dependency is still declared. Removing
    it is the change this guards, and that is visible without authentication
    working.
    """
    from fastapi.routing import APIRoute

    route = next(
        r for r in app.routes
        if isinstance(r, APIRoute) and r.path == "/cars/{car_id}" and "PATCH" in r.methods
    )
    names = {d.call.__name__ for d in route.dependant.dependencies if d.call}
    assert "get_admin_user" in names, f"PATCH /cars/{{car_id}} is not admin-gated: {names}"
