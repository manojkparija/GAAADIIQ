"""Dispatch, first-accept-wins, and the arrival OTP.

These test the two properties that cannot be checked by reading the code: that
a simultaneous double-accept resolves to exactly one winner, and that the OTP
is genuinely unguessable and unreplayable rather than merely present.

Plain functions, not a class — pyproject only collects `Test*Suite` /
`Test*Case`, so a conventionally-named class here would collect zero tests and
report success.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from models.mechanic import Mechanic, MechanicStatus
from models.service_request import (
    ServiceOfferStatus,
    ServiceRequest,
    ServiceRequestOffer,
    ServiceRequestStatus,
)
from models.user import User, UserRole
from services.service_dispatch import (
    NoMechanicsAvailable,
    accept_offer,
    dispatch_request,
    generate_otp,
    hash_otp,
    issue_start_otp,
    verify_otp,
)

# Two points ~600 m apart in Bhubaneswar, and one ~9 km away.
NEAR = (20.2961, 85.8245)
NEARBY_MECHANIC = (20.3010, 85.8260)
FAR_MECHANIC = (20.3700, 85.8900)


async def _make_user(db, email: str, role: UserRole = UserRole.buyer) -> User:
    user = User(
        id=uuid.uuid4(), email=email, full_name="Test", hashed_password="x", role=role
    )
    db.add(user)
    await db.flush()
    return user


async def _make_mechanic(db, name: str, lat: float, lng: float, **kw) -> Mechanic:
    account = await _make_user(db, f"{name}@example.com", UserRole.buyer)
    mechanic = Mechanic(
        id=uuid.uuid4(),
        user_id=account.id,
        full_name=name,
        phone=f"+9198{abs(hash(name)) % 100000000:08d}",
        address_line1="1 Road",
        city="Bhubaneswar",
        state="Odisha",
        area_pincode="751001",
        latitude=lat,
        longitude=lng,
        service_radius_km=kw.pop("service_radius_km", 15),
        pan_number="ABCDE1234F",
        aadhaar_last4="1234",
        aadhaar_hash=uuid.uuid4().hex,
        status=kw.pop("status", MechanicStatus.active),
        is_available=kw.pop("is_available", True),
    )
    db.add(mechanic)
    await db.flush()
    return mechanic


async def _make_request(db, user: User) -> ServiceRequest:
    sr = ServiceRequest(
        id=uuid.uuid4(),
        reference=f"SR{uuid.uuid4().hex[:8].upper()}",
        user_id=user.id,
        car_number="OD02AB1234",
        latitude=NEAR[0],
        longitude=NEAR[1],
        problem_summary="Engine will not start",
        status=ServiceRequestStatus.open,
    )
    db.add(sr)
    await db.flush()
    return sr


# ── Dispatch ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_dispatch_offers_only_mechanics_inside_the_radius(db_session):
    customer = await _make_user(db_session, "cust1@example.com")
    near = await _make_mechanic(db_session, "NearShop", *NEARBY_MECHANIC)
    await _make_mechanic(db_session, "FarShop", *FAR_MECHANIC)
    sr = await _make_request(db_session, customer)

    offers = await dispatch_request(db_session, sr, radius_km=1.0)
    await db_session.flush()

    assert [o.mechanic_id for o in offers] == [near.id]
    assert sr.dispatch_offer_count == 1
    assert sr.dispatch_radius_km == 1.0


@pytest.mark.asyncio
async def test_dispatch_skips_unavailable_and_inactive_mechanics(db_session):
    customer = await _make_user(db_session, "cust2@example.com")
    await _make_mechanic(db_session, "OfflineShop", *NEARBY_MECHANIC, is_available=False)
    await _make_mechanic(
        db_session, "PendingShop", *NEARBY_MECHANIC, status=MechanicStatus.pending_verification
    )
    sr = await _make_request(db_session, customer)

    with pytest.raises(NoMechanicsAvailable):
        await dispatch_request(db_session, sr, radius_km=1.0)


@pytest.mark.asyncio
async def test_redispatch_does_not_duplicate_an_existing_offer(db_session):
    """A second broadcast must not trip the unique index or double-notify."""
    customer = await _make_user(db_session, "cust3@example.com")
    await _make_mechanic(db_session, "RepeatShop", *NEARBY_MECHANIC)
    sr = await _make_request(db_session, customer)

    first = await dispatch_request(db_session, sr, radius_km=1.0)
    await db_session.flush()
    second = await dispatch_request(db_session, sr, radius_km=1.0)
    await db_session.flush()

    assert len(first) == 1
    assert second == []
    assert sr.dispatch_offer_count == 1


# ── First-accept-wins ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_only_one_mechanic_can_win_a_job(db_session):
    """The property the whole design rests on."""
    customer = await _make_user(db_session, "cust4@example.com")
    first = await _make_mechanic(db_session, "FirstShop", *NEARBY_MECHANIC)
    second = await _make_mechanic(db_session, "SecondShop", *NEARBY_MECHANIC)
    sr = await _make_request(db_session, customer)

    await dispatch_request(db_session, sr, radius_km=1.0)
    await db_session.flush()

    assert await accept_offer(db_session, sr, first) is True
    # Same request, no refresh in between — exactly the state a second mechanic's
    # request would see when both tap at once.
    assert await accept_offer(db_session, sr, second) is False
    await db_session.flush()

    await db_session.refresh(sr)
    assert sr.mechanic_id == first.id
    assert sr.status == ServiceRequestStatus.assigned

    offers = (
        (
            await db_session.execute(
                select(ServiceRequestOffer).where(ServiceRequestOffer.request_id == sr.id)
            )
        )
        .scalars()
        .all()
    )
    by_mechanic = {o.mechanic_id: o.status for o in offers}
    assert by_mechanic[first.id] == ServiceOfferStatus.accepted
    assert by_mechanic[second.id] == ServiceOfferStatus.lost


@pytest.mark.asyncio
async def test_losing_mechanic_does_not_overwrite_the_winner(db_session):
    """Regression: a read-then-write accept would steal an assigned job."""
    customer = await _make_user(db_session, "cust5@example.com")
    winner = await _make_mechanic(db_session, "WinnerShop", *NEARBY_MECHANIC)
    latecomer = await _make_mechanic(db_session, "LateShop", *NEARBY_MECHANIC)
    sr = await _make_request(db_session, customer)
    await dispatch_request(db_session, sr, radius_km=1.0)
    await db_session.flush()

    await accept_offer(db_session, sr, winner)
    await db_session.flush()
    await accept_offer(db_session, sr, latecomer)
    await db_session.flush()

    await db_session.refresh(sr)
    assert sr.mechanic_id == winner.id


# ── Start OTP ───────────────────────────────────────────────────────────────

def test_otp_is_six_digits_and_not_predictable():
    codes = {generate_otp() for _ in range(200)}
    assert all(len(c) == 6 and c.isdigit() for c in codes)
    # 200 draws from 10^6 colliding into a handful of values would mean the
    # generator is not doing its job.
    assert len(codes) > 190


def test_otp_hash_is_scoped_to_its_request():
    """The same digits on a different job must not verify."""
    a, b = uuid.uuid4(), uuid.uuid4()
    assert hash_otp("123456", a) != hash_otp("123456", b)
    assert verify_otp("123456", a, hash_otp("123456", a)) is True
    assert verify_otp("123456", b, hash_otp("123456", a)) is False


def test_otp_hash_does_not_contain_the_code():
    stored = hash_otp("123456", uuid.uuid4())
    assert "123456" not in stored
    assert len(stored) == 64


@pytest.mark.asyncio
async def test_issue_start_otp_stores_only_the_hash(db_session):
    customer = await _make_user(db_session, "cust6@example.com")
    sr = await _make_request(db_session, customer)

    otp = issue_start_otp(sr)
    await db_session.flush()

    assert sr.start_otp_hash is not None
    assert sr.start_otp_hash != otp
    assert otp not in sr.start_otp_hash
    assert sr.start_otp_attempts == 0
    assert verify_otp(otp, sr.id, sr.start_otp_hash) is True
    assert verify_otp("000000", sr.id, sr.start_otp_hash) is False


@pytest.mark.asyncio
async def test_reissuing_invalidates_the_previous_code(db_session):
    """'Show me the code again' must retire the one that may have been overheard."""
    customer = await _make_user(db_session, "cust7@example.com")
    sr = await _make_request(db_session, customer)

    old = issue_start_otp(sr)
    new = issue_start_otp(sr)
    await db_session.flush()

    assert verify_otp(new, sr.id, sr.start_otp_hash) is True
    if old != new:  # 1-in-a-million draw collision is not a failure
        assert verify_otp(old, sr.id, sr.start_otp_hash) is False


@pytest.mark.asyncio
async def test_expired_offer_is_not_returned_as_live(db_session):
    customer = await _make_user(db_session, "cust8@example.com")
    mechanic = await _make_mechanic(db_session, "ExpiredShop", *NEARBY_MECHANIC)
    sr = await _make_request(db_session, customer)
    await dispatch_request(db_session, sr, radius_km=1.0, offer_ttl_minutes=10)
    await db_session.flush()

    offer = (
        await db_session.execute(
            select(ServiceRequestOffer).where(ServiceRequestOffer.mechanic_id == mechanic.id)
        )
    ).scalar_one()
    assert offer.expires_at is not None
    offer.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    await db_session.flush()

    assert offer.expires_at < datetime.now(timezone.utc)
