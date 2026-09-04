"""
Model tier selection for AI diagnosis.

Free users are served by the self-hosted Ollama model; paid subscribers and
admins get Gemini Flash, which gives noticeably better analysis on the vague,
under-specified symptom reports that make up most real traffic ("makes a
noise", "feels wrong").

Tier resolution is deliberately conservative:

  - No Gemini key configured  → everyone gets Ollama, no errors.
  - Gemini call fails         → fall back to Ollama, then to the heuristic.
    A paid user gets a slightly worse answer, never no answer.

The tier is resolved server-side from the user's role and subscription. It is
never taken from the request body, or a free user could simply ask for the
paid model.
"""
from __future__ import annotations

import enum
import logging
import time
import uuid
from datetime import datetime, timezone

from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.security import decode_access_token
from models.subscription import Subscription, SubscriptionTier
from models.user import User, UserRole

logger = logging.getLogger("gaadiiq.llm_tier")


class VerifiedCaller:
    """An identity established from a cryptographically verified token."""

    __slots__ = ("user_id", "email", "source")

    def __init__(self, user_id: uuid.UUID | None, email: str | None, source: str):
        self.user_id = user_id
        self.email = (email or "").lower() or None
        self.source = source  # "api" | "supabase"


# JWKS cache. Supabase rotates signing keys rarely, and re-fetching on every
# request would put a network round-trip in front of each authenticated call.
_JWKS: dict | None = None
_JWKS_FETCHED_AT: float = 0.0
_JWKS_TTL = 3600.0
# How soon to try again after a failed refresh, while serving the stale set.
_JWKS_RETRY_AFTER = 60.0


def _jwks() -> dict | None:
    """
    Supabase's public signing keys, refreshed hourly, kept on failure.

    A stale key set is served when the refresh fails, and that is the whole
    point of this function's shape. It used to return None instead, which
    signed the entire application out an hour after boot: the cache expires,
    one refresh fails for any transient reason, and from that moment every
    authenticated request is 401 until a later fetch happens to succeed. The
    docstring claimed callers "fall back to the shared-secret path", but that
    path needs SUPABASE_JWT_SECRET, which this deployment does not set — so
    there was no fallback, only failure.

    Serving stale keys is not a weakening of verification. A token is still
    checked against a key whose `kid` it names, and its signature still has to
    verify; a rotated-away key simply stops matching. What the old behaviour
    did was throw away keys that were still perfectly good because the network
    hiccuped.

    Returns None only when nothing is cached and no key set can be fetched.
    """
    global _JWKS, _JWKS_FETCHED_AT

    # Cache first: a key set already in hand stays valid whether or not a URL
    # is configured, and checking the URL first made a warm cache unusable.
    if _JWKS is not None and (time.time() - _JWKS_FETCHED_AT) < _JWKS_TTL:
        return _JWKS
    if not settings.supabase_url:
        return _JWKS

    url = settings.supabase_url.rstrip("/") + "/auth/v1/.well-known/jwks.json"
    try:
        import httpx

        resp = httpx.get(url, timeout=5.0)
        resp.raise_for_status()
        _JWKS = resp.json()
        _JWKS_FETCHED_AT = time.time()
        return _JWKS
    except Exception as exc:
        if _JWKS is not None:
            # Back off for a fraction of the TTL rather than retrying on every
            # request while Supabase is unreachable, and keep serving what we
            # have. Logged at warning because a refresh that keeps failing is
            # a real problem — it is just not one worth signing everyone out
            # over.
            _JWKS_FETCHED_AT = time.time() - (_JWKS_TTL - _JWKS_RETRY_AFTER)
            logger.warning(
                "Could not refresh Supabase JWKS from %s (%s); continuing with "
                "the key set already held and retrying in %.0fs",
                url,
                exc,
                _JWKS_RETRY_AFTER,
            )
            return _JWKS
        logger.warning("Could not fetch Supabase JWKS from %s: %s", url, exc)
        return None


