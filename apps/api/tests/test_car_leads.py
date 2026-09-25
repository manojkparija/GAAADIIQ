"""
New-car leads: capture from a verified buyer, deliver to the right dealer.

The behaviour worth testing here is not "a row was written". It is who can
cause a row to exist, and who can read one afterwards — because a row is a
named person's mobile number, handed to a salesperson.

So the cases below are mostly refusals: an unverified phone, a replayed code,
absent consent, a dealer reading another city, a dealer with no city at all.
"""
import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.dependencies import get_current_user
from db.session import get_db
from main import app
from models.car_lead import CarLead, LeadSource, LeadStatus
from models.dealer import Dealer
from models.user import User, UserRole
from services import otp_store

PHONE = "+919876543210"


@pytest_asyncio.fixture
async def session_factory(db_engine):
    return async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)


@pytest_asyncio.fixture
async def client(session_factory):
    async def override_db():
        async with session_factory() as session:
            yield session
            await session.commit()

    app.dependency_overrides[get_db] = override_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


def as_user(user: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: user


async def live_otp(phone: str = PHONE) -> str:
    """Put a real code in the store, the way /auth/otp/send would."""
    code = otp_store.generate_otp()
    await otp_store.store(phone, code)
    return code


def payload(**over) -> dict:
    body = {
        "phone": PHONE,
        "otp": "000000",
        "city": "Kolkata",
        "locality": "Salt Lake",
        "pincode": "700091",
        "make": "Maruti Suzuki",
        "model": "Fronx",
        "consent": True,
    }
    body.update(over)
    return body


class TestLeadCaptureSuite:
    @pytest.mark.asyncio
    async def test_a_verified_buyer_is_recorded(self, client, session_factory):
        code = await live_otp()

        resp = await client.post("/leads", json=payload(otp=code))

        assert resp.status_code == 201, resp.text
        assert resp.json()["received"] is True

        async with session_factory() as s:
            lead = (await s.execute(__import__("sqlalchemy").select(CarLead))).scalars().one()
        assert lead.phone == PHONE
        assert lead.phone_verified is True
        assert lead.city == "Kolkata"
        assert lead.status is LeadStatus.new
        # Consent is dated, not merely flagged: consent that cannot be dated
        # cannot be shown to have preceded the call.
        assert lead.consented_at is not None

    @pytest.mark.asyncio
    async def test_a_wrong_code_records_nothing(self, client, session_factory):
        await live_otp()

        resp = await client.post("/leads", json=payload(otp="123456"))

        assert resp.status_code == 401
        async with session_factory() as s:
            assert (await s.execute(__import__("sqlalchemy").select(CarLead))).scalars().all() == []

    @pytest.mark.asyncio
    async def test_a_phone_with_no_code_records_nothing(self, client):
        """
        The case that matters: a client simply asserting a number is theirs.

        A number of its own, not the shared PHONE. Without Redis the OTP store
        falls back to an in-process map that outlives a test, so a code stored
        by an earlier case in this class is still live for PHONE and the
        endpoint answers "wrong code" (401) instead of "no code" (400) — which
        would test order, not behaviour.
        """
        untouched = "+919812345678"
        resp = await client.post("/leads", json=payload(phone=untouched, otp="654321"))

        assert resp.status_code == 400
        assert "not found" in resp.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_a_code_cannot_be_replayed_into_a_second_lead(self, client, session_factory):
        """
        The reason this endpoint verifies the OTP itself rather than trusting an
        earlier call to /auth/otp/verify. A correct code is consumed, so one
        verification buys exactly one lead.
        """
        code = await live_otp()
        first = await client.post("/leads", json=payload(otp=code))
        assert first.status_code == 201

        second = await client.post("/leads", json=payload(otp=code))

        assert second.status_code == 400
        async with session_factory() as s:
            leads = (await s.execute(__import__("sqlalchemy").select(CarLead))).scalars().all()
        assert len(leads) == 1

    @pytest.mark.asyncio
    async def test_without_consent_nothing_is_recorded(self, client, session_factory):
        code = await live_otp()

        resp = await client.post("/leads", json=payload(otp=code, consent=False))

        assert resp.status_code == 400
        async with session_factory() as s:
            assert (await s.execute(__import__("sqlalchemy").select(CarLead))).scalars().all() == []

    @pytest.mark.asyncio
    async def test_a_malformed_number_is_refused(self, client):
        resp = await client.post("/leads", json=payload(phone="+911234567890"))
        assert resp.status_code == 422


class TestLeadDeliverySuite:
    """Who gets to read a buyer's phone number."""

    @pytest_asyncio.fixture
    async def seeded(self, session_factory):
        async with session_factory() as s:
            for city in ("Kolkata", "Pune"):
                s.add(
                    CarLead(
                        make="Maruti Suzuki", model="Fronx", city=city,
                        phone=PHONE, phone_verified=True,
                        consented_at=datetime.now(timezone.utc),
                    )
                )
            await s.commit()

    @pytest.mark.asyncio
    async def test_a_dealer_sees_only_their_own_city(self, client, session_factory, seeded):
        user = User(id=uuid.uuid4(), email="d@test.com", hashed_password="x", role=UserRole.dealer)
        async with session_factory() as s:
            s.add(user)
            s.add(Dealer(user_id=user.id, business_name="Kolkata Motors", city="Kolkata"))
            await s.commit()
        as_user(user)

        rows = (await client.get("/leads")).json()

        assert [r["city"] for r in rows] == ["Kolkata"]

    @pytest.mark.asyncio
    async def test_a_dealer_with_no_city_sees_nothing(self, client, session_factory, seeded):
        """
        Not "everything". An unplaced dealer matches no routing rule, and the
        tempting fallback would hand them every buyer's number in the country.
        """
        user = User(id=uuid.uuid4(), email="n@test.com", hashed_password="x", role=UserRole.dealer)
        async with session_factory() as s:
            s.add(user)
            s.add(Dealer(user_id=user.id, business_name="Nowhere Motors", city=None))
            await s.commit()
        as_user(user)

        assert (await client.get("/leads")).json() == []

    @pytest.mark.asyncio
    async def test_a_buyer_cannot_read_leads(self, client, session_factory, seeded):
        user = User(id=uuid.uuid4(), email="b@test.com", hashed_password="x", role=UserRole.buyer)
        async with session_factory() as s:
            s.add(user)
            await s.commit()
        as_user(user)

        assert (await client.get("/leads")).status_code == 403

    @pytest.mark.asyncio
    async def test_an_admin_sees_every_city(self, client, session_factory, seeded):
        user = User(id=uuid.uuid4(), email="a@test.com", hashed_password="x", role=UserRole.admin)
        async with session_factory() as s:
            s.add(user)
            await s.commit()
        as_user(user)

        rows = (await client.get("/leads")).json()

        assert sorted(r["city"] for r in rows) == ["Kolkata", "Pune"]

    @pytest.mark.asyncio
    async def test_a_dealer_cannot_update_another_citys_lead(
        self, client, session_factory, seeded
    ):
        """An id learned from anywhere must not be actionable across cities."""
        import sqlalchemy

        user = User(id=uuid.uuid4(), email="p@test.com", hashed_password="x", role=UserRole.dealer)
        async with session_factory() as s:
            s.add(user)
            s.add(Dealer(user_id=user.id, business_name="Pune Motors", city="Pune"))
            await s.commit()
            other = (
                await s.execute(sqlalchemy.select(CarLead).where(CarLead.city == "Kolkata"))
            ).scalars().one()
        as_user(user)

        resp = await client.patch(f"/leads/{other.id}", json={"status": "contacted"})

        assert resp.status_code == 403


class TestCarDetailEnquirySuite:
    """
    The Contact Seller form records a lead, and carries what the buyer wrote.

    WHAT THIS REPLACED

    car-detail's submitEnquiry used to write straight to Supabase from the
    browser — `from('car_enquiries').insert({ buyer_phone, … })`. The phone
    was whatever somebody typed; the API was bypassed, so phone_verified,
    consented_at and dealer routing never ran; and the row landed in a table
    the dealer inbox does not read. "Get Best Price" next to it was fully
    verified, so the site had two enquiry paths and the unverified one was on
    the button most buyers press.

    Routing it here gets the OTP for free — every guard below already existed
    and now applies to that form too. What did NOT exist was somewhere to put
    the "Any specific questions…" box, which is why `notes` is new: carrying
    the form over without it would have dropped the one part a buyer writes in
    their own words.
    """

    @pytest.mark.asyncio
    async def test_the_question_the_buyer_typed_is_kept(self, client, session_factory):
        code = await live_otp()
        asked = "Is the 2026 model available in Pearl Arctic White, and what is the wait?"

        resp = await client.post(
            "/leads",
            json=payload(otp=code, source="car_detail", notes=asked),
        )

        assert resp.status_code == 201, resp.text
        async with session_factory() as s:
            lead = (await s.execute(__import__("sqlalchemy").select(CarLead))).scalars().one()
        assert lead.notes == asked

    @pytest.mark.asyncio
    async def test_the_enquiry_records_where_it_came_from(self, client, session_factory):
        # The follow-up script differs: someone who clicked "Get Best Price"
        # expects a price, someone who typed a question expects an answer.
        code = await live_otp()

        await client.post("/leads", json=payload(otp=code, source="car_detail"))

        async with session_factory() as s:
            lead = (await s.execute(__import__("sqlalchemy").select(CarLead))).scalars().one()
        assert lead.source is LeadSource.car_detail

    @pytest.mark.asyncio
    async def test_an_enquiry_with_no_question_is_fine(self, client, session_factory):
        # The box is optional, and an empty one must not become the string
        # "None" in a dealer's inbox.
        code = await live_otp()

        resp = await client.post("/leads", json=payload(otp=code, source="car_detail"))

        assert resp.status_code == 201
        async with session_factory() as s:
            lead = (await s.execute(__import__("sqlalchemy").select(CarLead))).scalars().one()
        assert lead.notes is None

    @pytest.mark.asyncio
    async def test_this_form_cannot_skip_the_code_either(self, client, session_factory):
        # The whole point of the move. Before it, this form had no OTP at all.
        await live_otp()

        resp = await client.post(
            "/leads",
            json=payload(otp="123456", source="car_detail", notes="anything"),
        )

        assert resp.status_code >= 400
        async with session_factory() as s:
            rows = (await s.execute(__import__("sqlalchemy").select(CarLead))).scalars().all()
        assert rows == []

    @pytest.mark.asyncio
    async def test_a_question_longer_than_the_column_is_refused(self, client):
        # Refused by name rather than by a 500 from the database.
        code = await live_otp()

        resp = await client.post(
            "/leads",
            json=payload(otp=code, source="car_detail", notes="x" * 2001),
        )

        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_an_enquiry_for_a_car_with_no_catalogue_row(self, client, session_factory):
        # A seller's own listing is not a catalogue car, so car_id is null and
        # make/model carry the vehicle. CarLead allows this deliberately.
        code = await live_otp()

        resp = await client.post(
            "/leads",
            json=payload(otp=code, source="car_detail", car_id=None),
        )

        assert resp.status_code == 201
        async with session_factory() as s:
            lead = (await s.execute(__import__("sqlalchemy").select(CarLead))).scalars().one()
        assert lead.car_id is None
        assert lead.make == "Maruti Suzuki"
