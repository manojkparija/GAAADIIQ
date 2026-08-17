import uuid

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Header,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.dependencies import get_current_user, get_optional_user
from core.limiter import limiter
from db.session import get_db
from models.car import Car
from models.listing import Listing
from models.price_alert import PriceAlert
from models.user import User
from schemas.listing import ListingCreate, ListingListOut, ListingOut, ListingUpdate
from services import media_library, n8n, valuation, vector_store
from services.demand_analytics import record_listing_view, record_search
from services.notifications import notify_price_drop
from services.search_index import search_index

router = APIRouter(prefix="/listings", tags=["listings"])

# Eagerly load car + seller for each listing
_LOAD = [selectinload(Listing.car), selectinload(Listing.seller)]


@router.post("", response_model=ListingOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
async def create_listing(
    request: Request,
    payload: ListingCreate,
    background_tasks: BackgroundTasks,
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
    full_listing = result.scalar_one()
    await search_index.index_listing(full_listing)

    background_tasks.add_task(_index_listing, full_listing)
    background_tasks.add_task(n8n.trigger, n8n.LISTING_CREATED, {
        "listing_id": str(full_listing.id),
        "make": car.make, "model": car.model,
        "price": float(full_listing.price),
        "city": full_listing.city,
        "seller_email": current_user.email,
    })

    return ListingOut.model_validate(full_listing)


async def _index_listing(listing: Listing) -> None:
    payload = {
        "make": listing.car.make if listing.car else "",
        "model": listing.car.model if listing.car else "",
        "year": listing.car.year if listing.car else None,
        "fuel": listing.car.fuel_type.value if listing.car and listing.car.fuel_type else "",
        "body_type": listing.car.body_type.value if listing.car and listing.car.body_type else "",
        "price": float(listing.price),
        "km": listing.km_driven,
        "city": listing.city or "",
        "condition": listing.condition or "",
        "transmission": listing.car.transmission.value if listing.car and listing.car.transmission else "",
    }
    from services.embeddings import embed_one, listing_text
    text = listing_text(payload)
    vector = embed_one(text)
    if vector:
        vector_store.upsert_listing(listing.id, vector, payload)


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
    pincode: str | None = Query(None, max_length=10),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
    x_visitor_key: str | None = Header(default=None, alias="X-Visitor-Key"),
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

    # Record the search, with the number of cars it found.
    #
    # `total` is the reason this is recorded here and not in the frontend: a
    # search that returned *nothing* is the single most useful row in the
    # table — it is unmet demand, and it exists in no other record. The
    # listings table knows what was offered and can never know what was looked
    # for and not found.
    #
    # Only searches that actually asked for something. An unfiltered first page
    # of /used-cars is a page load, not a statement of intent, and counting it
    # would drown the real signal.
    if page == 1 and any([make, model, body_type, fuel_type, city, min_price, max_price]):
        await record_search(
            db,
            user_id=user.id if user else None,
            visitor_key=x_visitor_key or None,
            make=make,
            model=model,
            body_type=body_type,
            fuel_type=fuel_type,
            city=city,
            pincode=pincode,
            price_min=int(min_price) if min_price is not None else None,
            price_max=int(max_price) if max_price is not None else None,
            result_count=total,
        )
        await db.commit()

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
async def get_listing(
    listing_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
    x_visitor_key: str | None = Header(default=None, alias="X-Visitor-Key"),
):
    result = await db.execute(
        select(Listing).options(*_LOAD).where(Listing.id == listing_id)
    )
    listing = result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found")

    # Increment view count
    listing.views_count += 1

    # And record *when*, which the counter above cannot say. Everything on the
    # demand side — activity in the last 24 hours, how long a car has sat, what
    # a returning buyer keeps coming back to — is a question about time, and
    # none of it can be backfilled from a running total after the fact.
    await record_listing_view(db, listing.id, user.id if user else None, x_visitor_key)

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

    # Through the media library rather than straight to the bucket, so the same
    # photograph offered by a brochure and by a dealer resolves to one stored
    # file instead of two. The library returns an existing row when it
    # recognises the picture, exactly or as a re-encoding.
    car = listing.car
    media = await media_library.store_image(
        db,
        contents,
        file.content_type or "image/jpeg",
        key_prefix=f"listings/{listing.id}",
        source_name=file.filename or "listing-upload",
        make=getattr(car, "make", None),
        model=getattr(car, "model", None),
        variant=getattr(car, "variant", None),
        model_year=getattr(car, "model_year", None) or getattr(car, "year", None),
        category=getattr(car, "body_type", None),
    )
    await media_library.attach_to_listing(db, listing.id, media)

    # image_urls stays populated and stays the field the API returns. The link
    # table is now the source of truth, but listings created before it exists
    # still have URLs and nothing else, so reads must keep working for both —
    # a hard cutover would blank the gallery of every existing listing.
    listing.image_urls = await media_library.urls_for_listing(db, listing.id)

    await db.commit()

    result = await db.execute(
        select(Listing).options(*_LOAD).where(Listing.id == listing_id)
    )
    return ListingOut.model_validate(result.scalar_one())


@router.post("/{listing_id}/valuate", response_model=ListingOut)
@limiter.limit("5/minute")
async def valuate_listing(
    request: Request,
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

    fair_value, method, confidence, reasoning = await valuation.estimate_valuation(listing)

    from datetime import datetime, timezone
    listing.ai_valuation = fair_value
    listing.ai_valuation_at = datetime.now(timezone.utc)
    listing.ai_method = method
    listing.ai_confidence = confidence
    listing.ai_reasoning = reasoning
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


