import logging
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_admin_user, get_current_user
from core.limiter import limiter
from db.session import get_db
from models.car import Car
from models.car_variant import CarVariant, VariantSource, VariantStatus
from models.listing import Listing
from models.user import User
from schemas.car import CarCreate, CarListOut, CarOut, CarUpdate, PriceCheckOut
from services import media_library, price_reference, variant_research, vehicle_identity

router = APIRouter(prefix="/cars", tags=["cars"])

logger = logging.getLogger("gaadiiq.cars")


@router.get("", response_model=CarListOut)
async def list_cars(
    make: str | None = Query(None),
    model: str | None = Query(None),
    year: int | None = Query(None),
    fuel_type: str | None = Query(None),
    body_type: str | None = Query(None),
    bucket: str | None = Query(
        None,
        description=(
            "Which catalogue surface is being rendered: 'new' or 'used'. "
            "Filters the images returned; omit for all."
        ),
    ),
    priced_only: bool = Query(
        False,
        description=(
            "Return only models a buyer can be quoted a price for — either the "
            "row's own ex-showroom figure or a published trim that carries "
            "one. Customer-facing catalogue pages set this so a model nobody "
            "has priced at all never reaches a buyer; admin screens leave it "
            "off so the gaps stay visible."
        ),
    ),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    q = select(Car)
    if priced_only:
        # A MODEL IS PRICED IF ANYTHING ABOUT IT CARRIES A PRICE
        #
        # This used to read `Car.ex_showroom_price.is_not(None)` alone, and
        # that one column is not where a model's price lives any more. The
        # trims are: `_variant_summaries` computes the band the published
        # trims span, `startingPrice` and `priceBand` on the web read it in
        # preference to the row, and the row's own figure survives only as the
        # fallback for a model whose trims are unpriced or not entered.
        #
        # So a model could be fully priced — twelve published trims, a real
        # band on its own detail page — and still be withheld from every
        # buyer-facing grid because one legacy column on its catalogue row was
        # blank. Nothing on any screen said why, and an admin filling in trims
        # had no reason to think the model was still invisible.
        #
        # The intent of the flag is unchanged: a model nobody has priced at
        # all stays out of a grid that sorts and filters on price.
        priced_variant = (
            select(CarVariant.id)
            .where(
                CarVariant.car_id == Car.id,
                CarVariant.status == VariantStatus.published,
                CarVariant.ex_showroom_price.is_not(None),
            )
            .exists()
        )
        q = q.where(or_(Car.ex_showroom_price.is_not(None), priced_variant))
    if make:
        q = q.where(func.lower(Car.make).contains(make.lower()))
    if model:
        q = q.where(func.lower(Car.model).contains(model.lower()))
    if year:
        q = q.where(Car.year == year)
    if fuel_type:
        q = q.where(Car.fuel_type == fuel_type)
    if body_type:
        q = q.where(Car.body_type == body_type)

    total_result = await db.execute(select(func.count()).select_from(q.subquery()))
    total = total_result.scalar_one()

    # Without an explicit order Postgres may return rows in any order, which
    # lets the same row appear on two pages and another on none. Make, model
    # and year are what a reader is scanning by, and id breaks ties so the
    # order is total.
    q = q.order_by(Car.make, Car.model, Car.year, Car.id)
    q = q.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(q)
    cars = result.scalars().all()

    # One query for the page's images rather than one per car.
    images = await media_library.urls_for_cars(db, cars, bucket=bucket)
    summaries = await _variant_summaries(db, [c.id for c in cars])

    items = []
    for car in cars:
        out = CarOut.model_validate(car)
        out.image_urls = images.get(car.id, [])
        _apply_variant_summary(out, summaries.get(car.id))
        items.append(out)

    return CarListOut(items=items, total=total, page=page, page_size=page_size)


class _VariantSummary(BaseModel):
    """What the published trims of one car add up to."""

    count: int = 0
    price_min: Decimal | None = None
    price_max: Decimal | None = None
    #: The gearboxes and fuels the trims are actually sold with.
    #:
    #: A catalogue row carries one transmission and one fuel, but a model is
    #: sold with several — an S-Presso is listed as Manual while also having an
    #: automatic trim. The New Cars grid filtered on the row's single value, so
    #: ticking Automatic hid a model that does offer one.
    transmissions: list[str] = []
    fuels: list[str] = []


async def _variant_summaries(
    db: AsyncSession, car_ids: list[uuid.UUID]
) -> dict[uuid.UUID, _VariantSummary]:
    """
    Published trims per car — how many, and the price band they span — in one
    query rather than one per row.

    Published only: a draft is a figure nobody has read, so counting it would
    promise a buyer a choice that is not on offer.

    THE BAND IS HERE BECAUSE A LISTING CARD CANNOT COMPUTE IT.

    A card renders one row of the catalogue and never fetches that row's trims,
    so the only price in reach was `cars.ex_showroom_price` — a single figure
    maintained by hand, quite separately from the trims. The two drifted, and
    the same Fronx read "₹9.30L onwards" on the listing card and "₹6.84 - 11.98
    Lakh" on its own detail page, which reads the trims. A buyer comparing
    those two screens sees the site contradict itself on the number they care
    about most.

    min() and max() ignore NULL in SQL, so an unpriced trim neither drags the
    band to zero nor discards the band entirely — it simply does not vote.
    A car whose trims are all unpriced yields NULLs, and the caller falls back
    to the catalogue figure.
    """
    if not car_ids:
        return {}

    # WHICH ROWS COUNT AS THIS CAR
    #
    # The card used to count the trims hanging off this row's id alone. The
    # detail page stopped doing that (see _same_model_car_ids): a model's trim
    # ladder belongs to the MODEL, and the catalogue holds more than one row
    # per model. Leaving the card on the narrow lookup is how the Swift's card
    # advertised a band the page it opens disagrees with — the two screens
    # reading two rows, both of them right.
    #
    # So the same resolution runs here, in bulk. Aggregating in Python rather
    # than in SQL because the dedupe below cannot be spelled as a GROUP BY: it
    # needs to know which sibling shares the requested car's model year.
    siblings = await _sibling_ids_for_cars(db, car_ids)
    every_id = {i for ids, _ in siblings.values() for i in ids}

    rows = (
        await db.execute(
            select(CarVariant)
            .where(
                CarVariant.car_id.in_(every_id),
                CarVariant.status == VariantStatus.published,
            )
            .order_by(CarVariant.ex_showroom_price, CarVariant.sort_order)
        )
    ).scalars().all()

    by_car: dict[uuid.UUID, list[CarVariant]] = {}
    for v in rows:
        by_car.setdefault(v.car_id, []).append(v)

    summaries: dict[uuid.UUID, _VariantSummary] = {}
    for car_id in car_ids:
        sibling_ids, same_year = siblings.get(car_id, ([car_id], set()))
        mine: list[CarVariant] = []
        for sid in sibling_ids:
            mine.extend(by_car.get(sid, []))
        if not mine:
            continue
        # One row per trim name, the buyer's own model year winning the tie —
        # exactly what the detail page shows, so the two cannot disagree.
        mine = _dedupe_trims(mine, same_year)

        prices = [v.ex_showroom_price for v in mine if v.ex_showroom_price is not None]
        summary = _VariantSummary(
            count=len(mine),
            # An unpriced trim does not vote, the way min()/max() ignored NULL
            # when this was SQL. A model whose trims are all unpriced yields
            # None and the caller falls back to the catalogue figure.
            price_min=min(prices) if prices else None,
            price_max=max(prices) if prices else None,
        )
        for v in mine:
            if v.transmission and v.transmission.strip() not in summary.transmissions:
                summary.transmissions.append(v.transmission.strip())
            if v.fuel_type and v.fuel_type.strip() not in summary.fuels:
                summary.fuels.append(v.fuel_type.strip())
        summaries[car_id] = summary

    return summaries


def _apply_variant_summary(out: CarOut, summary: _VariantSummary | None) -> CarOut:
    """Copy a summary onto a response, leaving the defaults when there is none."""
    if summary is None:
        return out
    out.variant_count = summary.count
    out.variant_price_min = summary.price_min
    out.variant_price_max = summary.price_max
    out.variant_transmissions = summary.transmissions
    out.variant_fuels = summary.fuels
    return out


class CatalogueOption(BaseModel):
    """One vehicle identity the catalogue already knows."""

    make: str
    model: str
    variant: str | None = None
    year: int
    # New Cars shows only priced models, so a caller deciding whether to ask an
    # admin for a price needs to know whether this entry already has one.
    # "Known to the catalogue" and "will actually appear" are not the same
    # thing, and treating them as one leaves uploads stored but invisible.
    ex_showroom_price: float | None = None


class CatalogueOptions(BaseModel):
    items: list[CatalogueOption]


# Declared before /{car_id}: that route parses its path segment as a UUID, so
# "options" would be rejected as malformed rather than reaching this.
@router.get("/catalogue/options", response_model=CatalogueOptions)
async def catalogue_options(db: AsyncSession = Depends(get_db)):
    """
    Every make, model, variant and year the catalogue already holds.

    The admin upload screen types these four fields by hand, which is how the
    catalogue ends up holding "Maruti" and "Maruti Suzuki" as different
    manufacturers, and how a photograph misses the model it belongs to by a
    stray space. Offering what already exists makes the common case a choice
    rather than a spelling.

    Flat rather than nested: the caller cascades one list four ways, and a
    nested shape would have to be rebuilt into that anyway.

    Deliberately unauthenticated in the same way the catalogue itself is — it
    exposes nothing a buyer cannot already read from /cars.
    """
    result = await db.execute(
        select(
            Car.make,
            Car.model,
            Car.variant,
            Car.year,
            # The cheapest priced row wins: a model is priced if anything under
            # that identity carries a price, and max() would report NULL as a
            # price on Postgres only by accident of ordering.
            func.min(Car.ex_showroom_price),
        )
        .where(Car.make.is_not(None), Car.model.is_not(None))
        .group_by(Car.make, Car.model, Car.variant, Car.year)
        .order_by(Car.make, Car.model, Car.variant, Car.year)
    )
    return CatalogueOptions(
        items=[
            CatalogueOption(
                make=make, model=model, variant=variant, year=year,
                ex_showroom_price=float(price) if price is not None else None,
            )
            for make, model, variant, year, price in result.all()
        ]
    )


class CatalogueResolved(BaseModel):
    """The catalogue row an upload of this vehicle would attach to."""

    car_id: uuid.UUID | None = None


@router.get("/catalogue/resolve", response_model=CatalogueResolved)
async def resolve_catalogue_car(
    make: str,
    model: str,
    year: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Which catalogue row a photograph of this vehicle belongs to, if any.

    The upload screen prices a model's trims *before* committing the images,
    and trim research is addressed by car id — so the screen needs the id of
    the row the upload is going to land on, before the upload has run.

    The ordering here is deliberately identical to _ensure_catalogue_car in
    routers/media_admin.py: match on make, model and year, dropping the
    variant, and prefer the row that has no variant. If the two ever disagree
    the admin would price one row and the photographs would attach to another,
    which is the failure this is most worth guarding against — hence the note
    on both sides.

    Returns null rather than 404 when the catalogue has never heard of the
    vehicle: that is an ordinary answer here (a new launch), not an error, and
    a 404 would make the caller treat a normal case as a failure.

    Unauthenticated for the same reason as catalogue/options: it exposes
    nothing a buyer cannot already read from /cars.
    """
    row = await db.execute(
        select(Car.id).where(
            func.lower(func.trim(Car.make)) == make.strip().lower(),
            func.lower(func.trim(Car.model)) == model.strip().lower(),
            Car.year == year,
        ).order_by(Car.variant.is_(None).desc(), Car.created_at).limit(1)
    )
    return CatalogueResolved(car_id=row.scalar_one_or_none())


class TrimDraft(BaseModel):
    """A researched trim that has not been written to the database."""

    name: str
    ex_showroom_price: Decimal | None = None
    fuel_type: str | None = None
    transmission: str | None = None
    engine_cc: int | None = None
    seating_capacity: int | None = None
    mileage: str | None = None
    features: list[str] = []


@router.post("/catalogue/research-trims", response_model=list[TrimDraft])
@limiter.limit("10/minute")
async def research_trims_by_identity(
    request: Request,
    make: str,
    model: str,
    year: int,
    _: User = Depends(get_admin_user),
):
    """
    Draft a model's trims without writing anything.

    The sibling endpoint, /{car_id}/variants/research, needs a catalogue row to
    attach its drafts to. The upload screen prices trims *before* committing
    the images, and the vehicle being photographed may have no row at all — a
    model year the catalogue has not reached, or a launch it has never seen.
    That is the case where researched prices are most useful, and the one the
    car-id route cannot serve.

    So this returns the drafts and stores nothing. The caller shows them, the
    admin corrects them, and they are created against the row once the upload
    has made one.

    Rate limited harder than the rest: every call is a language-model request,
    and this one is reachable before anything has been uploaded, so there is no
    natural ceiling on how often a screen could ask.
    """
    drafts = await variant_research.research_variants(make, model, year)
    return [TrimDraft(**d) for d in drafts]


@router.get("/{car_id}", response_model=CarOut)
async def get_car(car_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Car).where(Car.id == car_id))
    car = result.scalar_one_or_none()
    if not car:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Car not found")

    out = CarOut.model_validate(car)
    # One car, so return its gallery rather than a listing page's sample of it.
    images = await media_library.urls_for_cars(
        db, [car], per_car=media_library.GALLERY_FULL_LIMIT
    )
    out.image_urls = images.get(car.id, [])
    out.spin_urls = await media_library.spin_urls_for_car(db, car)
    _apply_variant_summary(out, (await _variant_summaries(db, [car.id])).get(car.id))
    return out


@router.patch("/{car_id}", response_model=CarOut)
async def update_car(
    car_id: uuid.UUID,
    payload: CarUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """
    Update a catalogue car — in practice, put a price on a model so it can
    appear on the New Cars pages.

    Admin-only: this edits what every buyer sees for a model, not one seller's
    own advert.
    """
    result = await db.execute(select(Car).where(Car.id == car_id))
    car = result.scalar_one_or_none()
    if not car:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Car not found")

    # exclude_unset, so omitting a field leaves it alone while sending null
    # clears it. Reading the values instead would make the two cases
    # indistinguishable and a price impossible to remove once set.
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "make":
            value = vehicle_identity.canonical_make(value) or value
        elif field == "model":
            value = vehicle_identity.canonical_model(value) or value
        setattr(car, field, value)

    await db.commit()
    await db.refresh(car)

    out = CarOut.model_validate(car)
    # One car, so return its gallery rather than a listing page's sample of it.
    images = await media_library.urls_for_cars(
        db, [car], per_car=media_library.GALLERY_FULL_LIMIT
    )
    out.image_urls = images.get(car.id, [])
    _apply_variant_summary(out, (await _variant_summaries(db, [car.id])).get(car.id))
    return out


@router.get("/{car_id}/price-check", response_model=PriceCheckOut)
async def price_check(
    car_id: uuid.UUID,
    price: Decimal = Query(..., ge=0, description="The price about to be published"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """
    Compare a price against the reference someone recorded for this model.

    Asked for in UAT: flag an entered price that differs significantly from
    the market. The reference is not fetched or estimated here — it is what a
    person entered, with the source and the date they checked. A figure this
    service invented would be indistinguishable from a verified one at the
    point it is read, which is the reason credit_bureau.fetch_score raises
    rather than returning something plausible.

    A model with no reference returns has_reference=false and says so, rather
    than an empty response the caller would read as approval.
    """
    result = await db.execute(select(Car).where(Car.id == car_id))
    car = result.scalar_one_or_none()
    if not car:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Car not found")

    check = price_reference.check_price(
        price,
        reference=car.reference_price,
        source=car.reference_price_source,
        checked_on=car.reference_price_checked_on,
    )
    return PriceCheckOut(
        has_reference=check.has_reference,
        is_significant=check.is_significant,
        difference=float(check.difference) if check.difference is not None else None,
        reference_age_days=check.reference_age_days,
        is_stale=check.is_stale,
        message=check.message,
    )


@router.post("", response_model=CarOut, status_code=status.HTTP_201_CREATED)
async def create_car(
    payload: CarCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    # One spelling per manufacturer, decided in one place. Images resolve onto
    # a car by make + model + year exactly, so a second spelling of a brand
    # creates a second car that none of the first one's photographs can reach.
    fields = payload.model_dump()
    fields["make"] = vehicle_identity.canonical_make(fields.get("make")) or fields.get("make")
    fields["model"] = vehicle_identity.canonical_model(fields.get("model")) or fields.get("model")

    car = Car(**fields)
    db.add(car)
    await db.commit()
    await db.refresh(car)
    return CarOut.model_validate(car)


# ── Variants ────────────────────────────────────────────────────────────────
#
# A catalogue row stands for a model; a variant is a trim of it. What a buyer
# asks after choosing a model is which trim to buy, and that is entirely about
# what each costs and what each gives you.


class VariantIn(BaseModel):
    name: str
    ex_showroom_price: Decimal | None = None
    fuel_type: str | None = None
    transmission: str | None = None
    engine_cc: int | None = None
    seating_capacity: int | None = None
    mileage: str | None = None
    features: list[str] | None = None
    sort_order: int | None = None


class VariantPatch(BaseModel):
    """Every field optional: omitting one leaves it, sending null clears it."""

    name: str | None = None
    ex_showroom_price: Decimal | None = None
    fuel_type: str | None = None
    transmission: str | None = None
    engine_cc: int | None = None
    seating_capacity: int | None = None
    mileage: str | None = None
    features: list[str] | None = None
    sort_order: int | None = None
    status: VariantStatus | None = None


class VariantOut(BaseModel):
    id: uuid.UUID
    car_id: uuid.UUID
    name: str
    ex_showroom_price: Decimal | None = None
    fuel_type: str | None = None
    transmission: str | None = None
    engine_cc: int | None = None
    seating_capacity: int | None = None
    mileage: str | None = None
    # Nullable in the row, always a list here: a caller rendering a bullet list
    # should not have to distinguish "no features recorded" from "none".
    features: list[str] | None = None
    status: VariantStatus
    source: VariantSource
    sort_order: int

    model_config = {"from_attributes": True}


def _variant_out(v: CarVariant) -> VariantOut:
    out = VariantOut.model_validate(v)
    out.features = list(v.features or [])
    return out


async def _get_car_or_404(db: AsyncSession, car_id: uuid.UUID) -> Car:
    car = (await db.execute(select(Car).where(Car.id == car_id))).scalar_one_or_none()
    if not car:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Car not found")
    return car


def _dedupe_trims(
    variants: "list[CarVariant]", same_year: "set[uuid.UUID]"
) -> "list[CarVariant]":
    """
    One row per trim name, preferring the model year the buyer is looking at.

    Widening the lookup across catalogue rows means a model present in two
    model years can offer "VXi" twice, at two prices. Both are true and the
    buyer cannot tell them apart, which is worse than either alone.

    The car's own year wins where it has that trim. Everything else keeps the
    order it arrived in, which is the price ladder the query built.
    """
    best: dict[str, CarVariant] = {}
    for v in variants:
        key = (v.name or "").strip().lower()
        held = best.get(key)
        if held is None:
            best[key] = v
        elif v.car_id in same_year and held.car_id not in same_year:
            best[key] = v
    # dict preserves insertion order, so the ladder survives the dedupe.
    return list(best.values())


async def _same_model_car_ids(
    db: AsyncSession, car_id: uuid.UUID
) -> "tuple[list[uuid.UUID], set[uuid.UUID]]":
    """
    Every catalogue row describing the same model as this one.

    Matched on vehicle_identity.model_key — the make through the alias table,
    the model squashed — which is the comparison media_library has always made
    when it decides which car a photograph belongs to. Year is deliberately
    NOT part of it: a 2025 row and a 2026
    row are the same trim ladder to a buyer, and requiring the year is what
    leaves a model year with no trims showing an empty tab.

    Returns the ids, and which of them share the requested car's year — the
    second is what _dedupe_trims prefers when two model years offer the same
    trim name.

    Returns [car_id] alone when the car is unknown, so a bad id yields nothing
    rather than every trim in the catalogue.
    """
    resolved = await _sibling_ids_for_cars(db, [car_id])
    return resolved.get(car_id, ([car_id], set()))


async def _sibling_ids_for_cars(
    db: AsyncSession, car_ids: "list[uuid.UUID]"
) -> "dict[uuid.UUID, tuple[list[uuid.UUID], set[uuid.UUID]]]":
    """
    _same_model_car_ids for a whole page, in two queries rather than 2N.

    The New Cars grid resolves a page of cars at once, and asking per car would
    turn one round trip into forty. Same rule, same match: model_key, with year
    deliberately not part of it.

    WHY THE SECOND QUERY DOES NOT FILTER

    It reads every catalogue row's identity columns and groups them here. An
    earlier version narrowed on `lower(trim(model)) IN (...)`, which is a
    filter model_key does not agree with: "S-Presso" and "SPRESSO" are one
    model and that WHERE clause returns one of them, so the row holding the
    trims never reaches the grouping and the tab is empty again — the bug this
    resolution exists to fix, reintroduced in the optimisation for it.

    Squashing in SQL is not portable enough to push down: there is no shared
    spelling for "strip every character that is not a letter or digit", and
    these tests run on SQLite and Postgres both.

    So this is a scan of four narrow columns, once per request rather than once
    per car. The catalogue is a list of models a person maintains by hand, and
    the sell form no longer adds a row per advert, so it stays in the
    thousands. If it ever does not, the fix is a stored canonical key with an
    index on it — not a filter that quietly disagrees with the comparison.
    """
    if not car_ids:
        return {}

    wanted = (
        await db.execute(
            select(Car.id, Car.make, Car.model, Car.year).where(Car.id.in_(car_ids))
        )
    ).all()

    keys = {r[0]: vehicle_identity.model_key(r[1], r[2]) for r in wanted}
    years = {r[0]: r[3] for r in wanted}
    if not keys:
        return {}

    family = (await db.execute(select(Car.id, Car.make, Car.model, Car.year))).all()

    grouped: dict[tuple[str, str], list[tuple[uuid.UUID, int | None]]] = {}
    for row_id, make, model, year in family:
        grouped.setdefault(vehicle_identity.model_key(make, model), []).append(
            (row_id, year)
        )

    out: dict[uuid.UUID, tuple[list[uuid.UUID], set[uuid.UUID]]] = {}
    for car_id in car_ids:
        members = grouped.get(keys.get(car_id, ("", "")), [])
        ids = [m[0] for m in members] or [car_id]
        same_year = {m[0] for m in members if m[1] == years.get(car_id)}
        out[car_id] = (ids, same_year)
    return out


@router.get("/{car_id}/variants", response_model=list[VariantOut])
async def list_variants(
    car_id: uuid.UUID,
    include_drafts: bool = Query(
        False,
        description=(
            "Include trims awaiting review. Admin screens set this; buyer-"
            "facing pages must not, because a draft is a figure nobody has "
            "checked."
        ),
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    The trims a buyer can choose from for this car.

    WHY THIS IS NOT SIMPLY `WHERE car_id = :id`

    REPORTED: the Swift's page showed no trims at all, while Admin -> Variants
    showed thirteen of them, published and "visible to buyers". Both screens
    were right. They were looking at different `cars` rows.

    The catalogue holds more than one row per model, by design and by
    accident. The image upload path creates a row per make+model+YEAR
    (media_admin._ensure_catalogue_car), the sell form creates one per
    submission, and a model sold across two model years is two rows. Trims get
    attached to whichever row the admin screen had open; the buyer page asks
    about whichever row Browse resolved to. Nothing links them.

    But a trim ladder is a property of the MODEL. "Which versions of the Swift
    can I buy" has one answer, and which catalogue row the buyer happened to
    land on is not part of the question. So the published view resolves by
    make and model, the way media_library already resolves photographs, rather
    than by the row id.

    The admin view does NOT widen: include_drafts is the admin screen, and it
    is editing one row's trims. Showing it a neighbouring row's would mean an
    Edit button that silently writes somewhere else.

    Same-year trims win where both exist, because that is the more specific
    answer; a model year with none falls back to the ladder that does exist,
    which is far better than the empty tab this was reported for.
    """
    if include_drafts:
        q = select(CarVariant).where(CarVariant.car_id == car_id)
    else:
        sibling_ids, same_year = await _same_model_car_ids(db, car_id)
        q = select(CarVariant).where(
            CarVariant.car_id.in_(sibling_ids),
            CarVariant.status == VariantStatus.published,
        )
    # Cheapest trim first, which is the order a buyer reads a trim ladder in.
    # sort_order is whatever the row happened to be inserted with — the
    # research importer numbers them in the order it found them — so the Fronx
    # listed 7.75, 6.84, 7.75, 8.25 … and the entry-level Sigma sat third.
    # A trim with no price yet has no place on that ladder and goes last, then
    # sort_order and name keep the result stable.
    q = q.order_by(
        CarVariant.ex_showroom_price.asc().nulls_last(),
        CarVariant.sort_order,
        CarVariant.name,
    )
    rows = list((await db.execute(q)).scalars().all())
    if not include_drafts:
        rows = _dedupe_trims(rows, same_year)
    return [_variant_out(v) for v in rows]


@router.post(
    "/{car_id}/variants",
    response_model=VariantOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_variant(
    car_id: uuid.UUID,
    payload: VariantIn,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """
    Add a trim by hand.

    Published immediately, unlike a researched one: an admin typing a price has
    already done the checking that review exists to force.
    """
    await _get_car_or_404(db, car_id)

    data = payload.model_dump(exclude_unset=True)
    sort_order = data.pop("sort_order", None)
    variant = CarVariant(
        car_id=car_id,
        **data,
        status=VariantStatus.published,
        source=VariantSource.manual,
        sort_order=sort_order if sort_order is not None else 0,
    )
    db.add(variant)
    await db.commit()
    await db.refresh(variant)
    return _variant_out(variant)


@router.patch("/{car_id}/variants/{variant_id}", response_model=VariantOut)
async def update_variant(
    car_id: uuid.UUID,
    variant_id: uuid.UUID,
    payload: VariantPatch,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """
    Correct a trim, or publish one.

    This is what makes researched figures safe to keep at all: anything the
    model got wrong is fixable in place, and setting status to published is the
    act of vouching for it.
    """
    variant = (await db.execute(
        select(CarVariant).where(
            CarVariant.id == variant_id, CarVariant.car_id == car_id
        )
    )).scalar_one_or_none()
    if not variant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Variant not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(variant, field, value)

    await db.commit()
    await db.refresh(variant)
    return _variant_out(variant)


@router.delete("/{car_id}/variants/{variant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_variant(
    car_id: uuid.UUID,
    variant_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """
    Drop a trim.

    Hard, unlike an image: a variant is a short row an admin typed or a model
    drafted, carrying no audit history and no stored file, and a discontinued
    trim is simply not a fact about the car any more.
    """
    variant = (await db.execute(
        select(CarVariant).where(
            CarVariant.id == variant_id, CarVariant.car_id == car_id
        )
    )).scalar_one_or_none()
    if not variant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Variant not found")

    await db.delete(variant)
    await db.commit()


@router.delete("/{car_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_car(
    car_id: uuid.UUID,
    acknowledge_withdrawn: bool = Query(
        False,
        description=(
            "Proceed even though withdrawn adverts reference this row, "
            "deleting them with it. The first call refuses and reports how "
            "many there are, so this is never the default answer to a 409."
        ),
    ),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """
    Remove a catalogue row that should never have existed.

    The upload flow creates a catalogue row from whatever make/model it is
    given, so a trim name typed into the model box becomes its own car: a
    "Sigma" sitting in New Cars beside the Fronx it is a trim of. Nothing could
    remove it — this router could create a car, edit one and delete a *variant*,
    but never delete the car — so a mistake made in one click was permanent and
    visible to buyers.

    Refused while any seller has a LIVE advert against it. `listings.car_id` has
    no ON DELETE, so the database would refuse anyway, but with an integrity
    error rather than a sentence: an admin tidying the catalogue must not be
    able to destroy somebody's advert, and must be told that is why.

    A WITHDRAWN ADVERT USED TO BLOCK IT FOREVER

    This counted every listing, active or not. But taking an advert down is a
    SOFT delete — DELETE /listings/{id} sets is_active = false and keeps the
    row, deliberately, so the seller keeps their history. So a seller who had
    already withdrawn their car left a row here that nothing could clear, and
    this endpoint answered "remove those listings first" when removing one was
    not a thing the product could do. Reported from production: a row deleted
    from the front end, still in the catalogue, with a 409 nobody could act on.

    Withdrawn adverts therefore no longer block — but they are not ignored
    either. The first call still refuses, naming how many there are, and only a
    second call carrying acknowledge_withdrawn deletes them along with the car.
    The refusal is the confirmation step: this destroys rows, and an admin
    should see the number before it happens rather than after.

    Live adverts are never overridable. acknowledge_withdrawn does not apply to
    them and does not mention them.

    Trims go with it (`Car.variants` cascades) because a trim has no meaning
    without its model. Leads, insurance quotes and loan applications hold
    ON DELETE SET NULL and survive — a loan application carries its own
    vehicle description, and losing an applicant's record to a catalogue
    correction would be much worse than the wrong row.

    Photographs are not touched. The media library keys on make/model/year
    rather than a car id, so they stay uploaded and simply stop resolving —
    recoverable, which deleting them would not be.
    """
    car = await _get_car_or_404(db, car_id)

    live = (await db.execute(
        select(func.count()).select_from(Listing).where(
            Listing.car_id == car_id,
            Listing.is_active.is_(True),
        )
    )).scalar_one()
    if live:
        # Logged because the access log alone cannot answer the question this
        # refusal raises. Chasing a 409 in production meant asking somebody to
        # read a sentence off their screen, because "DELETE /cars/... 409" is
        # the same line whether the advert is live (final) or withdrawn (a
        # confirmation away from succeeding). Those need different actions.
        logger.info("delete_car refused: car=%s blocker=live count=%s", car_id, live)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            # A dict, not a sentence. The screen has to tell these two 409s
            # apart — one is final, the other is a confirmation — and matching
            # on the wording would break the moment somebody edits it.
            detail={
                "blocker": "live",
                "count": live,
                "message": (
                    f"{live} live advert(s) point at this car. Ask the seller "
                    "to take them down first — deleting this row would destroy "
                    "a seller's advert."
                ),
            },
        )

    withdrawn = list((await db.execute(
        select(Listing).where(
            Listing.car_id == car_id,
            Listing.is_active.is_(False),
        )
    )).scalars().all())
    if withdrawn and not acknowledge_withdrawn:
        logger.info(
            "delete_car refused: car=%s blocker=withdrawn count=%s "
            "(retry with acknowledge_withdrawn=true)",
            car_id, len(withdrawn),
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "blocker": "withdrawn",
                "count": len(withdrawn),
                "message": (
                    f"{len(withdrawn)} withdrawn advert(s) reference this car. "
                    "They are already off the site, and deleting this row "
                    "deletes them too. Confirm to go ahead."
                ),
            },
        )

    # Explicit rather than a cascade on the relationship: a cascade would also
    # fire on a live advert the moment that check above is ever loosened, and
    # this is the one delete in the file that destroys somebody else's record.
    for listing in withdrawn:
        await db.delete(listing)

    await db.delete(car)
    await db.commit()
    logger.info(
        "delete_car: removed car=%s %s %s %s with %s withdrawn advert(s)",
        car_id, car.make, car.model, car.year, len(withdrawn),
    )


class ResearchAvailability(BaseModel):
    """Whether the AI drafting shortcut can run at all."""

    available: bool
    #: Why not, in words for the admin who pressed the button. None when it is
    #: available.
    reason: str | None = None


@router.get("/variants/research-availability", response_model=ResearchAvailability)
async def variants_research_availability(
    _: User = Depends(get_admin_user),
) -> ResearchAvailability:
    """
    Can AI drafting run here?

    Asked separately, and deliberately so. The research endpoint answers 200
    with an empty list when drafting is switched off, because a shortcut that
    cannot run must leave the manual form working rather than replace it with
    an error — see TestResearchSuite::test_research_being_unavailable_is_not_an_error,
    which exists to hold that decision in place.

    The cost of that is an empty list meaning two different things, and the
    screen reporting both as "Nothing new found. Trims already recorded are
    left alone." — which tells an admin the car has no other trims when in
    fact nobody asked. This lets the screen tell those apart without the
    research endpoint changing what it returns to anyone.

    Declared before /{car_id}/... so "variants" is not read as a car id.
    """
    if variant_research.available():
        return ResearchAvailability(available=True)
    return ResearchAvailability(
        available=False,
        reason=(
            "AI drafting is switched off: no GEMINI_API_KEY is configured for "
            "this deployment. Trims and specifications can still be entered by hand."
        ),
    )


@router.post("/{car_id}/variants/research", response_model=list[VariantOut])
async def research_car_variants(
    car_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """
    Draft this model's trims with a language model.

    Everything it returns lands as a draft. A language model states a plausible
    price with complete confidence, and these are figures a buyer budgets
    against, so a person reads them before a buyer does.

    Trims already recorded are left exactly as they are — a published price an
    admin vouched for must not be overwritten by a guess — so this fills gaps
    rather than replacing work.
    """
    car = await _get_car_or_404(db, car_id)

    drafts = await variant_research.research_variants(car.make, car.model, car.year)

    existing = {
        v.name.strip().lower()
        for v in (await db.execute(
            select(CarVariant).where(CarVariant.car_id == car_id)
        )).scalars().all()
    }

    created: list[CarVariant] = []
    for order, draft in enumerate(drafts):
        if draft["name"].strip().lower() in existing:
            continue
        variant = CarVariant(
            car_id=car_id,
            status=VariantStatus.draft,
            source=VariantSource.ai,
            sort_order=order,
            **draft,
        )
        db.add(variant)
        created.append(variant)

    await db.commit()
    for variant in created:
        await db.refresh(variant)
    return [_variant_out(v) for v in created]


@router.post("/{car_id}/research-details", response_model=CarOut)
async def research_car_details(
    car_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """
    Draft a model's specification and feature list with a language model.

    Unlike trims, these are written straight onto the car: a specification is
    descriptive rather than a figure a buyer budgets against, so a wrong line
    misinforms without costing anyone money, and the admin screen shows the
    result immediately for correction.

    Existing values are left alone. Research fills a gap; it does not overwrite
    what somebody has already curated.
    """
    car = await _get_car_or_404(db, car_id)

    if car.specs and car.features:
        out = CarOut.model_validate(car)
        _apply_variant_summary(out, (await _variant_summaries(db, [car.id])).get(car.id))
        return out

    details = await variant_research.research_model_details(
        car.make, car.model, car.year
    )
    if details["specs"] and not car.specs:
        car.specs = details["specs"]
    if details["features"] and not car.features:
        car.features = details["features"]
    await db.commit()
    await db.refresh(car)

    out = CarOut.model_validate(car)
    _apply_variant_summary(out, (await _variant_summaries(db, [car.id])).get(car.id))
    return out
