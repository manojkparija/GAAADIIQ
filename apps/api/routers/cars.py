import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_admin_user, get_current_user
from db.session import get_db
from models.car import Car
from models.car_variant import CarVariant, VariantSource, VariantStatus
from models.user import User
from schemas.car import CarCreate, CarListOut, CarOut, CarUpdate
from services import media_library, variant_research

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
    counts = await _variant_counts(db, [c.id for c in cars])

    items = []
    for car in cars:
        out = CarOut.model_validate(car)
        out.image_urls = images.get(car.id, [])
        out.variant_count = counts.get(car.id, 0)
        items.append(out)

    return CarListOut(items=items, total=total, page=page, page_size=page_size)


async def _variant_counts(db: AsyncSession, car_ids: list[uuid.UUID]) -> dict:
    """
    Published trims per car, in one query rather than one per row.

    Published only: a draft is a figure nobody has read, so counting it would
    promise a buyer a choice that is not on offer.
    """
    if not car_ids:
        return {}
    rows = await db.execute(
        select(CarVariant.car_id, func.count())
        .where(
            CarVariant.car_id.in_(car_ids),
            CarVariant.status == VariantStatus.published,
        )
        .group_by(CarVariant.car_id)
    )
    return dict(rows.all())


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
    out.variant_count = (await _variant_counts(db, [car.id])).get(car.id, 0)
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
        setattr(car, field, value)

    await db.commit()
    await db.refresh(car)

    out = CarOut.model_validate(car)
    # One car, so return its gallery rather than a listing page's sample of it.
    images = await media_library.urls_for_cars(
        db, [car], per_car=media_library.GALLERY_FULL_LIMIT
    )
    out.image_urls = images.get(car.id, [])
    out.variant_count = (await _variant_counts(db, [car.id])).get(car.id, 0)
    return out


@router.post("", response_model=CarOut, status_code=status.HTTP_201_CREATED)
async def create_car(
    payload: CarCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    car = Car(**payload.model_dump())
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
        out.variant_count = (await _variant_counts(db, [car.id])).get(car.id, 0)
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
    out.variant_count = (await _variant_counts(db, [car.id])).get(car.id, 0)
    return out
