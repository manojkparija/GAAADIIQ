"""Service requests — raise a job, match a mechanic, quote it, pay, get a receipt.

The flow this implements, end to end:

    AI Diagnosis says "major"
      → POST /service-requests                (car number + live GPS fix)
      → GET  /service-requests/{id}/mechanics  (nearest, ranked)
      → POST /service-requests/{id}/assign     (customer picks one)
      → POST /service-requests/{id}/quote      (mechanic prices the job)
      → POST /service-requests/{id}/pay        (order + UPI scan-to-pay QR)
      → POST /service-requests/{id}/pay/verify (capture, split, WhatsApp receipt)

Money handling follows `routers/payments.py`: in a non-production environment with
no Razorpay keys the verify step auto-approves so the flow is exercisable offline,
and in production signature verification is mandatory with no bypass.
"""

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.config import settings
from core.dependencies import get_current_user
from core.limiter import limiter
from db.session import get_db
from models.mechanic import Mechanic, MechanicStatus
from models.payment import Payment, PaymentPurpose, PaymentStatus
from models.service_request import (
    ServiceOfferStatus,
    ServiceRequest,
    ServiceRequestOffer,
    ServiceRequestStatus,
)
from models.user import User, UserRole
from routers.payments import _verify_razorpay_signature
from schemas.mechanic import MechanicPublicOut
from schemas.service_request import (
    AcceptOfferOut,
    AssignMechanicRequest,
    CommissionPreviewOut,
    DispatchRequestIn,
    DispatchResultOut,
    OfferOut,
    QuoteRequest,
    ServicePaymentOut,
    ServiceRequestCreate,
    ServiceRequestOut,
    StartOtpOut,
    VerifyStartOtpIn,
)
from services import upi
from services.commission import calculate_commission
from services.geo import find_nearest_mechanics, haversine_km
from services.service_dispatch import (
    OTP_MAX_ATTEMPTS,
    DispatchError,
    NoMechanicsAvailable,
    accept_offer,
    decline_offer,
    dispatch_request,
    issue_start_otp,
    verify_otp,
)
from services.whatsapp import send_payment_receipt

