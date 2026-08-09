"""Roadside repair marketplace: mechanic KYC, matching, commission, receipts.

Dev mode is active throughout (no Razorpay or WhatsApp credentials in the test
environment), so payments auto-approve and WhatsApp sends are recorded without an
outbound call.
"""

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from db.session import get_db
from main import app
from models.mechanic import Mechanic, MechanicStatus
from models.payment import Payment, PaymentPurpose, PaymentStatus
from models.whatsapp_message import WhatsAppMessage, WhatsAppStatus, WhatsAppTemplate
from services.commission import calculate_commission
from services.geo import haversine_km
from services.kyc import KycError, normalise_aadhaar, normalise_pan

# Verhoeff-valid Aadhaar numbers. Generated for the tests — these are not real
# allocations, and the checksum is the only property that matters here.
VALID_AADHAAR = "234567890124"
VALID_AADHAAR_2 = "345678901238"

# Bhubaneswar city centre, and a point ~4km away.
LAT, LNG = 20.2961, 85.8245
NEAR_LAT, NEAR_LNG = 20.3300, 85.8245


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
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def session_factory(db_engine):
    return async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)


async def _token(client: AsyncClient, email: str) -> str:
    r = await client.post("/auth/register", json={"email": email, "password": "pass1234"})
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"]


def _mechanic_payload(**overrides) -> dict:
    payload = {
        "full_name": "Ramesh Sahoo",
        "shop_name": "Sahoo Auto Works",
        "phone": "9876543210",
        "address_line1": "Plot 42, Nayapalli",
        "city": "Bhubaneswar",
        "state": "Odisha",
        "area_pincode": "751012",
        "latitude": NEAR_LAT,
        "longitude": NEAR_LNG,
        "pan_number": "ABCDE1234F",
        "aadhaar_number": VALID_AADHAAR,
        "upi_vpa": "ramesh@okaxis",
        "specialisations": ["engine", "general"],
    }
    payload.update(overrides)
    return payload


async def _register_active_mechanic(client: AsyncClient, session_factory, **overrides) -> str:
    """Register a mechanic and push it straight to `active`.

    Verification goes through the DB rather than the admin endpoint because the
    dev-admin dependency short-circuits without a token, which would not exercise
    anything meaningful here.
    """
    r = await client.post("/mechanics", json=_mechanic_payload(**overrides))
    assert r.status_code == 201, r.text
    mechanic_id = r.json()["id"]

    async with session_factory() as s:
        m = await s.get(Mechanic, __import__("uuid").UUID(mechanic_id))
        m.status = MechanicStatus.active
        await s.commit()
    return mechanic_id


# ── KYC ──────────────────────────────────────────────────────────────────────


def test_pan_must_match_the_income_tax_format():
    assert normalise_pan("abcde1234f") == "ABCDE1234F"
    with pytest.raises(KycError):
        normalise_pan("ABCD1234F")     # too short
    with pytest.raises(KycError):
        normalise_pan("12345ABCDE")    # digits and letters transposed
    with pytest.raises(KycError):
        normalise_pan(None)


def test_aadhaar_is_mandatory_and_checksummed():
    assert normalise_aadhaar(f"{VALID_AADHAAR[:4]} {VALID_AADHAAR[4:8]} {VALID_AADHAAR[8:]}") == VALID_AADHAAR

    with pytest.raises(KycError, match="required"):
        normalise_aadhaar("")
    with pytest.raises(KycError):
        normalise_aadhaar("123456789012")   # starts with 1
    with pytest.raises(KycError, match="checksum"):
        normalise_aadhaar("234567890123")   # right shape, wrong check digit


@pytest.mark.asyncio
async def test_registration_is_rejected_without_aadhaar(client):
    payload = _mechanic_payload()
    del payload["aadhaar_number"]
    r = await client.post("/mechanics", json=payload)
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_registration_never_stores_the_aadhaar_number(client, session_factory):
    r = await client.post("/mechanics", json=_mechanic_payload())
    assert r.status_code == 201, r.text
    body = r.json()

    # The response carries only the masked fragment.
    assert body["aadhaar_masked"] == "XXXX XXXX 0124"
    assert VALID_AADHAAR not in r.text

    # And so does the row: no column anywhere holds the digits.
    async with session_factory() as s:
        m = (await s.execute(select(Mechanic))).scalar_one()
        assert m.aadhaar_last4 == "0124"
        assert len(m.aadhaar_hash) == 64
        stored = " ".join(str(v) for v in m.__dict__.values() if v is not None)
        assert VALID_AADHAAR not in stored


@pytest.mark.asyncio
async def test_duplicate_aadhaar_is_refused_without_confirming_why(client):
    assert (await client.post("/mechanics", json=_mechanic_payload())).status_code == 201
    # Same Aadhaar, different phone — must still collide on the digest.
    r = await client.post("/mechanics", json=_mechanic_payload(phone="9876500000"))
    assert r.status_code == 409
    # The message must not reveal which field matched.
    assert "aadhaar" not in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_new_registrations_are_not_matchable_until_verified(client):
    await client.post("/mechanics", json=_mechanic_payload())
    r = await client.get("/mechanics/nearby", params={"latitude": LAT, "longitude": LNG})
    assert r.status_code == 200
    assert r.json() == []


