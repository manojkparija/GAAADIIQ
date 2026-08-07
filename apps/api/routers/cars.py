import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_admin_user, get_current_user
from db.session import get_db
from models.car import Car
from models.user import User
from schemas.car import CarCreate, CarListOut, CarOut, CarUpdate
from services import media_library

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

    items = []
    for car in cars:
        out = CarOut.model_validate(car)
        out.image_urls = images.get(car.id, [])
        items.append(out)

    return CarListOut(items=items, total=total, page=page, page_size=page_size)


@router.get("/{car_id}", response_model=CarOut)
async def get_car(car_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Car).where(Car.id == car_id))
    car = result.scalar_one_or_none()
    if not car:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Car not found")

    out = CarOut.model_validate(car)
    images = await media_library.urls_for_cars(db, [car])
    out.image_urls = images.get(car.id, [])
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
    images = await media_library.urls_for_cars(db, [car])
    out.image_urls = images.get(car.id, [])
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