router = APIRouter(prefix="/service-requests", tags=["service-requests"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]

# Statuses from which a customer may still walk away. Once money has moved,
# cancellation becomes a refund problem and is out of this endpoint's scope.
CANCELLABLE = {
    ServiceRequestStatus.open,
    ServiceRequestStatus.assigned,
    ServiceRequestStatus.in_progress,
}


def _reference() -> str:
    """Short, unambiguous job reference for receipts and support calls."""
    return f"SR-{uuid.uuid4().hex[:6].upper()}"


def _public_mechanic(m: Mechanic, distance_km: float | None = None) -> MechanicPublicOut:
    return MechanicPublicOut(
        id=m.id,
        full_name=m.full_name,
        shop_name=m.shop_name,
        phone=m.phone,
        city=m.city,
        area_pincode=m.area_pincode,
        specialisations=m.specialisations,
        rating=float(m.rating) if m.rating is not None else None,
        jobs_completed=m.jobs_completed,
        distance_km=distance_km,
    )


def _to_out(sr: ServiceRequest) -> ServiceRequestOut:
    return ServiceRequestOut(
        id=sr.id,
        reference=sr.reference,
        car_number=sr.car_number,
        manufacturer=sr.manufacturer,
        model=sr.model,
        latitude=sr.latitude,
        longitude=sr.longitude,
        address_text=sr.address_text,
        landmark=sr.landmark,
        problem_summary=sr.problem_summary,
        severity=sr.severity,
        status=sr.status,
        quoted_amount_paise=sr.quoted_amount_paise,
        final_amount_paise=sr.final_amount_paise,
        matched_distance_km=sr.matched_distance_km,
        mechanic=_public_mechanic(sr.mechanic, sr.matched_distance_km) if sr.mechanic else None,
        assigned_at=sr.assigned_at,
        completed_at=sr.completed_at,
        created_at=sr.created_at,
    )


async def _load_owned(db: AsyncSession, request_id: uuid.UUID, user: User) -> ServiceRequest:
    """Fetch a request with its mechanic, enforcing ownership."""
    stmt = (
        select(ServiceRequest)
        .options(selectinload(ServiceRequest.mechanic))
        .where(ServiceRequest.id == request_id)
    )
    sr = (await db.execute(stmt)).scalar_one_or_none()
    if sr is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service request not found")
    if sr.user_id != user.id and user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return sr


async def _load_for_mechanic(db: AsyncSession, request_id: uuid.UUID, user: User) -> ServiceRequest:
    """Fetch a request, authorising the mechanic it is assigned to.

    The mirror of `_load_owned`. Pricing and progress belong to the person doing
    the work, not the person paying for it — a customer who can set the quote
    can set it to zero.
    """
    stmt = (
        select(ServiceRequest)
        .options(selectinload(ServiceRequest.mechanic))
        .where(ServiceRequest.id == request_id)
    )
    sr = (await db.execute(stmt)).scalar_one_or_none()
    if sr is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service request not found")

    if user.role == UserRole.admin:
        return sr
    # An unassigned request has nobody to authorise, and a mechanic row with no
    # linked account cannot be acted for — both are a plain 403 rather than a
    # message that would confirm the request exists to a stranger.
    if sr.mechanic is None or sr.mechanic.user_id is None or sr.mechanic.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return sr


@router.post("", response_model=ServiceRequestOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
async def create_service_request(
    request: Request,
    payload: ServiceRequestCreate,
    db: DbDep,
    current_user: CurrentUser,
) -> ServiceRequestOut:
    """Raise a job at the car's current GPS position."""
    sr = ServiceRequest(
        reference=_reference(),
        user_id=current_user.id,
        diagnosis_id=payload.diagnosis_id,
        car_number=payload.car_number,
        manufacturer=payload.manufacturer,
        model=payload.model,
        model_year=payload.model_year,
        fuel_type=payload.fuel_type,
        latitude=payload.latitude,
        longitude=payload.longitude,
        location_accuracy_m=payload.location_accuracy_m,
        address_text=payload.address_text,
        landmark=payload.landmark,
        pincode=payload.pincode,
        contact_phone=payload.contact_phone or current_user.phone,
        problem_summary=payload.problem_summary,
        severity=payload.severity,
        is_vehicle_drivable=payload.is_vehicle_drivable,
        photo_urls=payload.photo_urls,
        status=ServiceRequestStatus.open,
    )
    db.add(sr)
    await db.commit()
    await db.refresh(sr)
    return _to_out(sr)


@router.get("", response_model=list[ServiceRequestOut])
async def list_my_requests(
    db: DbDep,
    current_user: CurrentUser,
    limit: int = Query(default=20, ge=1, le=100),
) -> list[ServiceRequestOut]:
    stmt = (
        select(ServiceRequest)
        .options(selectinload(ServiceRequest.mechanic))
        .where(ServiceRequest.user_id == current_user.id)
        .order_by(ServiceRequest.created_at.desc())
        .limit(limit)
    )
    return [_to_out(sr) for sr in (await db.execute(stmt)).scalars().all()]


@router.get("/assigned-to-me", response_model=list[ServiceRequestOut])
async def jobs_assigned_to_me(
    db: DbDep,
    current_user: CurrentUser,
    limit: int = Query(default=50, ge=1, le=200),
) -> list[ServiceRequestOut]:
    """Every job assigned to the mechanic linked to the caller's account.

    Declared above `/{request_id}` on purpose: FastAPI matches in definition
    order, so a literal path registered after a UUID parameter would be parsed
    as an id and rejected as malformed.

    Cancelled and completed jobs are included — a mechanic needs their history,
    not just today's work — and the ordering puts live jobs first.
    """
    mechanic = (
        await db.execute(select(Mechanic).where(Mechanic.user_id == current_user.id))
    ).scalar_one_or_none()
    if mechanic is None:
        # Not an error: a signed-in user who simply is not a mechanic has an
        # empty queue rather than a failure.
        return []

    stmt = (
        select(ServiceRequest)
        .options(selectinload(ServiceRequest.mechanic))
        .where(ServiceRequest.mechanic_id == mechanic.id)
        .order_by(ServiceRequest.created_at.desc())
        .limit(limit)
    )
    return [_to_out(sr) for sr in (await db.execute(stmt)).scalars().all()]


@router.get("/{request_id}", response_model=ServiceRequestOut)
async def get_service_request(
    request_id: uuid.UUID, db: DbDep, current_user: CurrentUser
) -> ServiceRequestOut:
    return _to_out(await _load_owned(db, request_id, current_user))


@router.get("/{request_id}/mechanics", response_model=list[MechanicPublicOut])
async def mechanics_for_request(
    request_id: uuid.UUID,
    db: DbDep,
    current_user: CurrentUser,
    radius_km: float = Query(default=0, ge=0),
    limit: int = Query(default=10, ge=1, le=50),
) -> list[MechanicPublicOut]:
    """Nearest mechanics to *this job's* coordinates."""
    sr = await _load_owned(db, request_id, current_user)
    effective_radius = min(
        radius_km or settings.mechanic_search_radius_km,
        settings.mechanic_search_max_radius_km,
    )
    matches = await find_nearest_mechanics(
        db,
        latitude=sr.latitude,
        longitude=sr.longitude,
        radius_km=effective_radius,
        limit=limit,
    )
    return [_public_mechanic(m.mechanic, m.distance_km) for m in matches]


@router.post("/{request_id}/assign", response_model=ServiceRequestOut)
async def assign_mechanic(
    request_id: uuid.UUID,
    payload: AssignMechanicRequest,
    db: DbDep,
    current_user: CurrentUser,
) -> ServiceRequestOut:
    """Attach a mechanic the customer chose from the nearby list."""
    sr = await _load_owned(db, request_id, current_user)
    if sr.status not in (ServiceRequestStatus.open, ServiceRequestStatus.assigned):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot assign a request in status '{sr.status.value}'",
        )

    mechanic = await db.get(Mechanic, payload.mechanic_id)
    if mechanic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mechanic not found")
    # Re-checked rather than trusted from the earlier search: a mechanic can be
    # suspended between the customer seeing the list and tapping a name.
    if mechanic.status != MechanicStatus.active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="That mechanic is not currently active"
        )

    sr.mechanic_id = mechanic.id
    sr.status = ServiceRequestStatus.assigned
    sr.assigned_at = datetime.now(timezone.utc)
    if mechanic.latitude is not None and mechanic.longitude is not None:
        sr.matched_distance_km = round(
            haversine_km(sr.latitude, sr.longitude, mechanic.latitude, mechanic.longitude), 2
        )

    await db.commit()
    await db.refresh(sr, attribute_names=["mechanic"])
    return _to_out(sr)


