import logging
import re
import secrets
import textwrap
import uuid
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

from core.config import settings

logger = logging.getLogger(__name__)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

REFRESH_TOKEN_COOKIE = "refresh_token"
ACCESS_TOKEN_COOKIE = "access_token"

# Unicode dashes that editors, chat clients and word processors substitute for
# the ASCII hyphens in a PEM's "-----BEGIN ...-----" armour. A single one makes
# the whole key unparseable, and the resulting error ("Invalid symbol 226") does
# not hint at the cause.
_UNICODE_DASHES = dict.fromkeys(map(ord, "‐‑‒–—―−⁃"), "-")

# The hyphen runs are matched as "one or more", not exactly five: autocorrect
# collapses "-----" into a single em-dash, so the original count is already lost
# by the time we see the value. The armour is rebuilt canonically below.
_PEM_RE = re.compile(
    r"-+ *BEGIN (?P<label>[A-Z][A-Z ]*[A-Z]) *-+(?P<body>.*?)-+ *END (?P=label) *-+",
    re.DOTALL,
)


def normalize_pem(raw: str) -> str:
    """Repair the ways a PEM key gets mangled in transit to an env var.

    Handles, in order:
      • surrounding quotes, added when a value is pasted as a shell literal
      • Unicode dashes substituted for the armour's ASCII hyphens
      • literal backslash-n instead of real newlines — the convention that
        config.py documents ("newlines as \\n") but nothing ever undid
      • a body flattened onto one line, or wrapped at the wrong width

    Returns the repaired PEM. Does not validate — call load_pem for that.
    """
    if not raw:
        return ""

    text = raw.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        text = text[1:-1]

    text = text.translate(_UNICODE_DASHES)
    text = text.replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\r", "\n")
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    # Rebuild the armour so the body is base64 wrapped at the canonical 64
    # columns, whichever way the original was broken up.
    match = _PEM_RE.search(text)
    if not match:
        return text.strip()

    # Everything that is not base64, not merely whitespace. An invisible
    # character pasted into the body — a zero-width space, a byte order mark, a
    # non-breaking space — is not matched by \s and survived into the payload,
    # where it decoded as "Invalid symbol 226 at offset 0" and cost the service
    # its signing key. Nothing outside the base64 alphabet can belong here, so
    # dropping all of it is both safe and complete.
    body = re.sub(r"[^A-Za-z0-9+/=]", "", match.group("body"))
    label = match.group("label").strip()
    return (
        f"-----BEGIN {label}-----\n"
        + "\n".join(textwrap.wrap(body, 64))
        + f"\n-----END {label}-----\n"
    )


def load_pem(raw: str, *, private: bool, quiet: bool = False) -> str | None:
    """Normalize a PEM and confirm cryptography can actually parse it.

    Returns the usable PEM, or None if it cannot be loaded. Never raises, and
    never logs the key material itself. Pass quiet=True to suppress the failure
    log when the caller has already reported it once.
    """
    pem = normalize_pem(raw)
    if not pem:
        return None
    try:
        from cryptography.hazmat.primitives import serialization

        if private:
            serialization.load_pem_private_key(pem.encode(), password=None)
        else:
            serialization.load_pem_public_key(pem.encode())
        return pem
    except Exception as exc:  # noqa: BLE001 — any parse failure means unusable
        if quiet:
            return None
        logger.error(
            "JWT_%s_KEY is set but is not a loadable PEM (%s: %s). "
            "Common causes: the '-----BEGIN' hyphens were replaced with Unicode "
            "dashes by an editor or chat client, or the value was truncated.",
            "PRIVATE" if private else "PUBLIC",
            type(exc).__name__,
            exc,
        )
        return None


def _get_rsa_keys() -> tuple[str, str]:
    """Return (private_key_pem, public_key_pem).

    In production these come from JWT_PRIVATE_KEY / JWT_PUBLIC_KEY env vars.
    In development a self-signed 2048-bit RSA keypair is generated on first call
    and cached for the process lifetime — no file I/O, no secrets committed.

    Configured keys are normalized and validated before use. If they are set but
    unusable the process falls back to an ephemeral keypair and logs loudly,
    rather than letting every token operation fail with an opaque 500. The cost
    of that fallback is that tokens do not survive a restart, so the log line
    must be treated as an outage-level warning in production.
    """
    global _warned_unloadable_keys

    if settings.jwt_private_key and settings.jwt_public_key:
        # This runs on every token operation, so the failure is only reported
        # once per process. Repeating it per request buried the actual errors
        # in the log — the noise made a real 401 hard to find.
        quiet = _warned_unloadable_keys
        configured_private = load_pem(settings.jwt_private_key, private=True, quiet=quiet)
        configured_public = load_pem(settings.jwt_public_key, private=False, quiet=quiet)
        if configured_private and configured_public:
            return configured_private, configured_public
        if not _warned_unloadable_keys:
            _warned_unloadable_keys = True
            logger.error(
                "Falling back to an EPHEMERAL JWT keypair because the configured "
                "keys could not be loaded. Tokens will be invalidated on every "
                "restart until JWT_PRIVATE_KEY/JWT_PUBLIC_KEY are fixed. "
                "(This is logged once per process.)"
            )
    # Dev fallback: generate an ephemeral keypair (new per process restart — fine for dev)
    return _ephemeral_keys()


_warned_unloadable_keys: bool = False


_ephemeral_private: str = ""
_ephemeral_public: str = ""


def _ephemeral_keys() -> tuple[str, str]:
    global _ephemeral_private, _ephemeral_public
    if _ephemeral_private:
        return _ephemeral_private, _ephemeral_public
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        _ephemeral_private = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode()
        _ephemeral_public = private_key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode()
    except ImportError as exc:
        raise RuntimeError(
            "The 'cryptography' package is required for JWT signing. "
            "Install it with: pip install cryptography"
        ) from exc
    return _ephemeral_private, _ephemeral_public


def _signing_key() -> str:
    private, _ = _get_rsa_keys()
    return private


def _verifying_key() -> str:
    _, public = _get_rsa_keys()
    return public


def _algorithm() -> str:
    return "RS256"


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: uuid.UUID, email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {
        "sub": str(user_id),
        "email": email,
        "exp": expire,
        "type": "access",
    }
    return jwt.encode(payload, _signing_key(), algorithm=_algorithm())


def create_refresh_token() -> str:
    """Generate a cryptographically random opaque refresh token."""
    return secrets.token_urlsafe(48)


def decode_access_token(token: str) -> dict:
    try:
        data = jwt.decode(token, _verifying_key(), algorithms=[_algorithm()])
        if data.get("type") != "access":
            return {}
        return data
    except JWTError:
        return {}


def set_auth_cookies(response, access_token: str, refresh_token: str) -> None:
    """Write both tokens as httpOnly Secure cookies."""
    secure = settings.is_production
    response.set_cookie(
        key=ACCESS_TOKEN_COOKIE,
        value=access_token,
        httponly=True,
        secure=secure,
        samesite="lax",
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
    )
    response.set_cookie(
        key=REFRESH_TOKEN_COOKIE,
        value=refresh_token,
        httponly=True,
        secure=secure,
        samesite="lax",
        max_age=settings.refresh_token_expire_days * 86400,
        path="/auth/refresh",
    )


def clear_auth_cookies(response) -> None:
    response.delete_cookie(ACCESS_TOKEN_COOKIE, path="/")
    response.delete_cookie(REFRESH_TOKEN_COOKIE, path="/auth/refresh")
