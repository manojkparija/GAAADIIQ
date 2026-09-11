"""
A mechanic cannot register without somewhere to be paid.

WHY THIS MATTERS MORE THAN A BLANK FIELD

Asked directly: how does the mechanic get paid, and do we take their bank
details? Tracing it:

  * the scan-to-pay QR resolves to the PLATFORM's VPA, not the mechanic's
    (routers/service_requests.py, settings.upi_payee_vpa), because that is the
    only mode where commission can be deducted — services/upi.py says so;
  * the customer therefore pays GAADIIQ, and `mechanic_payout_paise` is frozen
    onto the payment row;
  * that share is then settled "out of band". There is no payout code.

So `upi_vpa` is the only recorded destination for a real person's money, and it
was optional and unvalidated. A mechanic could register with it blank or
mistyped, be matched to a job, do the work, and have the driver pay us — with
the money on our side and nowhere to send it. That is discovered with the
repair finished and the person owed standing next to the car.

`bank_account_last4` and `bank_ifsc` do not help: they exist as columns but
nothing writes them, and last-four digits cannot receive a payment anyway.

WHAT THESE TESTS DO NOT CLAIM

That the id is real. Only a payout or a verification API can establish that,
and neither exists here yet. The format check narrows the failure; it does not
close it.
"""
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from db.session import get_db
from main import app
from services import kyc

# Verhoeff-valid, generated for the tests — not a real allocation.
VALID_AADHAAR = "234567890124"


@pytest_asyncio.fixture
async def client(db_engine):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


def _payload(**overrides) -> dict:
    payload = {
        "full_name": "Ramesh Sahoo",
        "phone": "9876543210",
        "address_line1": "Plot 42, Nayapalli",
        "city": "Bhubaneswar",
        "state": "Odisha",
        "area_pincode": "751012",
        "latitude": 20.33,
        "longitude": 85.8245,
        "pan_number": "ABCDE1234F",
        "aadhaar_number": VALID_AADHAAR,
        "upi_vpa": "ramesh@okaxis",
    }
    payload.update(overrides)
    return payload


# ── the validator ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw", [
    "9876543210@okaxis",
    "name.surname@oksbi",
    "shop-42@ybl",
    "a1@paytm",
    "mechanic_01@upi",
])
def test_a_real_looking_vpa_is_accepted(raw):
    # Deliberately permissive: NPCI publishes no pattern for the handle and
    # PSPs differ on what they issue, so anything a provider might plausibly
    # hand out has to pass.
    assert kyc.normalise_upi_vpa(raw) == raw


@pytest.mark.parametrize("raw", [
    "",
    "   ",
    None,
])
def test_a_missing_vpa_is_refused_and_says_why(raw):
    # The message is the point. "Field required" tells a mechanic nothing;
    # this has to say what the field is for.
    with pytest.raises(kyc.KycError) as exc:
        kyc.normalise_upi_vpa(raw)
    assert "payout" in str(exc.value).lower()


@pytest.mark.parametrize("raw", [
    "9876543210",          # no @ at all — a phone number typed by mistake
    "@okaxis",             # no handle
    "name@",               # no provider
    "name@@okaxis",        # a second @
    "name@okaxis.",        # trailing dot on the provider
    "name@.okaxis",        # provider starts on a separator
    "name space@okaxis",   # an interior space survives the strip
])
def test_the_mistakes_a_typed_id_actually_suffers_are_refused(raw):
    with pytest.raises(kyc.KycError):
        kyc.normalise_upi_vpa(raw)


def test_it_is_normalised_the_way_pan_is():
    # Case and stray spaces are the difference between two rows that are the
    # same destination. PAN is upper-cased on the way in for the same reason.
    assert kyc.normalise_upi_vpa("  Name@OkAxis  ") == "name@okaxis"


def test_a_long_id_is_still_allowed_up_to_the_column():
    # The column is varchar(120) and the schema caps at 120; the validator must
    # not impose a tighter limit of its own and reject a legitimate id.
    handle = "a" * 100
    assert kyc.normalise_upi_vpa(f"{handle}@okaxis") == f"{handle}@okaxis"


# ── the endpoint ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_registration_refuses_a_mechanic_with_no_payout_destination(client):
    # The one that proves the validator is actually in the path. Without this,
    # everything above could pass while the endpoint kept accepting a blank.
    r = await client.post("/mechanics", json=_payload(upi_vpa=""))

    assert r.status_code == 422
    assert "payout" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_registration_refuses_a_mistyped_id(client):
    # A phone number in the UPI box is the mistake this most expects.
    r = await client.post("/mechanics", json=_payload(upi_vpa="9876543210"))

    assert r.status_code == 422
    assert "name@bank" in r.json()["detail"]


@pytest.mark.asyncio
async def test_registration_still_succeeds_with_a_valid_id(client):
    # The path that must NOT have changed. Everything else about registering —
    # KYC, geo, specialisations, the pending_verification status — is untouched.
    r = await client.post("/mechanics", json=_payload())

    assert r.status_code in (200, 201)
    assert r.json()["upi_vpa"] == "ramesh@okaxis"


@pytest.mark.asyncio
async def test_the_stored_id_is_normalised(client):
    # Two rows differing only in case are the same destination; storing both
    # spellings makes reconciliation against a bank statement harder later.
    r = await client.post("/mechanics", json=_payload(upi_vpa="  Ramesh@OkAxis "))

    assert r.status_code in (200, 201)
    assert r.json()["upi_vpa"] == "ramesh@okaxis"


# ── what this deliberately does NOT do ──────────────────────────────────────

def test_it_does_not_pretend_to_verify_the_id_exists():
    # A well-formed id for an account nobody owns passes, and must: the only
    # things that could tell us otherwise are a payout or a verification API,
    # and neither is in this codebase. Stated as a test so the limit is not
    # mistaken for a gap later.
    assert kyc.normalise_upi_vpa("definitely-not-a-real-person@okaxis")