@router.post("/{request_id}/start", response_model=ServiceRequestOut)
async def start_work(
    request_id: uuid.UUID, db: DbDep, current_user: CurrentUser
) -> ServiceRequestOut:
    """Mechanic accepts the job and is on their way / on site."""
    sr = await _load_for_mechanic(db, request_id, current_user)
    if sr.status != ServiceRequestStatus.assigned:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot start a request in status '{sr.status.value}'",
        )
    sr.status = ServiceRequestStatus.in_progress
    await db.commit()
    await db.refresh(sr, attribute_names=["mechanic"])
    return _to_out(sr)


@router.post("/{request_id}/quote", response_model=CommissionPreviewOut)
async def quote_service_request(
    request_id: uuid.UUID,
    payload: QuoteRequest,
    db: DbDep,
    current_user: CurrentUser,
) -> CommissionPreviewOut:
    """Price the job and show the commission split it will settle at.

    Authorised for the assigned mechanic, not the customer. This used to accept
    the customer's token, which meant the person paying could set the price they
    paid — the endpoint existed but was pointed at the wrong party.

    Returns the split rather than a bare acknowledgement so the mechanic sees
    their take-home before the customer is asked to pay.
    """
    sr = await _load_for_mechanic(db, request_id, current_user)
    if sr.mechanic_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Assign a mechanic before quoting"
        )

    sr.quoted_amount_paise = payload.amount_paise
    sr.status = ServiceRequestStatus.awaiting_payment
    await db.commit()

    split = calculate_commission(payload.amount_paise)
    return CommissionPreviewOut(
        gross_paise=split.gross_paise,
        commission_paise=split.commission_paise,
        mechanic_payout_paise=split.mechanic_payout_paise,
        commission_rate_bps=split.rate_bps,
        effective_rate_pct=split.effective_rate_pct,
    )


