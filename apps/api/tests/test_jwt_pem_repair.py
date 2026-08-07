"""
A signing key must survive the journey into an environment variable.

JWT_PRIVATE_KEY is pasted through editors, shells, chat clients and dashboard
form fields, each of which mangles it differently. When it arrives unloadable
the service falls back to an ephemeral keypair, and every user is signed out on
every restart — a failure that looks like flaky sessions rather than a bad
config value.

normalize_pem repairs the known manglings. It handled the armour (Unicode
dashes, escaped newlines, wrapping) but stripped only whitespace from the
base64 body, so an *invisible* character inside the body survived: a zero-width
space is not whitespace to `\\s`, and it decoded as "Invalid symbol 226, offset
0" — 0xE2, the lead byte of its UTF-8 encoding.
"""
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from core.security import load_pem, normalize_pem


@pytest.fixture(scope="module")
def keypair() -> tuple[str, str]:
    """A real RSA keypair, so the tests prove the result actually loads."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    public = key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return private, public


def test_an_untouched_key_loads(keypair):
    private, public = keypair
    assert load_pem(private, private=True) is not None
    assert load_pem(public, private=False) is not None


def test_a_zero_width_space_in_the_body_no_longer_breaks_the_key(keypair):
    """The reported production failure, reproduced exactly."""
    private, _ = keypair
    header, rest = private.split("-----\n", 1)
    mangled = f"{header}-----\n​{rest}"

    # Precondition: the corruption is real and lands where the error said.
    assert "​" in mangled
    assert "​".encode()[0] == 226

    assert load_pem(mangled, private=True) is not None


@pytest.mark.parametrize("invisible", [
    "​",  # zero-width space
    "﻿",  # byte order mark
    " ",  # non-breaking space
    "⁠",  # word joiner
])
def test_invisible_characters_anywhere_in_the_body_are_dropped(keypair, invisible):
    private, _ = keypair
    body_start = private.index("-----\n") + len("-----\n")
    mangled = private[:body_start + 20] + invisible + private[body_start + 20:]

    assert load_pem(mangled, private=True) is not None


def test_the_repaired_key_is_byte_identical_to_the_original(keypair):
    """
    Repair must not merely produce *a* loadable key — it must produce *this*
    one. A key that loads but differs signs tokens nothing can verify.
    """
    private, _ = keypair
    mangled = private.replace("\n", "\\n").replace("-----BEGIN", "—BEGIN")

    assert normalize_pem(mangled) == normalize_pem(private)
    assert load_pem(mangled, private=True) == load_pem(private, private=True)


def test_the_previously_handled_manglings_still_work(keypair):
    """Armour damage: quotes, Unicode dashes, escaped newlines, flattened body."""
    private, _ = keypair
    quoted = f'"{private}"'
    escaped = private.replace("\n", "\\n")
    dashed = private.replace("-----", "—")
    flattened = private.replace("\n", " ")

    for variant in (quoted, escaped, dashed, flattened):
        assert load_pem(variant, private=True) is not None


def test_a_truncated_key_is_still_rejected(keypair):
    """
    Repair must not paper over a genuinely broken value. A key cut short is
    unusable, and silently accepting one would trade a loud failure for a
    quiet one.
    """
    private, _ = keypair
    assert load_pem(private[: len(private) // 2], private=True) is None
    assert load_pem("not a key at all", private=True) is None
    assert load_pem("", private=True) is None
