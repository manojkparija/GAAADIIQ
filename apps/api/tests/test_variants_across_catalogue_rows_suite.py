"""
A model's trims reach the buyer whichever catalogue row they land on.

## What was reported

The Maruti Suzuki Swift's detail page, Variants tab: empty. Admin -> Variants
for the same car: "Visible to buyers (13)", thirteen published trims listed
with prices.

Both screens were right. They were reading different `cars` rows.

## Why there is more than one row

By design and by accident:

  - media_admin._ensure_catalogue_car creates a row per make+model+YEAR, so a
    2025 Swift and a 2026 Swift are two rows
  - the sell form inserts a fresh `cars` row on every submission
  - `cars.id` is the only thing car_variants.car_id points at

Trims get attached to whichever row the admin screen had open. The buyer page
asks about whichever row Browse resolved to. Nothing linked them, so a page
could show an empty tab while the trims sat one row away.

## The rule these pin

A trim ladder is a property of the MODEL. "Which versions of the Swift can I
buy" has one answer, and which catalogue row the buyer happened to land on is
not part of the question.

So the published view resolves by make and model — the way media_library
already resolves photographs, and the way _ensure_catalogue_car already
matches. The ADMIN view does not widen, and that is the load-bearing half:
include_drafts is the editing screen, and showing it a neighbouring row's
trims would mean an Edit button that silently writes somewhere else.
"""
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from db.session import get_db
from main import app
from models.car import Car, FuelType
from models.car_variant import CarVariant, VariantSource, VariantStatus


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
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def seed(db_engine):
    factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)

    async def _add(*rows):
        async with factory() as session:
            for row in rows:
                session.add(row)
            await session.commit()

    return _add


def _car(make="Maruti Suzuki", model="Swift", year=2026) -> Car:
    return Car(id=uuid.uuid4(), make=make, model=model, year=year,
               fuel_type=FuelType.petrol)


def _trim(car: Car, name: str, price, status=VariantStatus.published) -> CarVariant:
    return CarVariant(
        id=uuid.uuid4(), car_id=car.id, name=name, ex_showroom_price=price,
        fuel_type="Petrol", transmission="Manual",
        status=status, source=VariantSource.manual, sort_order=0,
    )


# ── the reported bug ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_trims_on_a_sibling_row_reach_the_buyer(client, seed):
    """THE REPORTED BUG.

    Thirteen trims on one Swift row, a buyer on another, and an empty tab.
    """
    page_row = _car(year=2026)
    admin_row = _car(year=2025)
    await seed(page_row, admin_row,
               _trim(admin_row, "VXi", 668000), _trim(admin_row, "ZXi", 894000))

    rows = (await client.get(f"/cars/{page_row.id}/variants")).json()

    assert [r["name"] for r in rows] == ["VXi", "ZXi"]


@pytest.mark.asyncio
async def test_a_different_model_is_not_dragged_in(client, seed):
    # Widening to the model must not widen to the catalogue.
    page_row = _car(model="Swift")
    other = _car(model="Baleno")
    await seed(page_row, other, _trim(other, "Baleno Alpha", 999000))

    rows = (await client.get(f"/cars/{page_row.id}/variants")).json()

    assert rows == []


@pytest.mark.asyncio
async def test_capitalisation_does_not_split_a_model(client, seed):
    # Catalogue rows disagree about case constantly — the EV picker hit exactly
    # this, and _ensure_catalogue_car already matches lower+trim.
    page_row = _car(make="Maruti Suzuki", model="Swift")
    sibling = _car(make="  maruti suzuki ", model="SWIFT")
    await seed(page_row, sibling, _trim(sibling, "VXi", 668000))

    rows = (await client.get(f"/cars/{page_row.id}/variants")).json()

    assert [r["name"] for r in rows] == ["VXi"]


# ── what must not have changed ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_admin_view_still_sees_only_its_own_row(client, seed):
    """THE ONE THAT MATTERS MOST.

    include_drafts is the editing screen. If it showed a neighbouring row's
    trims, Edit and Delete would act on a car the admin is not looking at.
    """
    editing = _car(year=2026)
    sibling = _car(year=2025)
    await seed(editing, sibling,
               _trim(editing, "Mine", 500000),
               _trim(sibling, "Theirs", 600000))

    rows = (await client.get(f"/cars/{editing.id}/variants?include_drafts=true")).json()

    assert [r["name"] for r in rows] == ["Mine"]


@pytest.mark.asyncio
async def test_a_draft_still_never_reaches_a_buyer(client, seed):
    # Widening the row must not widen the status. A draft is a figure nobody
    # has read, and it is now reachable from one more row than before.
    page_row = _car(year=2026)
    sibling = _car(year=2025)
    await seed(page_row, sibling,
               _trim(sibling, "Unreviewed", 700000, status=VariantStatus.draft))

    rows = (await client.get(f"/cars/{page_row.id}/variants")).json()

    assert rows == []


@pytest.mark.asyncio
async def test_the_price_ladder_still_leads_with_the_cheapest(client, seed):
    page_row = _car()
    await seed(page_row,
               _trim(page_row, "ZXi", 894000),
               _trim(page_row, "LXi", 584000),
               _trim(page_row, "VXi", 668000))

    rows = (await client.get(f"/cars/{page_row.id}/variants")).json()

    assert [r["name"] for r in rows] == ["LXi", "VXi", "ZXi"]


# ── the duplicate a wider lookup creates ────────────────────────────────────

@pytest.mark.asyncio
async def test_one_row_per_trim_name_across_model_years(client, seed):
    # Two model years both selling a "VXi" would otherwise list it twice, at
    # two prices, with nothing to tell them apart.
    page_row = _car(year=2026)
    sibling = _car(year=2025)
    await seed(page_row, sibling,
               _trim(page_row, "VXi", 668000),
               _trim(sibling, "VXi", 649000))

    rows = (await client.get(f"/cars/{page_row.id}/variants")).json()

    assert len(rows) == 1


@pytest.mark.asyncio
async def test_the_buyers_own_model_year_wins_that_tie(client, seed):
    # The more specific answer. A 2026 buyer is quoted the 2026 price.
    page_row = _car(year=2026)
    sibling = _car(year=2025)
    await seed(page_row, sibling,
               _trim(sibling, "VXi", 649000),
               _trim(page_row, "VXi", 668000))

    rows = (await client.get(f"/cars/{page_row.id}/variants")).json()

    assert len(rows) == 1
    assert float(rows[0]["ex_showroom_price"]) == 668000


@pytest.mark.asyncio
async def test_an_unknown_car_yields_nothing_rather_than_everything(client, seed):
    # A bad id must not resolve to "no make, no model" and match the catalogue.
    await seed(_car(), _trim(_car(), "Stray", 500000))

    rows = (await client.get(f"/cars/{uuid.uuid4()}/variants")).json()

    assert rows == []