@router.post("/{request_id}/pay", response_model=ServicePaymentOut)
@limiter.limit("10/minute")
async def start_payment(
    request: Request,
    request_id: uuid.UUID,
    db: DbDep,
    current_user: CurrentUser,
) -> ServicePaymentOut:
    """Open a payment for the quoted amount and hand back the scan-to-pay QR."""
    sr = await _load_owned(db, request_id, current_user)
    if sr.quoted_amount_paise is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This request has not been quoted yet"
        )
    if sr.status == ServiceRequestStatus.paid:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already paid")

    amount = sr.quoted_amount_paise
    split = calculate_commission(amount)

    payment = Payment(
        user_id=current_user.id,
        amount_paise=amount,
        purpose=PaymentPurpose.service_request,
        status=PaymentStatus.pending,
        service_request_id=sr.id,
        mechanic_id=sr.mechanic_id,
        commission_rate_bps=split.rate_bps,
        commission_paise=split.commission_paise,
        mechanic_payout_paise=split.mechanic_payout_paise,
    )
    db.add(payment)
    await db.flush()

    if settings.payments_enabled:
        import razorpay  # type: ignore[import]

        client = razorpay.Client(auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET))
        order = client.order.create(
            {"amount": amount, "currency": "INR", "receipt": sr.reference}
        )
        payment.razorpay_order_id = order["id"]
    else:
        payment.razorpay_order_id = f"dev_order_{uuid.uuid4().hex[:12]}"

    # Platform-collect: the QR resolves to the platform VPA with the job
    # reference in the note, which is what makes the commission deductible.
    # See services/upi.py for the direct-to-mechanic alternative.
    payee_vpa = settings.upi_payee_vpa or None
    upi_uri = (
        upi.build_upi_uri(payee_vpa, amount, sr.reference) if payee_vpa else None
    )

    await db.commit()
    await db.refresh(payment)

    return ServicePaymentOut(
        payment_id=payment.id,
        service_request_id=sr.id,
        reference=sr.reference,
        amount_paise=amount,
        razorpay_order_id=payment.razorpay_order_id,
        upi_uri=upi_uri,
        upi_qr_data_uri=upi.build_qr_png_data_uri(upi_uri) if upi_uri else None,
        commission=CommissionPreviewOut(
            gross_paise=split.gross_paise,
            commission_paise=split.commission_paise,
            mechanic_payout_paise=split.mechanic_payout_paise,
            commission_rate_bps=split.rate_bps,
            effective_rate_pct=split.effective_rate_pct,
        ),
    )


class VerifyPaymentRequest(BaseModel):
    """Razorpay's checkout callback payload.

    Optional in dev mode (no keys configured), mandatory and signature-checked
    everywhere else.
    """

    razorpay_order_id: str | None = None
    razorpay_payment_id: str | None = None
    razorpay_signature: str | None = None


