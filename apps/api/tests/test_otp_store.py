"""Phone-login OTP storage: hashed, expiring, attempt-capped.

The property worth testing here is not "a correct code verifies" — that would
pass against the plaintext dict this replaced. It is that a *wrong* code stops
working after a bounded number of guesses, and that the stored value does not
contain the code.
"""

import time

import pytest

from services import otp_store


@pytest.fixture(autouse=True)
def _clean_store():
    otp_store._reset_for_tests()
    yield
    otp_store._reset_for_tests()


PHONE = "+919876543210"


def test_generated_otp_is_six_digits_and_spread():
    codes = {otp_store.generate_otp() for _ in range(200)}
    assert all(len(c) == 6 and c.isdigit() for c in codes)
    assert len(codes) > 190


def test_stored_value_does_not_contain_the_code():
    """The whole point of the change: the dict used to hold the code itself."""
    digest = otp_store._digest(PHONE, "123456")
    assert "123456" not in digest
    assert len(digest) == 64


def test_digest_is_scoped_to_the_phone_number():
    """A code seen for one number must not verify against another."""
    assert otp_store._digest("+919000000001", "123456") != otp_store._digest(
        "+919000000002", "123456"
    )


@pytest.mark.asyncio
async def test_correct_code_verifies_once_then_is_consumed():
    await otp_store.store(PHONE, "123456")
    assert await otp_store.verify(PHONE, "123456") is True
    # Replay must fail: a captured code should not be reusable.
    with pytest.raises(otp_store.OtpNotFound):
        await otp_store.verify(PHONE, "123456")


@pytest.mark.asyncio
async def test_wrong_code_is_rejected_without_consuming_the_real_one():
    await otp_store.store(PHONE, "123456")
    assert await otp_store.verify(PHONE, "000000") is False
    assert await otp_store.verify(PHONE, "123456") is True


@pytest.mark.asyncio
async def test_guessing_is_capped():
    """The finding this module exists for: unlimited guesses against 6 digits."""
    await otp_store.store(PHONE, "123456")

    for _ in range(otp_store.MAX_ATTEMPTS):
        assert await otp_store.verify(PHONE, "000000") is False

    with pytest.raises(otp_store.OtpAttemptsExhausted):
        await otp_store.verify(PHONE, "000000")

    # And the real code is burned too — an attacker must not be able to exhaust
    # the cap and then have the legitimate holder's code still standing.
    with pytest.raises(otp_store.OtpNotFound):
        await otp_store.verify(PHONE, "123456")


@pytest.mark.asyncio
async def test_attempts_reset_when_a_new_code_is_sent():
    await otp_store.store(PHONE, "111111")
    for _ in range(3):
        await otp_store.verify(PHONE, "000000")
    assert await otp_store.attempts_remaining(PHONE) == otp_store.MAX_ATTEMPTS - 3

    await otp_store.store(PHONE, "222222")
    assert await otp_store.attempts_remaining(PHONE) == otp_store.MAX_ATTEMPTS
    assert await otp_store.verify(PHONE, "222222") is True


@pytest.mark.asyncio
async def test_expired_code_is_not_accepted(monkeypatch):
    """Exercises the in-process fallback specifically.

    Pinned to that path on purpose: expiry there is a timestamp this test can
    wind back, whereas on Redis it is a server-side TTL that would need a real
    ten-minute wait or a fake clock inside Redis. The Redis TTL is asserted
    separately by checking the key's remaining TTL after a write, which is the
    part this code is actually responsible for setting.

    Without the pin this test passed or failed depending on whether a Redis
    happened to be running — which is exactly the kind of green that means
    nothing.
    """
    monkeypatch.setattr(otp_store, "_get_redis", lambda: None)

    await otp_store.store(PHONE, "123456")
    entry = otp_store._memory[PHONE]
    entry.expires_at = time.time() - 1

    with pytest.raises(otp_store.OtpNotFound):
        await otp_store.verify(PHONE, "123456")


@pytest.mark.asyncio
async def test_redis_write_sets_a_bounded_ttl(monkeypatch):
    """The half of expiry this module owns: that a TTL is set at all.

    A key written without one lives forever, and a login code that never
    expires is a permanent credential sitting in a cache.
    """
    calls: dict[str, int] = {}

    class _FakeRedis:
        async def hset(self, key, mapping):
            calls["hset"] = 1

        async def expire(self, key, seconds):
            calls["ttl"] = seconds

    monkeypatch.setattr(otp_store, "_get_redis", lambda: _FakeRedis())

    await otp_store.store(PHONE, "123456")
    assert calls["hset"] == 1
    assert 0 < calls["ttl"] <= otp_store.OTP_TTL_SECONDS


@pytest.mark.asyncio
async def test_unknown_phone_raises_rather_than_returning_false():
    """Distinguishable from a wrong guess: the caller sends different messages,
    and 'never requested' should not burn an attempt."""
    with pytest.raises(otp_store.OtpNotFound):
        await otp_store.verify("+919000000009", "123456")
