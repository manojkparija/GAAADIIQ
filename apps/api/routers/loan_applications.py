"""Applying for a car loan, and being matched to a lender.

The flow is: submit an application (with PAN), establish a credit band, get a
ranked set of offers, pick one. Offers are computed on submission and stored,
not derived on read — see models/loan_application.py for why.

Nothing here approves a loan. Every figure returned is indicative, from rate
cards lenders publish for marketing, and the binding offer comes from the
lender's own underwriting. The API says so in `disclaimer` on every offer
response rather than leaving it to the front end to remember.
"""

import secrets
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.dependencies import get_admin_user, get_current_user
from core.limiter import limiter
from db.session import get_db
from models.lending_partner import CreditBand, LendingPartner
from models.loan_application import (
    CreditCheck,
    CreditSource,
    LoanApplication,
    LoanApplicationStatus,
    LoanOffer,
    VehicleCondition,
)
from models.user import User
from schemas.loan_application import (
    CreditCheckOut,
    CreditCheckRequest,
    LendingPartnerOut,
    LoanApplicationAdminOut,
    LoanApplicationCreate,
    LoanApplicationOut,
    LoanOfferOut,
    SelectOfferRequest,
)
from services import credit_bureau, kyc, loan_offers

router = APIRouter(prefix="/loans", tags=["loans"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]
AdminUser = Annotated[User, Depends(get_admin_user)]

DISCLAIMER = (
    "Indicative only. Rates are the lenders' published figures and the final "
    "offer depends on the lender's own credit assessment."
)


def _reference() -> str:
    return f"LN-{secrets.token_hex(3).upper()}"


def _partner_out(partner: LendingPartner) -> LendingPartnerOut:
    # The advertised "from" rate is the best band's, which is what a bank's own
    # marketing quotes. Computed rather than stored so it cannot drift from the
    # rate card it is supposed to summarise.
    rates = [float(s.annual_rate_pct) for s in partner.rate_slabs]
    return LendingPartnerOut(
        id=partner.id,
        name=partner.name,
        slug=partner.slug,
        partner_type=partner.partner_type,
        logo_url=partner.logo_url,
        rate_from_pct=min(rates) if rates else None,
        min_loan_amount=float(partner.min_loan_amount),
        max_loan_amount=float(partner.max_loan_amount),
        min_tenure_months=partner.min_tenure_months,
        max_tenure_months=partner.max_tenure_months,
        min_monthly_income=float(partner.min_monthly_income),
        max_ltv_pct=float(partner.max_ltv_pct),
        processing_fee_pct=float(partner.processing_fee_pct),
        finances_used_cars=partner.finances_used_cars,
    )


def _offer_out(offer: LoanOffer) -> LoanOfferOut:
    return LoanOfferOut(
        id=offer.id,
        partner=_partner_out(offer.partner),
        is_eligible=offer.is_eligible,
        ineligible_reason=offer.ineligible_reason,
        annual_rate_pct=float(offer.annual_rate_pct) if offer.annual_rate_pct is not None else None,
        approved_amount=float(offer.approved_amount) if offer.approved_amount is not None else None,
        tenure_months=offer.tenure_months,
        monthly_emi=float(offer.monthly_emi) if offer.monthly_emi is not None else None,
        total_interest=float(offer.total_interest) if offer.total_interest is not None else None,
        processing_fee=float(offer.processing_fee) if offer.processing_fee is not None else None,
        total_cost=float(offer.total_cost) if offer.total_cost is not None else None,
        rank=offer.rank,
        is_recommended=offer.is_recommended,
    )


def _application_out(app: LoanApplication) -> LoanApplicationOut:
    ordered = sorted(app.offers, key=lambda o: (o.rank if o.rank is not None else 999))
    return LoanApplicationOut(
        id=app.id,
        reference=app.reference,
        status=app.status,
        vehicle_condition=app.vehicle_condition,
        vehicle_description=app.vehicle_description,
        vehicle_price=float(app.vehicle_price),
        applicant_name=app.applicant_name,
        mobile=app.mobile,
        pan_masked=app.pan_masked,
        employment_type=app.employment_type,
        monthly_income=float(app.monthly_income),
        existing_emi=float(app.existing_emi),
        down_payment=float(app.down_payment),
        loan_amount=float(app.loan_amount),
        tenure_months=app.tenure_months,
        credit_score=app.credit_score,
        credit_band=app.credit_band,
        credit_band_label=credit_bureau.band_label(app.credit_band),
        credit_source=app.credit_source,
        selected_offer_id=app.selected_offer_id,
        created_at=app.created_at,
        offers=[_offer_out(o) for o in ordered],
    )


def _admin_application_out(app: LoanApplication) -> LoanApplicationAdminOut:
    """The same application, plus what an admin needs to phone the applicant."""
    base = _application_out(app)
    selected = next((o for o in app.offers if o.id == app.selected_offer_id), None)
    return LoanApplicationAdminOut(
        **base.model_dump(),
        email=app.email,
        city=app.city,
        pincode=app.pincode,
        selected_partner_name=selected.partner.name if selected else None,
        credit_consent_at=app.credit_consent_at,
    )


async def _active_partners(db: AsyncSession) -> list[LendingPartner]:
    rows = await db.execute(
        select(LendingPartner)
        .options(selectinload(LendingPartner.rate_slabs))
        .where(LendingPartner.is_active.is_(True))
        .order_by(LendingPartner.sort_order, LendingPartner.name)
    )
    return list(rows.scalars().all())


async def _rebuild_offers(db: AsyncSession, app: LoanApplication) -> None:
    """Recompute and replace this application's offers.

    Replaces rather than appends: an application whose income or tenure changed
    would otherwise accumulate quotes from several different sets of inputs,
    with nothing on the row to say which was which.
    """
    # Deleted by query rather than through `app.offers`. Reading that collection
    # on a row that was only just flushed triggers a lazy load, which under
    # asyncio raises MissingGreenlet instead of quietly fetching — and the whole
    # request 500s on an application that has no offers yet by definition.
    existing = await db.execute(select(LoanOffer).where(LoanOffer.application_id == app.id))
    for row in existing.scalars().all():
        await db.delete(row)
    await db.flush()

    vehicle_age = None
    if app.vehicle_condition is VehicleCondition.used and app.vehicle_year:
        vehicle_age = datetime.now(timezone.utc).year - app.vehicle_year

    quotes = [
        loan_offers.quote(
            partner,
            vehicle_price=float(app.vehicle_price),
            loan_amount=float(app.loan_amount),
            tenure_months=app.tenure_months,
            monthly_income=float(app.monthly_income),
            existing_emi=float(app.existing_emi),
            band=app.credit_band,
            employment=app.employment_type,
            vehicle_condition_used=app.vehicle_condition is VehicleCondition.used,
            vehicle_age_years=vehicle_age,
        )
        for partner in await _active_partners(db)
    ]

    for index, q in enumerate(loan_offers.rank(quotes)):
        db.add(
            LoanOffer(
                application_id=app.id,
                partner_id=q.partner.id,
                is_eligible=q.is_eligible,
                ineligible_reason=q.ineligible_reason,
                annual_rate_pct=q.annual_rate_pct,
                approved_amount=q.approved_amount,
                tenure_months=q.tenure_months,
                monthly_emi=q.emi,
                total_interest=q.total_interest,
                processing_fee=q.processing_fee,
                total_cost=q.total_cost,
                rank=index if q.is_eligible else None,
                # Only the cheapest eligible offer is recommended, and only when
                # there is a choice to recommend between.
                is_recommended=q.is_eligible and index == 0,
            )
        )
    app.status = LoanApplicationStatus.offers_ready


async def _reload(db: AsyncSession, application_id: uuid.UUID) -> LoanApplication:
    """Re-read an application with everything the response needs already loaded.

    Serialising an offer walks application -> offers -> partner -> rate_slabs.
    Under asyncio a relationship that is not loaded by the time the ORM is done
    raises MissingGreenlet rather than quietly issuing another query, so the
    chain is spelled out here instead of being left to per-attribute defaults.
    """
    rows = await db.execute(
        select(LoanApplication)
        .where(LoanApplication.id == application_id)
        .options(
            selectinload(LoanApplication.offers)
            .selectinload(LoanOffer.partner)
            .selectinload(LendingPartner.rate_slabs)
        )
    )
    return rows.scalar_one()


async def _load_owned(db: AsyncSession, application_id: uuid.UUID, user: User) -> LoanApplication:
    app = await db.get(
        LoanApplication,
        application_id,
        options=[
            selectinload(LoanApplication.offers)
            .selectinload(LoanOffer.partner)
            .selectinload(LendingPartner.rate_slabs)
        ],
    )
    if app is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    # 404 rather than 403 for someone else's application: confirming that a
    # reference exists is itself a disclosure when the object is a loan.
    if app.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    return app


# ── Lender directory ─────────────────────────────────────────────────────────

@router.get("/partners", response_model=list[LendingPartnerOut])
async def list_partners(db: DbDep) -> list[LendingPartnerOut]:
    """Active lenders and their advertised rates. Public.

    Public because the rate comparison table is a reason to visit the page, and
    putting it behind a login would mean asking for an account before showing
    anything worth having one for.
    """
    return [_partner_out(p) for p in await _active_partners(db)]


# ── Applications ─────────────────────────────────────────────────────────────

@router.post("/applications", response_model=LoanApplicationOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
async def create_application(
    request: Request,
    payload: LoanApplicationCreate,
    db: DbDep,
    current_user: CurrentUser,
) -> LoanApplicationOut:
    """Submit an application and get offers back in the same response.

    One call rather than submit-then-fetch: the applicant has just typed their
    income and PAN, and a second round trip before they see anything is where
    they leave.
    """
    try:
        pan = kyc.normalise_pan(payload.pan_number)
    except kyc.KycError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc

    if payload.loan_amount > payload.vehicle_price:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Loan amount cannot exceed the vehicle price",
        )

    # A declared score is a declaration, and is labelled as one all the way
    # through. Nothing here calls a bureau — see services/credit_bureau.py.
    band = credit_bureau.band_for_score(payload.credit_score)
    source = (
        CreditSource.self_declared if payload.credit_score is not None
        else CreditSource.unavailable
    )
    now = datetime.now(timezone.utc)

    app = LoanApplication(
        reference=_reference(),
        user_id=current_user.id,
        car_id=payload.car_id,
        listing_id=payload.listing_id,
        vehicle_condition=payload.vehicle_condition,
        vehicle_description=payload.vehicle_description,
        vehicle_year=payload.vehicle_year,
        vehicle_price=payload.vehicle_price,
        applicant_name=payload.applicant_name,
        date_of_birth=payload.date_of_birth,
        mobile=payload.mobile,
        email=payload.email or current_user.email,
        city=payload.city,
        pincode=payload.pincode,
        pan_number=pan,
        pan_digest=kyc.pan_digest(pan),
        employment_type=payload.employment_type,
        employer_name=payload.employer_name,
        monthly_income=payload.monthly_income,
        existing_emi=payload.existing_emi,
        down_payment=payload.down_payment,
        loan_amount=payload.loan_amount,
        tenure_months=payload.tenure_months,
        credit_score=payload.credit_score,
        credit_band=band,
        credit_source=source,
        credit_checked_at=now if payload.credit_score is not None else None,
        credit_consent=payload.credit_consent,
        credit_consent_at=now if payload.credit_consent else None,
        credit_consent_ip=request.client.host if payload.credit_consent and request.client else None,
        status=LoanApplicationStatus.submitted,
    )
    db.add(app)
    await db.flush()

    if payload.credit_score is not None:
        db.add(
            CreditCheck(
                application_id=app.id,
                user_id=current_user.id,
                pan_digest=app.pan_digest,
                source=CreditSource.self_declared,
                score=payload.credit_score,
                band=band,
                succeeded=True,
            )
        )

    await _rebuild_offers(db, app)
    await db.commit()
    return _application_out(await _reload(db, app.id))


@router.get("/applications", response_model=list[LoanApplicationOut])
async def my_applications(db: DbDep, current_user: CurrentUser) -> list[LoanApplicationOut]:
    rows = await db.execute(
        select(LoanApplication)
        .where(LoanApplication.user_id == current_user.id)
        .options(
            selectinload(LoanApplication.offers)
            .selectinload(LoanOffer.partner)
            .selectinload(LendingPartner.rate_slabs)
        )
        .order_by(LoanApplication.created_at.desc())
    )
    return [_application_out(a) for a in rows.scalars().all()]


@router.get("/applications/{application_id}", response_model=LoanApplicationOut)
async def get_application(
    application_id: uuid.UUID, db: DbDep, current_user: CurrentUser
) -> LoanApplicationOut:
    return _application_out(await _load_owned(db, application_id, current_user))


@router.post("/applications/{application_id}/credit-check", response_model=CreditCheckOut)
@limiter.limit("5/minute")
async def run_credit_check(
    request: Request,
    application_id: uuid.UUID,
    payload: CreditCheckRequest,
    db: DbDep,
    current_user: CurrentUser,
) -> CreditCheckOut:
    """Establish the credit band, from a bureau if one is configured.

    No bureau is, today. Rather than pretend otherwise, this records the
    declared score, re-prices the offers against it, and returns a note saying
    the band was declared rather than checked. The alternative — a plausible
    generated score — would be believed.
    """
    app = await _load_owned(db, application_id, current_user)
    now = datetime.now(timezone.utc)

    if payload.credit_consent and not app.credit_consent:
        app.credit_consent = True
        app.credit_consent_at = now
        app.credit_consent_ip = request.client.host if request.client else None

    note: str | None = None
    if credit_bureau.is_bureau_configured():
        if not app.credit_consent:
            # Not negotiable: the CIC(R) Act makes consent a precondition of the
            # enquiry, not a formality to be collected afterwards.
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Consent is required before a credit bureau check",
            )
        try:
            score, bureau_name = await credit_bureau.fetch_score(app.pan_number)
            band, source = credit_bureau.band_for_score(score), CreditSource.bureau
        except credit_bureau.BureauUnavailable as exc:
            score, bureau_name, band, source = None, None, CreditBand.unknown, CreditSource.unavailable
            note = str(exc)
    else:
        score = payload.declared_score if payload.declared_score is not None else app.credit_score
        bureau_name = None
        band = credit_bureau.band_for_score(score)
        source = CreditSource.self_declared if score is not None else CreditSource.unavailable
        note = (
            "No credit bureau is connected yet, so this band is the one you "
            "declared. Your lender will run their own check."
        )

    db.add(
        CreditCheck(
            application_id=app.id,
            user_id=current_user.id,
            pan_digest=app.pan_digest,
            source=source,
            bureau=bureau_name,
            score=score,
            band=band,
            succeeded=source is not CreditSource.unavailable,
            error=note if source is CreditSource.unavailable else None,
        )
    )

    app.credit_score = score
    app.credit_band = band
    app.credit_source = source
    app.credit_checked_at = now
    await _rebuild_offers(db, app)
    await db.commit()

    return CreditCheckOut(
        source=source,
        bureau=bureau_name,
        score=score,
        band=band,
        band_label=credit_bureau.band_label(band),
        succeeded=source is not CreditSource.unavailable,
        note=note,
    )