# ── Geo matching ─────────────────────────────────────────────────────────────


def test_haversine_matches_a_known_distance():
    # Bhubaneswar → Cuttack, ~22km apart.
    d = haversine_km(20.2961, 85.8245, 20.4625, 85.8830)
    assert 18 < d < 26


@pytest.mark.asyncio
async def test_nearby_returns_active_mechanics_with_distance(client, session_factory):
    await _register_active_mechanic(client, session_factory)
    r = await client.get("/mechanics/nearby", params={"latitude": LAT, "longitude": LNG})
    assert r.status_code == 200, r.text
    results = r.json()
    assert len(results) == 1
    assert results[0]["full_name"] == "Ramesh Sahoo"
    assert 0 < results[0]["distance_km"] < 6


@pytest.mark.asyncio
async def test_nearby_excludes_mechanics_beyond_the_radius(client, session_factory):
    # ~500km south — inside no sane search radius.
    await _register_active_mechanic(client, session_factory, latitude=15.5, longitude=80.0)
    r = await client.get("/mechanics/nearby", params={"latitude": LAT, "longitude": LNG})
    assert r.json() == []


@pytest.mark.asyncio
async def test_nearby_hides_kyc_fields_from_customers(client, session_factory):
    await _register_active_mechanic(client, session_factory)
    r = await client.get("/mechanics/nearby", params={"latitude": LAT, "longitude": LNG})
    result = r.json()[0]
    assert "pan_number" not in result
    assert "aadhaar_masked" not in result
    assert "aadhaar_hash" not in result


# ── Commission ───────────────────────────────────────────────────────────────


def test_commission_split_always_reconciles_to_the_gross():
    for gross in (10000, 49900, 240000, 1_000_000, 3_333_333):
        split = calculate_commission(gross)
        assert split.commission_paise + split.mechanic_payout_paise == gross


def test_commission_takes_ten_percent_in_the_normal_band():
    split = calculate_commission(240000)  # ₹2,400
    assert split.commission_paise == 24000  # ₹240
    assert split.mechanic_payout_paise == 216000
    assert split.effective_rate_pct == 10.0


def test_small_jobs_hit_the_floor_and_large_jobs_hit_the_cap():
    # ₹200 job: 10% would be ₹20, below the ₹49 floor.
    small = calculate_commission(20000)
    assert small.commission_paise == 4900

    # ₹60,000 job: 10% would be ₹6,000, above the ₹2,500 cap.
    large = calculate_commission(6_000_000)
    assert large.commission_paise == 250000


def test_a_job_below_the_floor_never_leaves_the_mechanic_owing_money():
    split = calculate_commission(3000)  # ₹30, less than the ₹49 floor
    assert split.commission_paise == 3000
    assert split.mechanic_payout_paise == 0