@router.post("/{request_id}/pay/verify", response_model=ServiceRequestOut)
@limiter.limit("10/minute")
async def verify_payment(
    request: Request,
    request_id: uuid.UUID,
    payload: VerifyPaymentRequest,
    db: DbDep,
    current_user: CurrentUser,
) -> ServiceRequestOut:
    """Capture the payment, freeze the split, and fire the WhatsApp receipt."""
    sr = await _load_owned(db, request_id, current_user)

    payment = (
        await db.execute(
            select(Payment)
            .where(
                Payment.service_request_id == sr.id,
                Payment.status == PaymentStatus.pending,
            )
            .order_by(Payment.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if payment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No pending payment for this request"
        )

    if settings.payments_enabled:
        # Production path: no bypass. Missing fields are as fatal as a bad signature.
        if not (payload.razorpay_order_id and payload.razorpay_payment_id and payload.razorpay_signature):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="razorpay_order_id, razorpay_payment_id and razorpay_signature are required",
            )
        _verify_razorpay_signature(
            payload.razorpay_order_id, payload.razorpay_payment_id, payload.razorpay_signature
        )
        payment.razorpay_payment_id = payload.razorpay_payment_id
    else:
        payment.razorpay_payment_id = f"dev_pay_{uuid.uuid4().hex[:12]}"

    payment.status = PaymentStatus.paid
    sr.final_amount_paise = payment.amount_paise
    sr.status = ServiceRequestStatus.paid

    # Credit the mechanic's job counter once, on capture.
    mechanic = await db.get(Mechanic, sr.mechanic_id) if sr.mechanic_id else None
    if mechanic is not None:
        mechanic.jobs_completed += 1

    await db.flush()

    # Receipt delivery must never roll back a captured payment, so failures are
    # recorded on the whatsapp_messages row rather than raised. See
    # services/whatsapp.send_message.
    # The customer's number only. Never fall back to the mechanic's: a receipt
    # carries the amount and the registration number, and routing it to whoever
    # happens to be on the job would hand a third party the customer's details.
    receipt_phone = sr.contact_phone or current_user.phone
    if receipt_phone:
        await send_payment_receipt(
            db,
            to_phone=receipt_phone,
            reference=sr.reference,
            amount_paise=payment.amount_paise,
            mechanic_name=mechanic.full_name if mechanic else "GAADIIQ partner",
            car_number=sr.car_number,
            payment_id=payment.id,
            service_request_id=sr.id,
        )

    await db.commit()
    await db.refresh(sr, attribute_names=["mechanic"])
    return _to_out(sr)


@router.post("/{request_id}/complete", response_model=ServiceRequestOut)
async def complete_service_request(
    request_id: uuid.UUID, db: DbDep, current_user: CurrentUser
) -> ServiceRequestOut:
    """Close out a paid job. Either party may do it — both know when it is done."""
    try:
        sr = await _load_owned(db, request_id, current_user)
    except HTTPException:
        sr = await _load_for_mechanic(db, request_id, current_user)
    if sr.status != ServiceRequestStatus.paid:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only a paid request can be completed",
        )
    sr.status = ServiceRequestStatus.completed
    sr.completed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(sr, attribute_names=["mechanic"])
    return _to_out(sr)


@router.post("/{request_id}/cancel", response_model=ServiceRequestOut)
async def cancel_service_request(
    request_id: uuid.UUID,
    db: DbDep,
    current_user: CurrentUser,
    reason: str | None = Query(default=None, max_length=500),
) -> ServiceRequestOut:
    """Withdraw a job that has not been paid for."""
    sr = await _load_owned(db, request_id, current_user)
    if sr.status not in CANCELLABLE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot cancel a request in status '{sr.status.value}'",
        )
    sr.status = ServiceRequestStatus.cancelled
    sr.cancelled_reason = reason
    await db.commit()
    await db.refresh(sr, attribute_names=["mechanic"])
    return _to_out(sr)


# ── Dispatch: broadcast, accept, start OTP ──────────────────────────────────
#
# The Uber-shaped path, alongside the customer-picks-a-mechanic path above:
#
#   POST /{id}/dispatch          customer broadcasts to everyone within 1 km
#   GET  /offers/available       mechanic sees jobs offered to them
#   POST /{id}/accept            first to accept wins, atomically
#   POST /{id}/decline           pass, leaving it open for the rest
#   GET  /{id}/start-otp         customer reads the code off their screen
#   POST /{id}/verify-start-otp  mechanic enters it on arrival → in_progress


async def _mechanic_for_user(db: AsyncSession, user: User) -> Mechanic:
    """The mechanic profile acting for this account, or 403."""
    m = (
        await db.execute(select(Mechanic).where(Mechanic.user_id == user.id))
    ).scalar_one_or_none()
    if m is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"No mechanic profile is linked to {user.email}. "
                   "Register as a mechanic before picking up jobs.",
        )
    if m.status != MechanicStatus.active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Your mechanic account is '{m.status.value}' and cannot take jobs yet.",
        )
    return m


