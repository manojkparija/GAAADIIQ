from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_current_user
from db.session import get_db
from models.car import Car
from models.user import User
from schemas.car import CarCreate, CarListOut, CarOut
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
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    q = select(Car)
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
async def get_car(car_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Car).where(Car.id == car_id))
    car = result.scalar_one_or_none()
    if not car:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Car not found")

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
