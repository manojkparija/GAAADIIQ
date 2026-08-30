"""
Cars that have been announced but are not on sale yet.

The strip on the New Cars page used to be a hardcoded array in the Angular
component, so it could only be corrected by a deploy — and so it was not, and
four of its five entries were on sale while still listed as upcoming.

The public listing answers only with cars that are genuinely still upcoming.
That filter lives here rather than in the browser because it is the same
question for every caller, and a page that has to remember to apply it is a
page that will one day forget.

No `from __future__ import annotations` here: it breaks FastAPI's signature
introspection and body params start being read as query params.
"""
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_admin_user
from db.session import get_db
from models.upcoming_car import UpcomingCar
from models.user import User

router = APIRouter(prefix="/upcoming-cars", tags=["upcoming-cars"])


def _quarter_label(when: date) -> str:
    """
    "Q3 2026" for a date in July–September 2026.

    The industry announces in quarters and buyers read them, so the strip still
    shows one. It is derived rather than stored: a stored string cannot be
    compared with today, which is how a launched car stayed on the strip.
    """
    return f"Q{(when.month - 1) // 3 + 1} {when.year}"


class UpcomingCarOut(BaseModel):
    id: uuid.UUID
    make: str
    model: str
    expected_on: date
    #: Derived from expected_on for display; see _quarter_label.
    expected_quarter: str
    expected_price_min: Decimal | None = None
    expected_price_max: Decimal | None = None
    body_type: str | None = None
    fuel_type: str | None = None
    image_url: str | None = None
    launched_at: datetime | None = None
    is_active: bool = True

    model_config = {"from_attributes": True}


class UpcomingCarCreate(BaseModel):
    make: str
    model: str
    expected_on: date
    expected_price_min: Decimal | None = None
    expected_price_max: Decimal | None = None
    body_type: str | None = None
    fuel_type: str | None = None
    image_url: str | None = None

    @field_validator("make", "model")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("must not be blank")
        return v.strip()


class UpcomingCarUpdate(BaseModel):
    """Every field optional; only what is sent is changed."""

    make: str | None = None
    model: str | None = None
    expected_on: date | None = None
    expected_price_min: Decimal | None = None
    expected_price_max: Decimal | None = None
    body_type: str | None = None
    fuel_type: str | None = None
    image_url: str | None = None
    is_active: bool | None = None
    #: Setting this true stamps launched_at now; false clears it, for a
    #: mistaken retirement.
    launched: bool | None = None


def _out(row: UpcomingCar) -> UpcomingCarOut:
    return UpcomingCarOut(
        id=row.id,
        make=row.make,
        model=row.model,
        expected_on=row.expected_on,
        expected_quarter=_quarter_label(row.expected_on),
        expected_price_min=row.expected_price_min,
        expected_price_max=row.expected_price_max,
        body_type=row.body_type,
        fuel_type=row.fuel_type,
        image_url=row.image_url,
        launched_at=row.launched_at,
        is_active=row.is_active,
    )


@router.get("", response_model=list[UpcomingCarOut])
async def list_upcoming_cars(
    include_past: bool = Query(
        False,
        description=(
            "Admin screens pass true to see everything, including cars that "
            "have launched or whose date has passed. Buyer-facing pages leave "
            "it off."
        ),
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    The cars still to come, soonest first.

    Three things take a car off this list, and all three are checked here so no
    caller has to remember them:

    - it has been marked launched, which is the common case: a car usually
      arrives before the window it was promised in closes;
    - its expected date has passed, so nobody has to retire it by hand;
    - it has been deactivated, for an announcement that came to nothing.
    """
    q = select(UpcomingCar).order_by(UpcomingCar.expected_on.asc(), UpcomingCar.make)
    if not include_past:
        q = q.where(
            UpcomingCar.is_active.is_(True),
            UpcomingCar.launched_at.is_(None),
            UpcomingCar.expected_on >= date.today(),
        )
    rows = (await db.execute(q)).scalars().all()
    return [_out(r) for r in rows]


@router.post("", response_model=UpcomingCarOut, status_code=status.HTTP_201_CREATED)
async def create_upcoming_car(
    payload: UpcomingCarCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    row = UpcomingCar(**payload.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _out(row)


async def _get_or_404(db: AsyncSession, car_id: uuid.UUID) -> UpcomingCar:
    row = (
        await db.execute(select(UpcomingCar).where(UpcomingCar.id == car_id))
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Upcoming car not found"
        )
    return row


@router.patch("/{car_id}", response_model=UpcomingCarOut)
async def update_upcoming_car(
    car_id: uuid.UUID,
    payload: UpcomingCarUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """
    Correct an entry, or retire it the day it goes on sale.

    `launched` is a flag rather than a timestamp the caller supplies: the admin
    is saying "this is on sale now", and letting them type the moment invites a
    date that disagrees with the decision it records.
    """
    row = await _get_or_404(db, car_id)
    data = payload.model_dump(exclude_unset=True)

    launched = data.pop("launched", None)
    if launched is True:
        row.launched_at = datetime.now(timezone.utc)
    elif launched is False:
        row.launched_at = None

    for field, value in data.items():
        setattr(row, field, value)

    await db.commit()
    await db.refresh(row)
    return _out(row)


@router.delete("/{car_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_upcoming_car(
    car_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """
    Remove an entry outright.

    Marking one launched is usually what is wanted — it keeps the record of an
    announcement that was real — so this is for a row that should never have
    existed, such as a duplicate.
    """
    row = await _get_or_404(db, car_id)
    await db.delete(row)
    await db.commit()