@router.post("/{request_id}/dispatch", response_model=DispatchResultOut)
@limiter.limit("10/hour")
async def dispatch_service_request(
    request: Request,
    request_id: uuid.UUID,
    payload: DispatchRequestIn,
    db: DbDep,
    current_user: CurrentUser,
) -> DispatchResultOut:
    """Broadcast an open request to available mechanics nearby.

    Rate-limited per customer: a broadcast interrupts every mechanic in the
    area, so re-sending it in a loop is not a free action.
    """
    sr = await _load_owned(db, request_id, current_user)

    try:
        offers = await dispatch_request(
            db, sr, radius_km=payload.radius_km, limit=payload.limit
        )
    except NoMechanicsAvailable as exc:
        # 404 would say the request does not exist; 500 would say we broke.
        # Neither is true — the honest answer is that nobody is around, and the
        # customer needs to know that rather than watch a spinner.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except DispatchError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    await db.commit()

    return DispatchResultOut(
        request_id=sr.id,
        reference=sr.reference,
        radius_km=sr.dispatch_radius_km or 0.0,
        offers_sent=sr.dispatch_offer_count,
        expires_at=offers[0].expires_at if offers else None,
        message=(
            f"Sent to {sr.dispatch_offer_count} mechanic(s) within "
            f"{sr.dispatch_radius_km:g} km. The first to accept will be assigned."
        ),
    )


@router.get("/offers/available", response_model=list[OfferOut])
async def my_offers(db: DbDep, current_user: CurrentUser) -> list[OfferOut]:
    """Live job offers for the signed-in mechanic, nearest first."""
    mechanic = await _mechanic_for_user(db, current_user)
    now = datetime.now(timezone.utc)

    stmt = (
        select(ServiceRequestOffer, ServiceRequest)
        .join(ServiceRequest, ServiceRequest.id == ServiceRequestOffer.request_id)
        .where(
            ServiceRequestOffer.mechanic_id == mechanic.id,
            ServiceRequestOffer.status == ServiceOfferStatus.offered,
            # Still genuinely available: an offer whose request was taken or
            # cancelled must not sit in the queue looking actionable.
            ServiceRequest.status == ServiceRequestStatus.open,
        )
        .order_by(ServiceRequestOffer.distance_km)
    )
    rows = (await db.execute(stmt)).all()

    return [
        OfferOut(
            offer_id=offer.id,
            request_id=sr.id,
            reference=sr.reference,
            distance_km=offer.distance_km,
            problem_summary=sr.problem_summary,
            severity=sr.severity,
            is_vehicle_drivable=sr.is_vehicle_drivable,
            manufacturer=sr.manufacturer,
            model=sr.model,
            pincode=sr.pincode,
            landmark=sr.landmark,
            created_at=sr.created_at,
            expires_at=offer.expires_at,
        )
        for offer, sr in rows
        if offer.expires_at is None or offer.expires_at > now
    ]


@router.post("/{request_id}/accept", response_model=AcceptOfferOut)
async def accept_service_request(
    request_id: uuid.UUID, db: DbDep, current_user: CurrentUser
) -> AcceptOfferOut:
    """Mechanic claims a broadcast job. First to arrive here wins."""
    mechanic = await _mechanic_for_user(db, current_user)

    sr = (
        await db.execute(
            select(ServiceRequest)
            .options(selectinload(ServiceRequest.mechanic))
            .where(ServiceRequest.id == request_id)
        )
    ).scalar_one_or_none()
    if sr is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service request not found")

    # Only someone who was actually offered the job may take it. Without this,
    # the endpoint is an open queue any registered mechanic could claim from by
    # guessing a request id, which defeats the radius entirely.
    offer = (
        await db.execute(
            select(ServiceRequestOffer).where(
                ServiceRequestOffer.request_id == sr.id,
                ServiceRequestOffer.mechanic_id == mechanic.id,
            )
        )
    ).scalar_one_or_none()
    if offer is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This job was not offered to you",
        )
    if offer.expires_at is not None and offer.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_410_GONE, detail="This offer has expired"
        )

    won = await accept_offer(db, sr, mechanic)
    await db.commit()

    if not won:
        return AcceptOfferOut(
            won=False,
            request_id=sr.id,
            message="Another mechanic accepted this job first.",
        )

    await db.refresh(sr, attribute_names=["mechanic"])
    return AcceptOfferOut(
        won=True,
        request_id=sr.id,
        message="Job assigned to you. Ask the customer for their 6-digit start code on arrival.",
        request=_to_out(sr),
    )


