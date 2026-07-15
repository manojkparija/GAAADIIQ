import uuid

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.dependencies import get_current_user
from db.session import get_db
from models.car import Car
from models.listing import Listing
from models.price_alert import PriceAlert
from models.user import User
from schemas.listing import ListingCreate, ListingListOut, ListingOut, ListingUpdate
from services import storage, valuation
from services.notifications import notify_price_drop

router = APIRouter(prefix="/listings", tags=["listings"])

# Eagerly load car + seller for each listing
_LOAD = [selectinload(Listing.car), selectinload(Listing.seller)]


@router.post("", response_model=ListingOut, status_code=status.HTTP_201_CREATED)
async def create_listing(
    payload: ListingCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    car = await db.get(Car, payload.car_id)
    if not car:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Car not found")

    listing = Listing(**payload.model_dump(), seller_id=current_user.id, image_urls=[])
    db.add(listing)
    await db.commit()

    result = await db.execute(
        select(Listing).options(*_LOAD).where(Listing.id == listing.id)
    )
    return ListingOut.model_validate(result.scalar_one())


@router.get("", response_model=ListingListOut)
async def list_listings(
    listing_type: str | None = Query(None),
    city: str | None = Query(None),
    make: str | None = Query(None),
    model: str | None = Query(None),
    fuel_type: str | None = Query(None),
    body_type: str | None = Query(None),
    min_price: float | None = Query(None),
    max_price: float | None = Query(None),
    min_year: int | None = Query(None),
    max_year: int | None = Query(None),
    max_km: int | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    q = (
        select(Listing)
        .join(Listing.car)
        .options(*_LOAD)
        .where(Listing.is_active == True)  # noqa: E712
    )

    if listing_type:
        q = q.where(Listing.listing_type == listing_type)
    if city:
        q = q.where(func.lower(Listing.city).contains(city.lower()))
    if make:
        q = q.where(func.lower(Car.make).contains(make.lower()))
    if model:
        q = q.where(func.lower(Car.model).contains(model.lower()))
    if fuel_type:
        q = q.where(Car.fuel_type == fuel_type)
    if body_type:
        q = q.where(Car.body_type == body_type)
    if min_price is not None:
        q = q.where(Listing.price >= min_price)
    if max_price is not None:
        q = q.where(Listing.price <= max_price)
    if min_year is not None:
        q = q.where(Car.year >= min_year)
    if max_year is not None:
        q = q.where(Car.year <= max_year)
    if max_km is not None:
        q = q.where(Listing.km_driven <= max_km)

    # Count using the same filtered query (strip options/order/offset/limit)
    count_q = q.options().order_by(None).offset(0).limit(None)
    total_result = await db.execute(select(func.count()).select_from(count_q.subquery()))
    total = total_result.scalar_one()

    q = q.order_by(Listing.is_featured.desc(), Listing.created_at.desc())
    q = q.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(q)
    listings = result.scalars().all()

    return ListingListOut(
        items=[ListingOut.model_validate(lst) for lst in listings],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/me", response_model=ListingListOut)
async def my_listings(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return only listings owned by the authenticated seller."""
    q = (
        select(Listing)
        .options(*_LOAD)
        .where(Listing.seller_id == current_user.id)
        .order_by(Listing.created_at.desc())
    )
    total_result = await db.execute(select(func.count()).select_from(q.options().order_by(None).subquery()))
    total = total_result.scalar_one()

    result = await db.execute(q.offset((page - 1) * page_size).limit(page_size))
    listings = result.scalars().all()
    return ListingListOut(
        items=[ListingOut.model_validate(lst) for lst in listings],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{listing_id}", response_model=ListingOut)
async def get_listing(listing_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Listing).options(*_LOAD).where(Listing.id == listing_id)
    )
    listing = result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found")

    # Increment view count
    listing.views_count += 1
    await db.commit()
    await db.refresh(listing)

    result = await db.execute(
        select(Listing).options(*_LOAD).where(Listing.id == listing_id)
    )
    return ListingOut.model_validate(result.scalar_one())


@router.patch("/{listing_id}", response_model=ListingOut)
async def update_listing(
    listing_id: uuid.UUID,
    payload: ListingUpdate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Listing).options(*_LOAD).where(Listing.id == listing_id)
    )
    listing = result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found")
    if listing.seller_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your listing")

    old_price = float(listing.price)
    update_data = payload.model_dump(exclude_none=True)
    for field, value in update_data.items():
        setattr(listing, field, value)

    await db.commit()

    # Fire price-drop notifications if price decreased
    new_price = update_data.get("price")
    if new_price is not None and float(new_price) < old_price:
        car = listing.car
        listing_title = f"{car.year} {car.make} {car.model}" if car else "a listing"
        alerts_result = await db.execute(
            select(PriceAlert)
            .where(PriceAlert.listing_id == listing_id)
            .options(selectinload(PriceAlert.user))
        )
        for alert in alerts_result.scalars().all():
            background_tasks.add_task(
                notify_price_drop,
                db,
                alert.user,
                listing_title,
                listing_id,
                old_price,
                float(new_price),
            )

    result = await db.execute(
        select(Listing).options(*_LOAD).where(Listing.id == listing_id)
    )
    return ListingOut.model_validate(result.scalar_one())


@router.delete("/{listing_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_listing(
    listing_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Listing).where(Listing.id == listing_id))
    listing = result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found")
    if listing.seller_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your listing")

    # Soft delete
    listing.is_active = False
    await db.commit()


ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB


@router.post("/{listing_id}/images", response_model=ListingOut)
async def upload_image(
    listing_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Listing).options(*_LOAD).where(Listing.id == listing_id)
    )
    listing = result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found")
    if listing.seller_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your listing")
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported type. Allowed: {', '.join(ALLOWED_IMAGE_TYPES)}",
        )

    contents = await file.read()
    if len(contents) > MAX_IMAGE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image must be under 10 MB",
        )

    import io
    url = storage.upload_image(io.BytesIO(contents), file.content_type)

    listing.image_urls = [*listing.image_urls, url]
    await db.commit()

    result = await db.execute(
        select(Listing).options(*_LOAD).where(Listing.id == listing_id)
    )
    return ListingOut.model_validate(result.scalar_one())


@router.post("/{listing_id}/valuate", response_model=ListingOut)
async def valuate_listing(
    listing_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Run AI valuation on a listing and persist the result."""
    result = await db.execute(
        select(Listing).options(*_LOAD).where(Listing.id == listing_id)
    )
    listing = result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found")

    fair_value, _ = await valuation.estimate_valuation(listing)

    from datetime import datetime, timezone
    listing.ai_valuation = fair_value
    listing.ai_valuation_at = datetime.now(timezone.utc)
    await db.commit()

    result = await db.execute(
        select(Listing).options(*_LOAD).where(Listing.id == listing_id)
    )
    return ListingOut.model_validate(result.scalar_one())


@router.get("/{listing_id}/similar", response_model=list[ListingOut])
async def similar_listings(
    listing_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Return up to 5 active listings with the same body_type and fuel_type."""
    ref_result = await db.execute(
        select(Listing).options(selectinload(Listing.car)).where(Listing.id == listing_id)
    )
    ref = ref_result.scalar_one_or_none()
    if not ref:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found")

    similar_q = (
        select(Listing)
        .join(Car, Listing.car_id == Car.id)
        .options(*_LOAD)
        .where(
            Listing.is_active == True,  # noqa: E712
            Listing.id != listing_id,
            Car.body_type == ref.car.body_type,
            Car.fuel_type == ref.car.fuel_type,
        )
        .order_by(Listing.created_at.desc())
        .limit(5)
    )
    result = await db.execute(similar_q)
    return [ListingOut.model_validate(row) for row in result.scalars().all()]


