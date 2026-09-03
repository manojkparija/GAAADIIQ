"""Mechanic registry — registration, admin verification, and public discovery.

Registration is open (a mechanic signing up does not yet have an account), but it
only ever produces a `pending_verification` row. Nothing here can make a mechanic
matchable; that requires `PATCH /mechanics/{id}/verify` from an admin.
"""

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.dependencies import get_admin_user, get_current_user, get_optional_user
from core.limiter import limiter
from db.session import get_db
from models.mechanic import Mechanic, MechanicStatus
from models.user import User, UserRole
from schemas.mechanic import (
    MechanicAvailabilityRequest,
    MechanicOut,
    MechanicPublicOut,
    MechanicRegisterRequest,
    MechanicVerifyRequest,
)
from services import kyc
from services.geo import find_nearest_mechanics

router = APIRouter(prefix="/mechanics", tags=["mechanics"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]
AdminUser = Annotated[User, Depends(get_admin_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]


def _to_out(m: Mechanic) -> MechanicOut:
    return MechanicOut(
        id=m.id,
        full_name=m.full_name,
        shop_name=m.shop_name,
        phone=m.phone,
        whatsapp_phone=m.whatsapp_phone,
        email=m.email,
        address_line1=m.address_line1,
        address_line2=m.address_line2,
        city=m.city,
        state=m.state,
        area_pincode=m.area_pincode,
        latitude=m.latitude,
        longitude=m.longitude,
        service_radius_km=m.service_radius_km,
        # Masked, like every other PAN this API emits. It was the stored number
        # in full, to the mechanic and to every admin, including the listing
        # endpoint that returns up to 200 of them in one response.
        #
        # Three things already said it should be masked and none of them was
        # checked against this line: the rule in CLAUDE.md ("PAN is stored — but
        # never returned"), loan_applications.py, which emits pan_masked, and
        # this file's own schema docstring, which claims no response model here
        # can emit a PAN. The frontend agreed too — admin-mechanics' test
        # fixture is the literal string "ABCDE****F".
        pan_number=kyc.mask_pan(m.pan_number),
        aadhaar_masked=kyc.mask_aadhaar(m.aadhaar_last4),
        upi_vpa=m.upi_vpa,
        specialisations=m.specialisations,
        status=m.status,
        is_available=m.is_available,
        rating=float(m.rating) if m.rating is not None else None,
        jobs_completed=m.jobs_completed,
        created_at=m.created_at,
    )


@router.post("", response_model=MechanicOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def register_mechanic(
    request: Request,
    payload: MechanicRegisterRequest,
    db: DbDep,
    current_user: OptionalUser,
) -> MechanicOut:
    """Register a mechanic. PAN and Aadhaar are both mandatory.

    The Aadhaar number is validated, hashed, and dropped — see services/kyc.py.
    """
    # An unpeppered digest of a 12-digit number is reversible by brute force, so
    # refuse to create one rather than write a row that leaks on disclosure.
    # Startup already blocks this combination when MARKETPLACE_ENABLED is on;
    # this covers the deployment that has the flag off and the route still mounted.
    if settings.is_production and not settings.kyc_hash_pepper:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Mechanic registration is not configured",
        )

    try:
        pan = kyc.normalise_pan(payload.pan_number)
        aadhaar_digits = kyc.normalise_aadhaar(payload.aadhaar_number)
    except kyc.KycError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    digest = kyc.aadhaar_digest(aadhaar_digits)
    last4 = kyc.aadhaar_last4(aadhaar_digits)
    del aadhaar_digits  # nothing below this line may see the number

    mechanic = Mechanic(
        full_name=payload.full_name,
        shop_name=payload.shop_name,
        phone=payload.phone,
        whatsapp_phone=payload.whatsapp_phone or payload.phone,
        email=payload.email,
        address_line1=payload.address_line1,
        address_line2=payload.address_line2,
        city=payload.city,
        state=payload.state,
        area_pincode=payload.area_pincode,
        latitude=payload.latitude,
        longitude=payload.longitude,
        service_radius_km=payload.service_radius_km,
        pan_number=pan,
        aadhaar_last4=last4,
        aadhaar_hash=digest,
        upi_vpa=payload.upi_vpa,
        specialisations=payload.specialisations,
        status=MechanicStatus.pending_verification,
        # Anonymous registration stays possible — a mechanic signing up has no
        # account yet — but when a token is present the row is linked, which is
        # what later lets them quote their own jobs.
        user_id=current_user.id if current_user else None,
    )
    db.add(mechanic)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        # Either the phone or the Aadhaar digest collided. The message is
        # deliberately vague about which: confirming "this Aadhaar is already
        # registered" to an anonymous caller turns the endpoint into an oracle
        # for testing whether a given Aadhaar number is on the platform.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A mechanic is already registered with these details",
        ) from exc

    await db.refresh(mechanic)
    return _to_out(mechanic)


@router.get("/nearby", response_model=list[MechanicPublicOut])
async def nearby_mechanics(
    db: DbDep,
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
    radius_km: float = Query(default=0, ge=0),
    limit: int = Query(default=10, ge=1, le=50),
    specialisation: str | None = None,
) -> list[MechanicPublicOut]:
    """Active mechanics near a point, nearest first.

    Public: a stranded user may not be logged in, and making them sign up before
    they can find help is the wrong trade at the roadside.
    """
    effective_radius = radius_km or settings.mechanic_search_radius_km
    effective_radius = min(effective_radius, settings.mechanic_search_max_radius_km)

    matches = await find_nearest_mechanics(
        db,
        latitude=latitude,
        longitude=longitude,
        radius_km=effective_radius,
        limit=limit,
        specialisation=specialisation,
    )
    return [
        MechanicPublicOut(
            id=m.mechanic.id,
            full_name=m.mechanic.full_name,
            shop_name=m.mechanic.shop_name,
            phone=m.mechanic.phone,
            city=m.mechanic.city,
            area_pincode=m.mechanic.area_pincode,
            specialisations=m.mechanic.specialisations,
            rating=float(m.mechanic.rating) if m.mechanic.rating is not None else None,
            jobs_completed=m.mechanic.jobs_completed,
            distance_km=m.distance_km,
        )
        for m in matches
    ]


@router.get("/me", response_model=MechanicOut)
async def my_mechanic_profile(db: DbDep, current_user: CurrentUser) -> MechanicOut:
    """The mechanic profile linked to the caller's account.

    Declared above `/{mechanic_id}`: FastAPI matches routes in definition order,
    so registering a literal path after a UUID parameter means "me" is parsed as
    an id and rejected as malformed.

    404 rather than an empty body when the caller is not a mechanic — the client
    needs to distinguish "you have no mechanic profile" from "here is a blank
    one", and only the former should send them to the registration screen.
    """
    mechanic = (
        await db.execute(select(Mechanic).where(Mechanic.user_id == current_user.id))
    ).scalar_one_or_none()
    if mechanic is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No mechanic profile is linked to this account",
        )
    return _to_out(mechanic)


