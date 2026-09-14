"""
The grid card and the AI Advisor agree with the detail page about a model.

## What this continues

The detail page already resolves a model's trims across its catalogue rows
(test_variants_across_catalogue_rows_suite.py). Two other surfaces still keyed
on one row's id, so the same Swift could read three different ways:

  - `_variant_summaries` feeds the New Cars card's "N variants" and its price
    band. Scoped to one row, the card advertised a band the page it opens
    disagrees with.
  - the Advisor scored each catalogue ROW. A model with trims on two rows was
    recommended twice, taking two of three shortlist places; a model whose
    trims sat on a neighbouring row was scored on whatever its own row held.

## The rule these pin

A model is one thing to a buyer. Which catalogue row a surface happened to
resolve to is not part of any question they asked.
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


def _car(make="Maruti Suzuki", model="Swift", year=2026, **kw) -> Car:
    return Car(id=uuid.uuid4(), make=make, model=model, year=year,
               fuel_type=FuelType.petrol, **kw)


def _trim(car: Car, name: str, price, status=VariantStatus.published, **kw) -> CarVariant:
    fields = {"fuel_type": "Petrol", "transmission": "Manual"}
    fields.update(kw)
    return CarVariant(
        id=uuid.uuid4(), car_id=car.id, name=name, ex_showroom_price=price,
        status=status, source=VariantSource.manual, sort_order=0, **fields,
    )


async def _card_for(client, car: Car) -> dict:
    body = (await client.get("/cars?page=1&page_size=100")).json()
    return next(i for i in body["items"] if i["id"] == str(car.id))


# ── the New Cars card ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_card_counts_trims_held_by_a_sibling_row(client, seed):
    """THE REPORTED SHAPE, on the grid instead of the page.

    The card said "no variants" while the model's ladder sat one row away.
    """
    card_row = _car(year=2026)
    sibling = _car(year=2025)
    await seed(card_row, sibling,
               _trim(sibling, "VXi", 668000), _trim(sibling, "ZXi", 894000))

    card = await _card_for(client, card_row)

    assert card["variant_count"] == 2
    assert float(card["variant_price_min"]) == 668000
    assert float(card["variant_price_max"]) == 894000


@pytest.mark.asyncio
async def test_the_card_and_the_page_quote_the_same_band(client, seed):
    # The contradiction a buyer actually sees: two screens, one model, two
    # numbers. Asserting they match is the point, not either figure alone.
    card_row = _car(year=2026)
    sibling = _car(year=2025)
    await seed(card_row, sibling,
               _trim(card_row, "LXi", 584000), _trim(sibling, "ZXi", 894000))

    card = await _card_for(client, card_row)
    trims = (await client.get(f"/cars/{card_row.id}/variants")).json()
    prices = [float(t["ex_showroom_price"]) for t in trims]

    assert card["variant_count"] == len(trims)
    assert float(card["variant_price_min"]) == min(prices)
    assert float(card["variant_price_max"]) == max(prices)


@pytest.mark.asyncio
async def test_the_card_gathers_gearboxes_across_rows(client, seed):
    # The filter reads these. A model whose automatic sits on the other row
    # was hidden by ticking Automatic — the S-Presso bug, one row further out.
    card_row = _car(year=2026)
    sibling = _car(year=2025)
    await seed(card_row, sibling,
               _trim(card_row, "VXi", 668000, transmission="Manual"),
               _trim(sibling, "VXi AMT", 718000, transmission="Automatic"))

    card = await _card_for(client, card_row)

    assert sorted(card["variant_transmissions"]) == ["Automatic", "Manual"]


@pytest.mark.asyncio
async def test_the_card_does_not_borrow_from_another_model(client, seed):
    card_row = _car(model="Swift")
    other = _car(model="Baleno")
    await seed(card_row, other, _trim(other, "Alpha", 999000))

    card = await _card_for(client, card_row)

    assert card["variant_count"] == 0


@pytest.mark.asyncio
async def test_a_draft_is_still_not_counted_on_the_card(client, seed):
    # Widening the rows must not widen the status.
    card_row = _car(year=2026)
    sibling = _car(year=2025)
    await seed(card_row, sibling,
               _trim(sibling, "Unreviewed", 700000, status=VariantStatus.draft))

    card = await _card_for(client, card_row)

    assert card["variant_count"] == 0


@pytest.mark.asyncio
async def test_a_trim_name_in_two_model_years_is_counted_once(client, seed):
    card_row = _car(year=2026)
    sibling = _car(year=2025)
    await seed(card_row, sibling,
               _trim(card_row, "VXi", 668000), _trim(sibling, "VXi", 649000))

    card = await _card_for(client, card_row)

    assert card["variant_count"] == 1
    # The buyer's own model year wins the tie, as it does on the page.
    assert float(card["variant_price_min"]) == 668000


@pytest.mark.asyncio
async def test_an_unpriced_trim_counts_without_dragging_the_band_down(client, seed):
    # min()/max() ignored NULL when this was SQL; moving the aggregate into
    # Python must not quietly turn a missing price into zero.
    card_row = _car()
    await seed(card_row,
               _trim(card_row, "LXi", None), _trim(card_row, "VXi", 668000))

    card = await _card_for(client, card_row)

    assert card["variant_count"] == 2
    assert float(card["variant_price_min"]) == 668000


# ── the AI Advisor ──────────────────────────────────────────────────────────

async def _advice(client, query="12 lakh budget, family of 5, city driving, 1000 km a month"):
    res = await client.post("/advisor/brief", json={"query": query})
    return res.json()


@pytest.mark.asyncio
async def test_the_advisor_recommends_a_model_once_not_once_per_row(client, seed):
    """THE ONE THAT MATTERS MOST HERE.

    Two rows each holding trims meant the same model took two of the three
    shortlist places, hiding a genuine alternative behind a duplicate.
    """
    swift_new = _car(year=2026, seating_capacity=5)
    swift_old = _car(year=2025, seating_capacity=5)
    baleno = _car(model="Baleno", year=2026, seating_capacity=5)
    await seed(swift_new, swift_old, baleno,
               _trim(swift_new, "VXi", 668000),
               _trim(swift_old, "LXi", 584000),
               _trim(baleno, "Delta", 750000))

    body = await _advice(client)
    models = [i["model"] for i in body["items"]]

    assert models.count("Swift") == 1
    assert "Baleno" in models


@pytest.mark.asyncio
async def test_the_advisor_can_pick_a_trim_held_by_the_other_row(client, seed):
    # Scored row by row, the only trim inside a small budget was invisible
    # because it hung off the neighbouring model year.
    representative = _car(year=2026, seating_capacity=5)
    sibling = _car(year=2025, seating_capacity=5)
    await seed(representative, sibling,
               _trim(representative, "ZXi", 1_190_000),
               _trim(sibling, "LXi", 584000))

    body = await _advice(client, "6 lakh budget, city driving, 800 km a month")
    swifts = [i for i in body["items"] if i["model"] == "Swift"]

    # One recommendation, on the representative row, quoting the trim that
    # lives on the other one. Asserting the car id too is what makes this
    # fail under the old row-by-row scoring, which reached LXi only by
    # recommending the sibling row as a car in its own right.
    assert len(swifts) == 1
    assert swifts[0]["car_id"] == str(representative.id)
    assert swifts[0]["variant"]["name"] == "LXi"


@pytest.mark.asyncio
async def test_the_newest_model_year_represents_the_model(client, seed):
    # A buyer sent to a recommendation should land on the current car, not a
    # superseded row that happens to sort first.
    newer = _car(year=2026, seating_capacity=5)
    older = _car(year=2021, seating_capacity=5)
    await seed(newer, older,
               _trim(newer, "VXi", 668000), _trim(older, "VXi", 520000))

    body = await _advice(client)
    swifts = [i for i in body["items"] if i["model"] == "Swift"]

    assert [i["car_id"] for i in swifts] == [str(newer.id)]


@pytest.mark.asyncio
async def test_a_draft_trim_still_never_reaches_the_advisor(client, seed):
    # A draft is a figure nobody has read, and the Advisor quotes prices.
    representative = _car(year=2026, seating_capacity=5)
    sibling = _car(year=2025, seating_capacity=5)
    await seed(representative, sibling,
               _trim(representative, "VXi", 900000),
               _trim(sibling, "Unreviewed", 400000, status=VariantStatus.draft))

    body = await _advice(client, "5 lakh budget, city driving, 800 km a month")

    assert all(i["model"] != "Swift" for i in body["items"])


# ── the same model, spelled two ways ────────────────────────────────────────
#
# vehicle_identity opens with the pair that motivated it:
#
#     cars  | Maruti        | SPRESSO  | 2020
#     cars  | Maruti Suzuki | S-Presso | 2026
#
# Resolution first matched make and model AS STORED, so those were two models
# and a trim ladder entered against one row stayed invisible from the other —
# the reported bug, surviving the fix for it on any model somebody typed
# short. It now matches on model_key, which is what media_library has always
# used to decide whether a photograph belongs to a car.


@pytest.mark.asyncio
async def test_a_short_brand_name_is_the_same_model(client, seed):
    page_row = _car(make="Maruti Suzuki", model="Swift", year=2026)
    sibling = _car(make="Maruti", model="Swift", year=2025)
    await seed(page_row, sibling, _trim(sibling, "VXi", 668000))

    rows = (await client.get(f"/cars/{page_row.id}/variants")).json()

    assert [r["name"] for r in rows] == ["VXi"]


@pytest.mark.asyncio
async def test_punctuation_in_a_model_name_does_not_split_it(client, seed):
    page_row = _car(make="Maruti Suzuki", model="S-Presso", year=2026)
    sibling = _car(make="Maruti", model="SPRESSO", year=2020)
    await seed(page_row, sibling, _trim(sibling, "VXi", 468000))

    rows = (await client.get(f"/cars/{page_row.id}/variants")).json()

    assert [r["name"] for r in rows] == ["VXi"]


@pytest.mark.asyncio
async def test_the_card_agrees_about_a_model_spelled_two_ways(client, seed):
    card_row = _car(make="Maruti Suzuki", model="S-Presso", year=2026)
    sibling = _car(make="MSIL", model="SPRESSO", year=2020)
    await seed(card_row, sibling, _trim(sibling, "VXi", 468000))

    card = await _card_for(client, card_row)

    assert card["variant_count"] == 1


@pytest.mark.asyncio
async def test_the_advisor_treats_two_spellings_as_one_candidate(client, seed):
    # Otherwise the same car takes two of the three shortlist places under two
    # different names, which reads as a site that does not know its own stock.
    formal = _car(make="Maruti Suzuki", model="S-Presso", year=2026,
                  seating_capacity=5)
    short = _car(make="Maruti", model="SPRESSO", year=2020, seating_capacity=5)
    await seed(formal, short,
               _trim(formal, "VXi", 468000), _trim(short, "LXi", 426000))

    body = await _advice(client)
    spressos = [i for i in body["items"] if i["model"].lower().replace("-", "") == "spresso"]

    assert len(spressos) == 1
    assert spressos[0]["car_id"] == str(formal.id)


@pytest.mark.asyncio
async def test_an_unrelated_make_is_still_not_merged_in(client, seed):
    # The alias table maps spellings of ONE manufacturer. Widening the match
    # must not start pooling different ones.
    page_row = _car(make="Maruti Suzuki", model="Swift", year=2026)
    other = _car(make="Hyundai", model="Swift", year=2026)
    await seed(page_row, other, _trim(other, "Borrowed", 668000))

    rows = (await client.get(f"/cars/{page_row.id}/variants")).json()

    assert rows == []


@pytest.mark.asyncio
async def test_two_makes_sharing_a_model_name_stay_apart(client, seed):
    # The bulk sibling lookup narrows on MODEL name alone and re-checks the
    # make in Python. If that re-check went missing, a Ford Figo would borrow
    # the Tata Figo's trims and nothing would look wrong.
    ford = _car(make="Ford", model="Figo", year=2026)
    tata = _car(make="Tata", model="Figo", year=2026)
    await seed(ford, tata, _trim(tata, "XZ", 800000))

    card = await _card_for(client, ford)

    assert card["variant_count"] == 0
