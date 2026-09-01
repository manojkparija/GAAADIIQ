"""The loan admin queue: reaching the person who applied.

Selecting a lender writes `selected_offer_id` and sets the status to
`partner_selected`. That is its entire effect — no application is forwarded to
the bank, no email is sent, nothing is exported — so until a hand-off exists,
someone ringing the applicant is the only way they hear back at all.

`GET /loans/admin/applications` had existed since the feature was built, but it
returned neither an email nor a city, and nothing in the app called it. The
details of an applicant were therefore reachable only by querying Postgres by
hand. These tests pin the fields that make an offline call possible, and the
two things that must NOT follow from adding them: the full PAN stays out of the
response, and the queue stays admin-only.
"""
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.config import settings
from core.dependencies import get_admin_user
from db.session import get_db
from main import app
from models.lending_partner import CreditBand, LenderRateSlab, LendingPartner
from models.user import User, UserRole


def _partner(slug: str) -> LendingPartner:
    p = LendingPartner(
        name=slug.upper(), slug=slug,
        min_loan_amount=100000, max_loan_amount=5000000,
        min_tenure_months=12, max_tenure_months=84,
        min_monthly_income=25000, min_credit_score=700,
        max_ltv_pct=85, max_foir_pct=50,
        finances_used_cars=True, max_vehicle_age_years=10,
        processing_fee_pct=0.5, processing_fee_min=1000, processing_fee_max=10000,
        sort_order=0,
    )
    p.rate_slabs = [
        LenderRateSlab(credit_band=CreditBand.excellent, annual_rate_pct=8.45),
        LenderRateSlab(credit_band=CreditBand.unknown, annual_rate_pct=10.5),
    ]
    return p


@pytest_asyncio.fixture
async def client(db_engine):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c, session_factory
    app.dependency_overrides.clear()


def _as_admin():
    app.dependency_overrides[get_admin_user] = lambda: User(
        email="admin@gaadiiq.test", role=UserRole.admin, is_active=True, is_verified=True,
    )


async def _apply(c: AsyncClient, session_factory, **overrides) -> tuple[dict, str]:
    async with session_factory() as db:
        db.add(_partner("bank-a"))
        await db.commit()

    reg = await c.post("/auth/register", json={"email": "applicant@example.com", "password": "pass1234"})
    token = reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    payload = {
        "vehicle_condition": "new",
        "vehicle_description": "Maruti Suzuki Fronx",
        "vehicle_price": 1000000,
        "applicant_name": "Manoj Kumar",
        "mobile": "9876500011",
        "email": "manoj@example.com",
        "city": "Bhubaneswar",
        "pincode": "751024",
        "pan_number": "ABCDE1234F",
        "employment_type": "salaried",
        "monthly_income": 90000,
        "existing_emi": 0,
        "down_payment": 175000,
        "loan_amount": 825000,
        "tenure_months": 60,
        "credit_consent": True,
    }
    payload.update(overrides)
    created = await c.post("/loans/applications", json=payload, headers=headers)
    assert created.status_code == 201, created.text
    return created.json(), token


@pytest.mark.asyncio
async def test_the_queue_carries_what_you_need_to_ring_them(client):
    c, session_factory = client
    await _apply(c, session_factory)
    _as_admin()

    rows = await c.get("/loans/admin/applications")
    assert rows.status_code == 200, rows.text
    row = rows.json()[0]

    # The point of the endpoint. Without these an admin cannot make the call.
    assert row["applicant_name"] == "Manoj Kumar"
    assert row["mobile"] == "9876500011"
    assert row["email"] == "manoj@example.com"
    assert row["city"] == "Bhubaneswar"
    assert row["pincode"] == "751024"


@pytest.mark.asyncio
async def test_the_queue_never_carries_the_full_pan(client):
    # Adding contact details must not turn this into a list of everyone's PAN.
    c, session_factory = client
    await _apply(c, session_factory)
    _as_admin()

    rows = await c.get("/loans/admin/applications")
    body = rows.text

    assert "ABCDE1234F" not in body
    assert rows.json()[0]["pan_masked"] == "ABCDE****F"


@pytest.mark.asyncio
async def test_it_names_the_lender_they_chose(client):
    # selected_offer_id alone would make the queue cross-reference every row
    # against its offers to answer "who did they pick?".
    c, session_factory = client
    created, token = await _apply(c, session_factory)
    offer = created["offers"][0]
    picked = await c.post(
        f"/loans/applications/{created['id']}/select",
        json={"offer_id": offer["id"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert picked.status_code == 200, picked.text
    _as_admin()

    row = (await c.get("/loans/admin/applications")).json()[0]
    assert row["selected_partner_name"] == offer["partner"]["name"]
    assert row["status"] == "partner_selected"


@pytest.mark.asyncio
async def test_an_application_with_no_lender_yet_says_so(client):
    c, session_factory = client
    await _apply(c, session_factory)
    _as_admin()

    row = (await c.get("/loans/admin/applications")).json()[0]
    assert row["selected_partner_name"] is None


@pytest.mark.asyncio
async def test_consent_is_visible_so_a_call_can_be_justified(client):
    # Ringing someone about a credit product is defensible when they asked for
    # it. The timestamp is that record.
    c, session_factory = client
    await _apply(c, session_factory)
    _as_admin()

    row = (await c.get("/loans/admin/applications")).json()[0]
    assert row["credit_consent_at"] is not None


@pytest.mark.asyncio
async def test_in_production_a_signed_out_caller_gets_nothing(client, monkeypatch):
    """The queue is admin-only where it matters.

    Note what this test has to do to assert that. Outside production,
    `get_admin_user` hands a caller with NO credentials a synthetic admin user
    (core/dependencies.py) — so an unauthenticated GET to this endpoint returns
    200 and a full list of applicants' names, phone numbers and emails on any
    non-production deployment. That predates this queue and applies to every
    admin endpoint, so it is not changed here, but it is worth stating plainly:
    the only thing standing between a staging URL and every applicant's contact
    details is the `environment` setting.
    """
    c, session_factory = client
    await _apply(c, session_factory)
    app.dependency_overrides.pop(get_admin_user, None)
    monkeypatch.setattr(settings, "environment", "production")

    r = await c.get("/loans/admin/applications")
    assert r.status_code in (401, 403), r.text
    assert "manoj@example.com" not in r.text