@router.post("/{request_id}/decline", status_code=status.HTTP_204_NO_CONTENT)
async def decline_service_request(
    request_id: uuid.UUID, db: DbDep, current_user: CurrentUser
) -> None:
    """Mechanic passes on a job, leaving it open for the others."""
    mechanic = await _mechanic_for_user(db, current_user)
    sr = await db.get(ServiceRequest, request_id)
    if sr is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service request not found")
    await decline_offer(db, sr, mechanic)
    await db.commit()


@router.get("/{request_id}/start-otp", response_model=StartOtpOut)
async def get_start_otp(
    request_id: uuid.UUID, db: DbDep, current_user: CurrentUser
) -> StartOtpOut:
    """The start code, for the customer who raised the request.

    Behind `_load_owned`, so only the customer (or an admin) can reach it. The
    mechanic must obtain it from the customer in person — which is the entire
    reason the code exists.
    """
    sr = await _load_owned(db, request_id, current_user)
    if sr.status not in (ServiceRequestStatus.open, ServiceRequestStatus.assigned):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"No start code is needed for a request in status '{sr.status.value}'",
        )

    # Issued on demand rather than at creation: the plaintext is unrecoverable
    # once returned, so "show me the code again" has to mint a fresh one. Any
    # code the mechanic was already told stops working at that moment, which is
    # the correct behaviour if the customer suspects it was overheard.
    otp = issue_start_otp(sr)
    await db.commit()

    return StartOtpOut(
        request_id=sr.id,
        reference=sr.reference,
        otp=otp,
        issued_at=sr.start_otp_issued_at or datetime.now(timezone.utc),
    )


@router.post("/{request_id}/verify-start-otp", response_model=ServiceRequestOut)
@limiter.limit("20/hour")
async def verify_start_otp(
    request: Request,
    request_id: uuid.UUID,
    payload: VerifyStartOtpIn,
    db: DbDep,
    current_user: CurrentUser,
) -> ServiceRequestOut:
    """Mechanic enters the customer's code on arrival; the job starts.

    This replaces the bare `/start` transition for dispatched jobs: work now
    begins on proof of arrival rather than on the mechanic's own say-so.
    """
    sr = await _load_for_mechanic(db, request_id, current_user)

    if sr.status != ServiceRequestStatus.assigned:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot start a request in status '{sr.status.value}'",
        )
    if not sr.start_otp_hash:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No start code has been issued yet — ask the customer to open the job and read it out.",
        )

    # Counted before the comparison, so a crash or a disconnect mid-request
    # cannot be used to get a free guess.
    if sr.start_otp_attempts >= OTP_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many incorrect attempts. Ask the customer to generate a new code.",
        )
    sr.start_otp_attempts += 1

    if not verify_otp(payload.otp, sr.id, sr.start_otp_hash):
        await db.commit()  # persist the attempt even though the request fails
        remaining = max(0, OTP_MAX_ATTEMPTS - sr.start_otp_attempts)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Incorrect code. {remaining} attempt(s) remaining.",
        )

    now = datetime.now(timezone.utc)
    sr.start_otp_verified_at = now
    sr.status = ServiceRequestStatus.in_progress
    # Single-use: the code has done its job, and leaving it live would let it be
    # replayed if the work is paused and resumed.
    sr.start_otp_hash = None
    await db.commit()
    await db.refresh(sr, attribute_names=["mechanic"])
    return _to_out(sr)
