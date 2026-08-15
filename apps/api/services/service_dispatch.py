"""Uber-style dispatch for roadside jobs: broadcast, first-accept-wins, start OTP.

The original flow had the customer browse nearby mechanics and pick one. That is
fine in a workshop-booking context and wrong at the roadside: someone whose car
has stopped on a highway should not be comparison-shopping, and the mechanic who
happens to sort first is not the one who can get there soonest.

So a request is broadcast to every available mechanic inside a small radius, and
the first to accept gets it. Three things make that safe rather than merely
quick.

FIRST-ACCEPT-WINS IS A DATABASE GUARANTEE, NOT A RACE

Acceptance is a single conditional UPDATE against `status = 'open'`. Two
mechanics tapping Accept in the same second both issue it; exactly one matches a
row. The loser is told the job is gone. Nothing here depends on how fast the two
requests arrive, which is the part that cannot be tested reliably and therefore
must not be relied on.

THE BROADCAST DOES NOT LEAK THE CUSTOMER

A stranded person's exact coordinates and phone number are visible only to the
mechanic who actually took the job. The offer itself carries the distance, the
area, and the problem — enough to decide whether to accept, and not enough to
turn up uninvited. Broadcasting the full location to every mechanic within a
kilometre would hand a person's precise position, and the information that they
are alone with a broken car, to a list of strangers.

THE OTP PROVES ARRIVAL, SO IT CANNOT TRAVEL WITH THE MECHANIC

The code is generated when the job is raised and shown only to the customer. The
mechanic asks for it on arrival and enters it. That is the whole mechanism: a
code the mechanic can only obtain by being face to face with the customer. Send
it to the mechanic instead and it proves nothing, because they would hold it
before setting off.

Only the hash is stored. Six digits is not a password, but a plaintext OTP in
the row would make a database read indistinguishable from having turned up —
which is precisely the distinction the OTP exists to draw.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.mechanic import Mechanic
from models.notification import Notification, NotificationType
from models.service_request import (
    ServiceOfferStatus,
    ServiceRequest,
    ServiceRequestOffer,
    ServiceRequestStatus,
)
from models.whatsapp_message import WhatsAppTemplate
from services.geo import find_nearest_mechanics
from services.whatsapp import queue_message

logger = logging.getLogger("gaadiiq.dispatch")

OTP_LENGTH = 6
OTP_MAX_ATTEMPTS = 5


class DispatchError(RuntimeError):
    """Dispatch could not proceed. Carries a message meant for the caller."""


class NoMechanicsAvailable(DispatchError):
    """Nobody active within the radius. Not an error in the system — an answer."""


def _otp_pepper() -> str:
    """Server-side secret mixed into every OTP hash.

    Without it, six digits is a 10^6 search a database reader can exhaust
    instantly with a rainbow table. With it, the hash is useless to anyone who
    has the table but not the application secret.

    Deliberately the same setting the KYC digests use rather than a second one
    of its own. `kyc_hash_pepper` is already refused-at-boot when the
    marketplace is switched on (core/config.py), so reusing it means the OTP
    cannot silently run unpeppered in production. A new setting would start life
    defaulting to "" with nothing checking it.
    """
    return settings.kyc_hash_pepper or ""


def generate_otp() -> str:
    """A cryptographically random 6-digit code.

    `secrets`, not `random`: the existing routers/otp.py uses random.choices,
    which is a Mersenne Twister and predictable from prior outputs. That matters
    more here than for a login OTP, because the value being protected is a
    stranger's admission to a person's location.
    """
    return f"{secrets.randbelow(10 ** OTP_LENGTH):0{OTP_LENGTH}d}"


def hash_otp(otp: str, request_id: uuid.UUID) -> str:
    """Peppered, request-scoped SHA-256 of the code.

    The request id is part of the input so an OTP captured from one job cannot
    be replayed against another that happens to have drawn the same digits —
    with six digits and enough jobs, collisions are a certainty, not a theory.
    """
    return hashlib.sha256(
        f"{_otp_pepper()}:{request_id}:{otp}".encode()
    ).hexdigest()


def verify_otp(otp: str, request_id: uuid.UUID, stored_hash: str) -> bool:
    """Constant-time comparison, so timing does not leak a digit at a time."""
    return hmac.compare_digest(hash_otp(otp, request_id), stored_hash)


def issue_start_otp(sr: ServiceRequest) -> str:
    """Attach a fresh start OTP to the request and return the plaintext once.

    The plaintext is returned rather than stored, and the caller is responsible
    for putting it in front of the customer and nowhere else. It cannot be
    recovered afterwards — a "resend" issues a new code.
    """
    otp = generate_otp()
    sr.start_otp_hash = hash_otp(otp, sr.id)
    sr.start_otp_issued_at = datetime.now(timezone.utc)
    sr.start_otp_attempts = 0
    sr.start_otp_verified_at = None
    return otp


async def dispatch_request(
    db: AsyncSession,
    sr: ServiceRequest,
    *,
    radius_km: float | None = None,
    limit: int | None = None,
    offer_ttl_minutes: int | None = None,
) -> list[ServiceRequestOffer]:
    """Broadcast an open request to nearby available mechanics.

    Returns the offers created. Raises NoMechanicsAvailable when the radius is
    empty — the caller should widen the search or tell the customer plainly,
    rather than leaving the request sitting open while they assume help is
    coming.
    """
    if sr.status != ServiceRequestStatus.open:
        raise DispatchError(
            f"Only an open request can be dispatched; this one is '{sr.status.value}'"
        )

    radius = radius_km or settings.dispatch_radius_km
    radius = min(radius, settings.mechanic_search_max_radius_km)
    max_offers = limit or settings.dispatch_max_offers
    ttl = offer_ttl_minutes or settings.dispatch_offer_ttl_minutes

    matches = await find_nearest_mechanics(
        db,
        latitude=sr.latitude,
        longitude=sr.longitude,
        radius_km=radius,
        limit=max_offers,
    )
    if not matches:
        raise NoMechanicsAvailable(
            f"No available mechanic within {radius:g} km right now"
        )

    # Mechanics already offered this job in an earlier round — re-dispatch after
    # a timeout must not create a duplicate row and trip the unique index.
    existing = set(
        (
            await db.execute(
                select(ServiceRequestOffer.mechanic_id).where(
                    ServiceRequestOffer.request_id == sr.id
                )
            )
        )
        .scalars()
        .all()
    )

    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=ttl)
    created: list[ServiceRequestOffer] = []

    for match in matches:
        if match.mechanic.id in existing:
            continue
        offer = ServiceRequestOffer(
            request_id=sr.id,
            mechanic_id=match.mechanic.id,
            status=ServiceOfferStatus.offered,
            distance_km=round(match.distance_km, 2),
            expires_at=expires,
        )
        db.add(offer)
        created.append(offer)
        await notify_offer(db, sr, offer, match.mechanic)

    sr.dispatched_at = now
    sr.dispatch_radius_km = radius
    sr.dispatch_offer_count = len(existing) + len(created)

    logger.info(
        "dispatch: request=%s radius=%.1fkm offered=%d (new=%d)",
        sr.reference,
        radius,
        sr.dispatch_offer_count,
        len(created),
    )
    return created


async def notify_offer(
    db: AsyncSession, sr: ServiceRequest, offer: ServiceRequestOffer, mechanic: Mechanic
) -> None:
    """Tell one mechanic a job is waiting, on every channel available.

    Two channels, because they fail in opposite situations. The in-app
    notification is reliable and reaches nobody who is not looking; WhatsApp
    reaches a mechanic whose browser is shut, and depends on a provider and an
    approved template. A broadcast expires in minutes, so a mechanic who has to
    be already staring at a dashboard to see one is a mechanic who mostly
    misses them.

    Never raises. A notification that fails must not roll back the dispatch —
    the offer row is the thing that matters, and a mechanic who opens the
    dashboard will still see it.

    What is deliberately NOT sent: the customer's name, phone number, street
    address or coordinates. Same rule as the offer API. This message goes to
    every mechanic in the radius and none of them has committed to anything.
    """
    # The try below used to wrap `db.add()` alone, which cannot fail: add()
    # only puts the object in the session, and the INSERT runs at flush — after
    # this function has returned, outside any guard here. So the comment above
    # promised something the code could not deliver, and production proved it:
    #
    #   asyncpg UndefinedObjectError: type "notification_type" does not exist
    #   POST /service-requests/{id}/dispatch 500
    #
    # The offer rows died with it. A savepoint is what makes the promise true —
    # the flush happens here, and a failure rolls back only the notification.
    if mechanic.user_id is not None:
        try:
            async with db.begin_nested():
                db.add(
                    Notification(
                        user_id=mechanic.user_id,
                        type=NotificationType.job_offer,
                        title=f"New job {offer.distance_km:g} km away",
                        body=(
                            f"{sr.problem_summary[:160]} — open your dashboard to accept. "
                            f"Reference {sr.reference}."
                        ),
                    )
                )
                await db.flush()
        except Exception:
            logger.exception("in-app offer notification failed for mechanic=%s", mechanic.id)

    try:
        phone = mechanic.whatsapp_phone or mechanic.phone
        if phone:
            await queue_message(
                db,
                to_phone=phone,
                template=WhatsAppTemplate.job_offer,
                variables={
                    "reference": sr.reference,
                    "distance_km": f"{offer.distance_km:g}",
                    "problem": sr.problem_summary[:120],
                    "area": sr.pincode or "",
                },
                # One message per (request, mechanic), so a re-dispatch after a
                # timeout cannot send the same mechanic the same job twice.
                idempotency_key=f"job_offer:{sr.id}:{mechanic.id}",
                service_request_id=sr.id,
            )
    except Exception:
        logger.exception("whatsapp offer notification failed for mechanic=%s", mechanic.id)


async def accept_offer(
    db: AsyncSession,
    sr: ServiceRequest,
    mechanic: Mechanic,
) -> bool:
    """Claim a broadcast job for `mechanic`. True if won, False if already taken.

    The whole point is the WHERE clause: the assignment only lands if the
    request is still open. Checking first and writing second would leave a
    window in which both mechanics see 'open' and both write, and the second
    write would silently steal a job the first was already driving to.
    """
    now = datetime.now(timezone.utc)

    result = await db.execute(
        update(ServiceRequest)
        .where(
            ServiceRequest.id == sr.id,
            ServiceRequest.status == ServiceRequestStatus.open,
            ServiceRequest.mechanic_id.is_(None),
        )
        .values(
            mechanic_id=mechanic.id,
            status=ServiceRequestStatus.assigned,
            assigned_at=now,
        )
    )

    if result.rowcount == 0:
        # Someone else got there first. Record it so the mechanic's own history
        # shows the job as lost rather than silently vanishing from their queue.
        await db.execute(
            update(ServiceRequestOffer)
            .where(
                ServiceRequestOffer.request_id == sr.id,
                ServiceRequestOffer.mechanic_id == mechanic.id,
                ServiceRequestOffer.status == ServiceOfferStatus.offered,
            )
            .values(status=ServiceOfferStatus.lost, responded_at=now)
        )
        return False

    await db.execute(
        update(ServiceRequestOffer)
        .where(
            ServiceRequestOffer.request_id == sr.id,
            ServiceRequestOffer.mechanic_id == mechanic.id,
        )
        .values(status=ServiceOfferStatus.accepted, responded_at=now)
    )
    # Every other outstanding offer for this job is now dead.
    await db.execute(
        update(ServiceRequestOffer)
        .where(
            ServiceRequestOffer.request_id == sr.id,
            ServiceRequestOffer.mechanic_id != mechanic.id,
            ServiceRequestOffer.status == ServiceOfferStatus.offered,
        )
        .values(status=ServiceOfferStatus.lost, responded_at=now)
    )

    logger.info("dispatch: request=%s accepted by mechanic=%s", sr.reference, mechanic.id)
    return True


async def decline_offer(
    db: AsyncSession, sr: ServiceRequest, mechanic: Mechanic
) -> None:
    """Mechanic passes on the job. Leaves the request open for the others."""
    await db.execute(
        update(ServiceRequestOffer)
        .where(
            ServiceRequestOffer.request_id == sr.id,
            ServiceRequestOffer.mechanic_id == mechanic.id,
            ServiceRequestOffer.status == ServiceOfferStatus.offered,
        )
        .values(status=ServiceOfferStatus.declined, responded_at=datetime.now(timezone.utc))
    )
