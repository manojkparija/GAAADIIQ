import secrets
import uuid
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

from core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

REFRESH_TOKEN_COOKIE = "refresh_token"
ACCESS_TOKEN_COOKIE = "access_token"


def _get_rsa_keys() -> tuple[str, str]:
    """Return (private_key_pem, public_key_pem).

    In production these come from JWT_PRIVATE_KEY / JWT_PUBLIC_KEY env vars.
    In development a self-signed 2048-bit RSA keypair is generated on first call
    and cached for the process lifetime — no file I/O, no secrets committed.
    """
    if settings.jwt_private_key and settings.jwt_public_key:
        return settings.jwt_private_key, settings.jwt_public_key
    # Dev fallback: generate an ephemeral keypair (new per process restart — fine for dev)
    return _ephemeral_keys()


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
