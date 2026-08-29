import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_admin_user, get_current_user
from core.limiter import limiter
from db.session import get_db
from models.car import Car
from models.car_variant import CarVariant, VariantSource, VariantStatus
from models.user import User
from schemas.car import CarCreate, CarListOut, CarOut, CarUpdate, PriceCheckOut
from services import media_library, price_reference, variant_research, vehicle_identity

router = APIRouter(prefix="/cars", tags=["cars"])


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
            "Return only models that carry an ex-showroom price. Customer-"
            "facing catalogue pages set this so unpriced rows never reach a "
            "buyer; admin screens leave it off so the gaps stay visible."
        ),
    ),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    q = select(Car)
    if priced_only:
        q = q.where(Car.ex_showroom_price.is_not(None))
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
    rows = await db.execute(
        select(
            CarVariant.car_id,
            func.count(),
            func.min(CarVariant.ex_showroom_price),
            func.max(CarVariant.ex_showroom_price),
        )
        .where(
            CarVariant.car_id.in_(car_ids),
            CarVariant.status == VariantStatus.published,
        )
        .group_by(CarVariant.car_id)
    )
    return {
        car_id: _VariantSummary(count=count, price_min=lo, price_max=hi)
        for car_id, count, lo, hi in rows.all()
    }


def _apply_variant_summary(out: CarOut, summary: _VariantSummary | None) -> CarOut:
    """Copy a summary onto a response, leaving the defaults when there is none."""
    if summary is None:
        return out
    out.variant_count = summary.count
    out.variant_price_min = summary.price_min
    out.variant_price_max = summary.price_max
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
    q = select(CarVariant).where(CarVariant.car_id == car_id)
    if not include_drafts:
        q = q.where(CarVariant.status == VariantStatus.published)
    q = q.order_by(CarVariant.sort_order, CarVariant.name)
    return [_variant_out(v) for v in (await db.execute(q)).scalars().all()]


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