# ── End-to-end job flow ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_service_request_normalises_the_car_number(client):
    token = await _token(client, "driver1@test.com")
    r = await client.post(
        "/service-requests",
        json={
            "car_number": "od 02 ab 1234",
            "latitude": LAT,
            "longitude": LNG,
            "problem_summary": "Engine overheating and losing power on the highway",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["car_number"] == "OD02AB1234"
    assert r.json()["reference"].startswith("SR-")


@pytest.mark.asyncio
async def test_a_nonsense_car_number_is_rejected(client):
    token = await _token(client, "driver2@test.com")
    r = await client.post(
        "/service-requests",
        json={
            "car_number": "NOTACAR",
            "latitude": LAT,
            "longitude": LNG,
            "problem_summary": "Something is wrong with the car",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_full_flow_raises_matches_quotes_pays_and_sends_a_receipt(client, session_factory):
    mechanic_id = await _register_active_mechanic(client, session_factory)
    token = await _token(client, "driver3@test.com")
    auth = {"Authorization": f"Bearer {token}"}

    created = await client.post(
        "/service-requests",
        json={
            "car_number": "OD02AB1234",
            "manufacturer": "Hyundai",
            "model": "i20",
            "latitude": LAT,
            "longitude": LNG,
            "problem_summary": "Clutch slipping badly, cannot engage third gear",
            "severity": "high",
        },
        headers=auth,
    )
    assert created.status_code == 201, created.text
    sr_id = created.json()["id"]

    # The nearby list is scoped to this job's own coordinates.
    nearby = await client.get(f"/service-requests/{sr_id}/mechanics", headers=auth)
    assert nearby.status_code == 200, nearby.text
    assert [m["id"] for m in nearby.json()] == [mechanic_id]

    assigned = await client.post(
        f"/service-requests/{sr_id}/assign", json={"mechanic_id": mechanic_id}, headers=auth
    )
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["status"] == "assigned"
    assert assigned.json()["mechanic"]["full_name"] == "Ramesh Sahoo"
    assert assigned.json()["matched_distance_km"] > 0

    # Quote returns the split so the mechanic sees their take-home up front.
    quoted = await client.post(
        f"/service-requests/{sr_id}/quote", json={"amount_paise": 240000}, headers=auth
    )
    assert quoted.status_code == 200, quoted.text
    assert quoted.json() == {
        "gross_paise": 240000,
        "commission_paise": 24000,
        "mechanic_payout_paise": 216000,
        "commission_rate_bps": 1000,
        "effective_rate_pct": 10.0,
    }

    pay = await client.post(f"/service-requests/{sr_id}/pay", headers=auth)
    assert pay.status_code == 200, pay.text
    assert pay.json()["amount_paise"] == 240000
    assert pay.json()["razorpay_order_id"].startswith("dev_order_")

    verified = await client.post(f"/service-requests/{sr_id}/pay/verify", json={}, headers=auth)
    assert verified.status_code == 200, verified.text
    assert verified.json()["status"] == "paid"
    assert verified.json()["final_amount_paise"] == 240000

    # The split is frozen onto the payment row, not recomputed on read.
    async with session_factory() as s:
        payment = (await s.execute(select(Payment))).scalar_one()
        assert payment.purpose == PaymentPurpose.service_request
        assert payment.status == PaymentStatus.paid
        assert payment.commission_paise == 24000
        assert payment.mechanic_payout_paise == 216000
        assert payment.commission_rate_bps == 1000

        # The mechanic's completed-job counter moved exactly once.
        mechanic = (await s.execute(select(Mechanic))).scalar_one()
        assert mechanic.jobs_completed == 1


@pytest.mark.asyncio
async def test_paying_sends_one_whatsapp_receipt_even_if_verify_is_replayed(
    client, session_factory
):
    mechanic_id = await _register_active_mechanic(client, session_factory)
    token = await _token(client, "driver4@test.com")
    auth = {"Authorization": f"Bearer {token}"}

    created = await client.post(
        "/service-requests",
        json={
            "car_number": "OD02AB1234",
            "latitude": LAT,
            "longitude": LNG,
            "contact_phone": "9812345678",
            "problem_summary": "Alternator failure, battery not charging",
        },
        headers=auth,
    )
    sr_id = created.json()["id"]
    await client.post(
        f"/service-requests/{sr_id}/assign", json={"mechanic_id": mechanic_id}, headers=auth
    )
    await client.post(f"/service-requests/{sr_id}/quote", json={"amount_paise": 500000}, headers=auth)
    await client.post(f"/service-requests/{sr_id}/pay", headers=auth)

    first = await client.post(f"/service-requests/{sr_id}/pay/verify", json={}, headers=auth)
    assert first.status_code == 200, first.text

    async with session_factory() as s:
        messages = (await s.execute(select(WhatsAppMessage))).scalars().all()

    assert len(messages) == 1
    msg = messages[0]
    assert msg.template == WhatsAppTemplate.payment_receipt
    assert msg.status == WhatsAppStatus.sent       # dev mode: no outbound call
    assert msg.to_phone == "919812345678"          # the customer, normalised to E.164
    assert msg.idempotency_key == f"receipt:{msg.payment_id}"
    assert msg.variables["2"] == "₹5,000.00"

    # Razorpay replays webhooks on any ambiguous response; a second verify must
    # not produce a second receipt.
    await client.post(f"/service-requests/{sr_id}/pay/verify", json={}, headers=auth)
    async with session_factory() as s:
        assert len((await s.execute(select(WhatsAppMessage))).scalars().all()) == 1


@pytest.mark.asyncio
async def test_cannot_pay_before_a_quote_exists(client, session_factory):
    token = await _token(client, "driver5@test.com")
    auth = {"Authorization": f"Bearer {token}"}
    created = await client.post(
        "/service-requests",
        json={
            "car_number": "OD02AB1234",
            "latitude": LAT,
            "longitude": LNG,
            "problem_summary": "Brakes making a grinding noise",
        },
        headers=auth,
    )
    r = await client.post(f"/service-requests/{created.json()['id']}/pay", headers=auth)
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_one_user_cannot_read_another_users_service_request(client):
    owner = await _token(client, "owner@test.com")
    created = await client.post(
        "/service-requests",
        json={
            "car_number": "OD02AB1234",
            "latitude": LAT,
            "longitude": LNG,
            "problem_summary": "Suspension knocking over speed breakers",
        },
        headers={"Authorization": f"Bearer {owner}"},
    )
    sr_id = created.json()["id"]

    intruder = await _token(client, "intruder@test.com")
    r = await client.get(
        f"/service-requests/{sr_id}", headers={"Authorization": f"Bearer {intruder}"}
    )
    assert r.status_code == 403