@router.get("/{mechanic_id}", response_model=MechanicOut)
async def get_mechanic(mechanic_id: uuid.UUID, db: DbDep, current_user: CurrentUser) -> MechanicOut:
    """Full record. Restricted to the mechanic's own linked user, or an admin."""
    mechanic = await db.get(Mechanic, mechanic_id)
    if mechanic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mechanic not found")

    is_owner = mechanic.user_id is not None and mechanic.user_id == current_user.id
    if not is_owner and current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")

    return _to_out(mechanic)


@router.patch("/{mechanic_id}/verify", response_model=MechanicOut)
async def verify_mechanic(
    mechanic_id: uuid.UUID,
    payload: MechanicVerifyRequest,
    db: DbDep,
    admin: AdminUser,
) -> MechanicOut:
    """Approve or reject a pending registration. Admin only."""
    mechanic = await db.get(Mechanic, mechanic_id)
    if mechanic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mechanic not found")

    if payload.approve:
        mechanic.status = MechanicStatus.active
        mechanic.verified_at = datetime.now(timezone.utc).isoformat()
        mechanic.rejection_reason = None
    else:
        mechanic.status = MechanicStatus.rejected
        mechanic.rejection_reason = payload.reason

    await db.commit()
    await db.refresh(mechanic)
    return _to_out(mechanic)


@router.patch("/{mechanic_id}/availability", response_model=MechanicOut)
async def set_availability(
    mechanic_id: uuid.UUID,
    payload: MechanicAvailabilityRequest,
    db: DbDep,
    current_user: CurrentUser,
) -> MechanicOut:
    """Toggle whether a mechanic is currently accepting jobs."""
    mechanic = await db.get(Mechanic, mechanic_id)
    if mechanic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mechanic not found")

    is_owner = mechanic.user_id is not None and mechanic.user_id == current_user.id
    if not is_owner and current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")

    mechanic.is_available = payload.is_available
    await db.commit()
    await db.refresh(mechanic)
    return _to_out(mechanic)


@router.get("", response_model=list[MechanicOut])
async def list_mechanics(
    db: DbDep,
    admin: AdminUser,
    status_filter: MechanicStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[MechanicOut]:
    """Admin listing, for working the verification queue."""
    stmt = select(Mechanic).order_by(Mechanic.created_at.desc()).limit(limit)
    if status_filter is not None:
        stmt = stmt.where(Mechanic.status == status_filter)
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_out(m) for m in rows]
