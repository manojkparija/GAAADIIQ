"""
Why a 401 happened, in the log.

Reported from production: `POST /loans/applications` began answering 401 after
having worked earlier the same evening. The Render access log carried this and
nothing else:

    "POST /loans/applications HTTP/1.1" 401 Unauthorized

Which is true and useless. At least six unrelated faults produce exactly that
line — the app sent no token at all; SUPABASE_JWT_SECRET is missing on the
service; the project's signing key rotated so no JWKS key matches the token's
kid; the token expired; it verified but carries no email; the matched user is
deactivated — and they need completely different fixes. Every one of them was
a silent `return None` or a bare `raise`.

These tests do not change who is let in. They pin the requirement that each
refusal says which one it was, so the next occurrence is diagnosable from the
log instead of by guessing.
"""
import base64
import logging

import pytest
from jose import jwt

from services import llm_tier
from services.llm_tier import _verify_supabase_token, verify_caller


def _hs256(secret: str = "s3cret", **claims) -> str:
    return jwt.encode({"sub": "u-1", "email": "a@b.com", **claims}, secret, algorithm="HS256")


def test_an_unreadable_token_says_so(caplog):
    with caplog.at_level(logging.WARNING):
        assert _verify_supabase_token("not-a-jwt") is None
    assert "not a readable JWT" in caplog.text


def test_a_missing_shared_secret_is_named(caplog, monkeypatch):
    # The whole app signed in and every authenticated call 401s. Nothing about
    # the token is wrong; the service simply cannot check it.
    monkeypatch.setattr(llm_tier.settings, "supabase_jwt_secret", "", raising=False)
    with caplog.at_level(logging.WARNING):
        assert _verify_supabase_token(_hs256()) is None
    assert "SUPABASE_JWT_SECRET" in caplog.text


def test_a_wrong_signature_is_not_reported_as_a_missing_secret(caplog, monkeypatch):
    monkeypatch.setattr(llm_tier.settings, "supabase_jwt_secret", "the-real-one", raising=False)
    with caplog.at_level(logging.WARNING):
        assert _verify_supabase_token(_hs256(secret="a-different-one")) is None
    assert "HS256 verification failed" in caplog.text
    assert "SUPABASE_JWT_SECRET" not in caplog.text


def test_a_rotated_signing_key_is_named(caplog, monkeypatch):
    # The shape of "it worked an hour ago": tokens minted before the rotation
    # still verify, tokens minted after do not.
    monkeypatch.setattr(llm_tier, "_jwks", lambda: {"keys": [{"kid": "old-key"}]})
    signed = jwt.encode({"sub": "u-1"}, "x", algorithm="HS256")
    # Force the asymmetric branch by claiming ES256 in the header.
    header = base64.urlsafe_b64encode(b'{"alg":"ES256","kid":"new-key"}').rstrip(b"=").decode()
    token = ".".join([header, *signed.split(".")[1:]])
    with caplog.at_level(logging.WARNING):
        assert _verify_supabase_token(token) is None
    assert "no JWKS key matches kid" in caplog.text


def test_an_anonymous_call_logs_nothing(caplog):
    # Most diagnosis traffic is signed out and that is normal. Warning on it
    # would bury the real refusals.
    with caplog.at_level(logging.WARNING):
        assert verify_caller(None) is None
        assert verify_caller("") is None
    assert caplog.text == ""


@pytest.mark.anyio
async def test_no_token_at_all_is_distinguished_from_a_refused_one(caplog):
    from core.dependencies import get_current_user

    with caplog.at_level(logging.INFO):
        with pytest.raises(Exception):
            await get_current_user(credentials=None, cookie_token=None, db=None)
    assert "no Authorization header" in caplog.text
