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
from models.service_request import ServiceRequest, ServiceRequestStatus
from models.user import User, UserRole
from routers.payments import _verify_razorpay_signature
from schemas.mechanic import MechanicPublicOut
from schemas.service_request import (
    AssignMechanicRequest,
    CommissionPreviewOut,
    QuoteRequest,
    ServicePaymentOut,
    ServiceRequestCreate,
    ServiceRequestOut,
)
from services import upi
from services.commission import calculate_commission
from services.geo import find_nearest_mechanics, haversine_km
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


@router.post("/{request_id}/quote", response_model=CommissionPreviewOut)
async def quote_service_request(
    request_id: uuid.UUID,
    payload: QuoteRequest,
    db: DbDep,
    current_user: CurrentUser,
) -> CommissionPreviewOut:
    """Price the job and show the commission split it will settle at.

    Returns the split rather than a bare acknowledgement so the mechanic sees
    their take-home before the customer is asked to pay.
    """
    sr = await _load_owned(db, request_id, current_user)
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
    """Close out a paid job."""
    sr = await _load_owned(db, request_id, current_user)
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
