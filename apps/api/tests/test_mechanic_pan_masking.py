"""A PAN never leaves this API in full.

The rule is in CLAUDE.md: PAN is stored, because a lender cannot act on a hash,
but it is never returned — every response carries `ABCDE****F`.

`MechanicOut` returned the stored number instead, on all six endpoints that use
it, including the admin listing that hands back up to 200 records at once. The
mistake is interesting because of how much already said it was wrong and never
checked: `loan_applications.py` emits `pan_masked`; `schemas/mechanic.py` opens
with a docstring claiming no response model in it can emit a PAN; and the
Angular admin screen's own test fixture is the literal string "ABCDE****F".
Four statements of the rule, one line that broke it, and nothing comparing them.

Aadhaar is asserted alongside because the two travel together on this model and
the Aadhaar half was always right — a test that pins only the broken one invites
a later "fix" that regresses the other.
"""
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.dependencies import get_admin_user, get_current_user
from db.session import get_db
from main import app
from models.mechanic import Mechanic, MechanicStatus
from models.user import User, UserRole
from services import kyc

PAN = "ABCDE1234F"
MASKED = "ABCDE****F"


@pytest_asyncio.fixture
async def client(db_engine):
    factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)

    async def override_db():
        async with factory() as session:
            yield session
            await session.commit()

    admin = User(
        id=uuid.uuid4(), email="admin@gaadiiq.test", hashed_password="x",
        role=UserRole.admin, is_active=True, is_verified=True,
    )
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_admin_user] = lambda: admin
    app.dependency_overrides[get_current_user] = lambda: admin
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c, factory
    app.dependency_overrides.clear()


async def _mechanic(factory) -> uuid.UUID:
    # phone and aadhaar_hash are both unique — one Aadhaar belongs to one
    # mechanic — so each record needs its own. The listing test inserts two.
    unique = uuid.uuid4().int
    phone = f"9{unique % 10**9:09d}"
    aadhaar = f"{unique % 10**12:012d}"
    async with factory() as db:
        m = Mechanic(
            full_name="R. Kumar", shop_name="Kumar Auto Works",
            phone=phone, whatsapp_phone=phone,
            address_line1="12 GT Road", city="Kolkata", state="West Bengal",
            area_pincode="700001", service_radius_km=10,
            pan_number=PAN,
            aadhaar_last4=aadhaar[-4:],
            aadhaar_hash=kyc.aadhaar_digest(aadhaar),
            specialisations=["engine"],
            status=MechanicStatus.pending_verification,
        )
        db.add(m)
        await db.commit()
        return m.id


@pytest.mark.asyncio
async def test_the_full_record_masks_the_pan(client):
    c, factory = client
    mid = await _mechanic(factory)

    body = (await c.get(f"/mechanics/{mid}")).json()

    assert body["pan_number"] == MASKED
    assert PAN not in str(body), "the stored PAN appears somewhere in the response"


@pytest.mark.asyncio
async def test_the_admin_listing_masks_every_row(client):
    """The worst case: one request, many people's PANs.

    A single number leaking to the person it belongs to is a smaller thing than
    a listing endpoint returning two hundred of them to any admin session — and
    outside production `get_admin_user` hands a credential-less caller a
    synthetic admin, so the two faults compound.
    """
    c, factory = client
    await _mechanic(factory)
    await _mechanic(factory)

    body = (await c.get("/mechanics")).json()

    assert len(body) >= 2
    assert all(row["pan_number"] == MASKED for row in body)
    assert PAN not in str(body)


@pytest.mark.asyncio
async def test_the_aadhaar_fragment_is_still_only_a_fragment(client):
    # Aadhaar was always handled correctly here. Pinned so a change to the PAN
    # line cannot quietly take it with it.
    c, factory = client
    mid = await _mechanic(factory)

    body = (await c.get(f"/mechanics/{mid}")).json()
    async with factory() as db:
        stored = await db.get(Mechanic, mid)

    assert body["aadhaar_masked"].endswith(stored.aadhaar_last4)
    # The digest is not a number, but it must not travel either.
    assert stored.aadhaar_hash not in str(body)


@pytest.mark.asyncio
async def test_masking_survives_a_stored_value_of_the_wrong_shape(client):
    # mask_pan returns "****" rather than raising for anything that is not ten
    # characters. A record written before validation existed must not fall
    # through to the raw value.
    c, factory = client
    async with factory() as db:
        m = Mechanic(
            full_name="Odd Record", shop_name="Legacy", phone="9000000000",
            address_line1="1 Old St", city="Kolkata", state="West Bengal",
            area_pincode="700001", service_radius_km=5,
            pan_number="SHORT", aadhaar_last4="0000",
            aadhaar_hash=kyc.aadhaar_digest("999941057100"),
            status=MechanicStatus.pending_verification,
        )
        db.add(m)
        await db.commit()
        mid = m.id

    body = (await c.get(f"/mechanics/{mid}")).json()

    assert body["pan_number"] == "****"
    assert "SHORT" not in str(body)
