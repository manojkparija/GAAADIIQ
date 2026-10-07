"""
A code that cannot be delivered is never stored, and the reader is told so.

REPORTED by reading the production dashboard: MSG91_AUTH_KEY has no value, and
ENVIRONMENT is production. Confirmed by the person who runs it — "No OTP has
never worked or never tested". So every /auth/otp/send in production has taken
the else branch of _send_sms and raised.

WHAT THAT COST, BEYOND THE OBVIOUS

The send was attempted AFTER the code was stored, so each failed call:

  * returned a bare 500, which tells a reader nothing they can act on;
  * left a code in the store, counting toward the five-attempt cap on a
    number whose owner never received anything;
  * spent one of that caller's five sends an hour on a message that was
    never going to arrive.

The order is now send-then-store, and the answer is a 503 that says SMS is
unavailable. None of this makes OTP work — that needs a real MSG91 key, which
is a dashboard value — but it stops the failure being silent, lossy and
misattributed.
"""
import os

import pytest
from fastapi import status
from httpx import ASGITransport, AsyncClient

from core.config import settings
from main import app
from routers import otp as otp_router
from services import otp_store


@pytest.fixture
async def client():
    """The OTP endpoints touch no database, so no session override is needed."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


@pytest.fixture
def stored(monkeypatch) -> list:
    """Records every code the endpoint decides to keep."""
    kept: list = []

    async def _store(phone, otp, *a, **k):
        kept.append((phone, otp))

    monkeypatch.setattr(otp_store, "store", _store)
    return kept


def _as_production(monkeypatch, *, key: str = "") -> None:
    """Production, with MSG91 configured or not."""
    monkeypatch.setattr(
        type(settings), "is_production", property(lambda _self: True), raising=False
    )
    monkeypatch.setitem(os.environ, "MSG91_AUTH_KEY", key)


async def test_an_unsendable_code_is_never_stored(client, stored, monkeypatch):
    # THE REPORTED STATE: production, no key. The caller must not be left with
    # a code in the store they cannot possibly have received.
    _as_production(monkeypatch)

    response = await client.post("/auth/otp/send", json={"phone": "+919876543210"})

    assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert stored == [], "a code was stored for an SMS that could not be sent"


async def test_the_reader_is_told_sms_is_unavailable_not_given_a_500(
    client, stored, monkeypatch
):
    # A 500 says "we broke"; this says what happened and that trying again
    # later is the right move.
    _as_production(monkeypatch)

    response = await client.post("/auth/otp/send", json={"phone": "+919876543210"})

    assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert "SMS" in response.json()["detail"]


async def test_the_missing_key_is_not_named_in_the_response(
    client, stored, monkeypatch
):
    # The reader cannot act on it and it is not theirs to know; it goes to the
    # log instead.
    _as_production(monkeypatch)

    body = (
        await client.post("/auth/otp/send", json={"phone": "+919876543210"})
    ).text

    assert "MSG91" not in body
    assert "AUTH_KEY" not in body


async def test_an_upstream_failure_is_also_a_503_and_stores_nothing(
    client, stored, monkeypatch
):
    # MSG91 reachable but refusing — a different cause, the same thing to the
    # reader, and the same requirement not to keep an undeliverable code.
    _as_production(monkeypatch, key="real-looking-key")

    async def _boom(*_a, **_k):
        raise RuntimeError("MSG91 returned HTTP 402")

    monkeypatch.setattr(otp_router, "_send_sms", _boom)

    response = await client.post("/auth/otp/send", json={"phone": "+919876543210"})

    assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert stored == []


async def test_a_successful_send_still_stores_the_code(client, stored, monkeypatch):
    # The fix must not break the path that is meant to work: the store still
    # happens, just after the send rather than before it.
    _as_production(monkeypatch, key="real-looking-key")

    async def _ok(*_a, **_k):
        return None

    monkeypatch.setattr(otp_router, "_send_sms", _ok)

    response = await client.post("/auth/otp/send", json={"phone": "+919876543210"})

    assert response.status_code == status.HTTP_200_OK
    assert len(stored) == 1


async def test_a_six_digit_code_is_what_would_have_been_sent(
    client, stored, monkeypatch
):
    # Pins that reordering did not change what gets generated or stored.
    _as_production(monkeypatch, key="real-looking-key")

    async def _ok(*_a, **_k):
        return None

    monkeypatch.setattr(otp_router, "_send_sms", _ok)

    await client.post("/auth/otp/send", json={"phone": "+919876543210"})

    phone, code = stored[0]
    assert phone == "+919876543210"
    assert len(code) == 6 and code.isdigit()