@router.get("/applications/{application_id}/offers", response_model=list[LoanOfferOut])
async def get_offers(
    application_id: uuid.UUID, db: DbDep, current_user: CurrentUser
) -> list[LoanOfferOut]:
    app = await _load_owned(db, application_id, current_user)
    ordered = sorted(app.offers, key=lambda o: (o.rank if o.rank is not None else 999))
    return [_offer_out(o) for o in ordered]


@router.post("/applications/{application_id}/select", response_model=LoanApplicationOut)
async def select_offer(
    application_id: uuid.UUID,
    payload: SelectOfferRequest,
    db: DbDep,
    current_user: CurrentUser,
) -> LoanApplicationOut:
    """Choose a lender to be forwarded to."""
    app = await _load_owned(db, application_id, current_user)

    offer = next((o for o in app.offers if o.id == payload.offer_id), None)
    if offer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Offer not found")
    if not offer.is_eligible:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This lender cannot fund the application: {offer.ineligible_reason}",
        )

    app.selected_offer_id = offer.id
    app.status = LoanApplicationStatus.partner_selected
    await db.commit()
    return _application_out(await _reload(db, app.id))


@router.post("/applications/{application_id}/withdraw", response_model=LoanApplicationOut)
async def withdraw_application(
    application_id: uuid.UUID, db: DbDep, current_user: CurrentUser
) -> LoanApplicationOut:
    app = await _load_owned(db, application_id, current_user)
    if app.status in (LoanApplicationStatus.disbursed, LoanApplicationStatus.approved):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A sanctioned loan cannot be withdrawn here — contact the lender",
        )
    app.status = LoanApplicationStatus.withdrawn
    await db.commit()
    return _application_out(await _reload(db, app.id))


# ── Admin ────────────────────────────────────────────────────────────────────

@router.get("/admin/applications", response_model=list[LoanApplicationAdminOut])
async def admin_list_applications(
    db: DbDep,
    admin: AdminUser,
    status_filter: LoanApplicationStatus | None = None,
    limit: int = 50,
) -> list[LoanApplicationAdminOut]:
    """The queue, for working applications and forwarding them to lenders.

    Returns the same masked PAN as everywhere else. An admin who needs the full
    number for a lender hand-off gets it from that hand-off, not from a list
    endpoint that would put every applicant's PAN in one response.
    """
    stmt = (
        select(LoanApplication)
        .options(
            selectinload(LoanApplication.offers)
            .selectinload(LoanOffer.partner)
            .selectinload(LendingPartner.rate_slabs)
        )
        .order_by(LoanApplication.created_at.desc())
        .limit(limit)
    )
    if status_filter is not None:
        stmt = stmt.where(LoanApplication.status == status_filter)
    rows = await db.execute(stmt)
    return [_admin_application_out(a) for a in rows.scalars().all()]