def _verify_supabase_token(token: str) -> VerifiedCaller | None:
    """
    Verify a Supabase-issued JWT.

    Supabase projects sign in one of two ways, and which one depends on when
    the project was created:

      - Legacy: HS256 with a shared project secret (SUPABASE_JWT_SECRET).
      - Current: asymmetric keys (ES256/RS256) published at the project's
        JWKS endpoint, with no shared secret to configure.

    Both are supported, chosen by the token's own header, because a deployment
    should not break when Supabase migrates the project. Returns None when the
    token does not verify — unverified claims are never trusted.
    """
    payload: dict | None = None

    try:
        header = jwt.get_unverified_header(token)
    except JWTError:
        logger.warning("Bearer token rejected: not a readable JWT")
        return None

    alg = (header.get("alg") or "").upper()

    if alg.startswith("HS"):
        if not settings.supabase_jwt_secret:
            logger.warning(
                "Bearer token rejected: HS256 token but SUPABASE_JWT_SECRET is "
                "not set on this service, so no Supabase session can be verified"
            )
            return None
        try:
            payload = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                # Supabase sets aud="authenticated" on user tokens.
                options={"verify_aud": False},
            )
        except JWTError as exc:
            logger.warning("Bearer token rejected: HS256 verification failed (%s)", exc)
            return None
    else:
        jwks = _jwks()
        if not jwks:
            logger.warning(
                "Bearer token rejected: %s token but no JWKS could be fetched "
                "for this Supabase project",
                alg or "asymmetric",
            )
            return None
        kid = header.get("kid")
        key = next(
            (k for k in jwks.get("keys", []) if not kid or k.get("kid") == kid),
            None,
        )
        if key is None:
            logger.warning(
                "Bearer token rejected: no JWKS key matches kid %r. A rotated "
                "Supabase signing key looks exactly like this.",
                kid,
            )
            return None
        try:
            payload = jwt.decode(
                token,
                key,
                algorithms=[alg] if alg else ["ES256", "RS256"],
                options={"verify_aud": False},
            )
        except JWTError as exc:
            logger.warning("Bearer token rejected: %s verification failed (%s)", alg, exc)
            return None

    if not payload:
        return None

    email = payload.get("email")
    sub = payload.get("sub")
    # The Supabase user id is NOT this backend's users.id — the two stores are
    # unlinked — so it is carried for logging only and never used as a FK.
    return VerifiedCaller(user_id=None, email=email, source="supabase") if (email or sub) else None


def verify_caller(bearer_token: str | None) -> VerifiedCaller | None:
    """
    Establish who is calling, from a verified token only.

    Tries this backend's own RS256 token first, then a Supabase HS256 token.
    Returns None for anonymous or unverifiable callers.
    """
    if not bearer_token:
        return None

    payload = decode_access_token(bearer_token)
    if payload:
        try:
            uid = uuid.UUID(payload["sub"]) if payload.get("sub") else None
        except (ValueError, TypeError):
            uid = None
        return VerifiedCaller(user_id=uid, email=payload.get("email"), source="api")

    return _verify_supabase_token(bearer_token)


class ModelTier(str, enum.Enum):
    """Which model family serves a given request."""
    free = "free"       # Ollama (self-hosted)
    premium = "premium"  # Gemini Flash


# Subscription tiers that unlock the premium model.
_PAID_TIERS = {SubscriptionTier.pro, SubscriptionTier.dealer}


def gemini_available() -> bool:
    """True when a Gemini key is configured. Without one, everyone uses Ollama."""
    from services import gemini_gateway

    return gemini_gateway.is_available()


async def resolve_tier(db: AsyncSession, caller: VerifiedCaller | None) -> ModelTier:
    """
    Determine which model tier serves this request.

    Takes a VerifiedCaller — an identity proven by a signed token — never a
    client-supplied user id. Passing the id in the request body would let a
    free user send a paid user's UUID and be upgraded.

    Anonymous and free users get Ollama. Admins and users with an unexpired
    pro/dealer subscription get Gemini. Any failure resolves to free: a lookup
    error must not deny someone a diagnosis.
    """
    if not gemini_available() or caller is None:
        return ModelTier.free

    try:
        # Configured admin allowlist — works regardless of which store holds
        # the role, and is server-side config rather than a client claim.
        if caller.email and caller.email in settings.admin_email_set:
            return ModelTier.premium

        user = await load_user(db, caller)
        if user is None:
            return ModelTier.free

        # Admins always get the better model — they are triaging quality.
        if user.role == UserRole.admin:
            return ModelTier.premium

        sq = await db.execute(select(Subscription).where(Subscription.user_id == user.id))
        sub = sq.scalar_one_or_none()
        if sub is None or sub.tier not in _PAID_TIERS:
            return ModelTier.free

        # An expired subscription is a free subscription.
        if sub.valid_until is not None:
            valid_until = sub.valid_until
            if valid_until.tzinfo is None:
                valid_until = valid_until.replace(tzinfo=timezone.utc)
            if valid_until < datetime.now(timezone.utc):
                return ModelTier.free

        return ModelTier.premium
    except Exception as exc:
        # Never let tier resolution break a diagnosis.
        logger.warning("Tier resolution failed, defaulting to free: %s", exc)
        return ModelTier.free


async def load_user(db: AsyncSession, caller: VerifiedCaller) -> User | None:
    """
    Find this backend's User row for a verified caller.

    Supabase and this backend keep separate user tables with unrelated IDs, so
    a Supabase caller is matched on email — the only field the two stores
    share. An API caller is matched on id, falling back to email.
    """
    if caller.user_id is not None:
        q = await db.execute(select(User).where(User.id == caller.user_id))
        user = q.scalar_one_or_none()
        if user is not None:
            return user

    if caller.email:
        q = await db.execute(select(User).where(User.email == caller.email))
        return q.scalar_one_or_none()

    return None
