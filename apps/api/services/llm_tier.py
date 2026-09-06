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
# How often warm_jwks_cache() is asked to refresh, from startup and the
# scheduler. Nothing expires the cache at this interval — a refresh that fails
# leaves the previous key set in place — so this is a freshness target, not a
# deadline. Half-hourly against Supabase's rare rotations is generous.
JWKS_REFRESH_SECONDS = 1800
# How soon _jwks() may try again when NOTHING is cached. Without this the cold
# branch is re-entered by every authenticated request, each paying the full 5s
# timeout on a single worker.
_JWKS_COLD_RETRY_AFTER = 30.0
_JWKS_COLD_ATTEMPTED_AT: float = 0.0


def refresh_jwks_cache() -> bool:
    """
    Fetch the key set and update the cache. Blocking; returns True on success.

    Split out of _jwks() so it can be driven from somewhere that is allowed to
    block — startup, and the scheduler — rather than from a request.

    MEASURED, IN RENDER'S OWN LOG

        09:12:54  OPTIONS x3
        09:12:55  JWKS fetch, 200 OK
        09:12:59  the three GETs answer      <- 5s
        09:13:09  OPTIONS x3, no JWKS line
        09:13:11  the three GETs answer      <- 2s

    Same three requests, three seconds apart, and the only difference is which
    round paid for the key fetch. httpx.get is synchronous, the service runs
    with WEB_CONCURRENCY=1, so the fetch stops the event loop and every request
    in flight waits behind it — including the catalogue reads, which are
    public and need no token at all.

    This is not on its own an explanation of the 504s reported from the live
    site; the 504 is the dead-pooled-connection fault fixed in db/session.py.
    It is a second, independent stall that was found while looking for it.
    """
    global _JWKS, _JWKS_FETCHED_AT

    if not settings.supabase_url:
        return False

    url = settings.supabase_url.rstrip("/") + "/auth/v1/.well-known/jwks.json"
    try:
        import httpx

        resp = httpx.get(url, timeout=5.0)
        resp.raise_for_status()
        _JWKS = resp.json()
        _JWKS_FETCHED_AT = time.time()
        return True
    except Exception as exc:
        if _JWKS is not None:
            # Keep serving what we have. Logged at warning because a refresh
            # that keeps failing is a real problem — it is just not one worth
            # signing everyone out over, which is exactly what discarding the
            # keys here did in production, an hour after every boot.
            logger.warning(
                "Could not refresh Supabase JWKS from %s (%s); continuing with "
                "the key set already held and retrying in %ds",
                url,
                exc,
                JWKS_REFRESH_SECONDS,
            )
        else:
            logger.warning("Could not fetch Supabase JWKS from %s: %s", url, exc)
        return False


async def warm_jwks_cache() -> None:
    """Fill the cache off the event loop, so no request ever pays for it.

    Called at startup and on a timer. `to_thread` matters: awaiting a blocking
    call directly would stall the loop exactly as the request path did.
    """
    import asyncio

    if not settings.supabase_url:
        return
    ok = await asyncio.to_thread(refresh_jwks_cache)
    logger.info("Supabase JWKS cache refresh: %s", "ok" if ok else "failed")


def _jwks() -> dict | None:
    """
    Supabase's public signing keys, read from cache. Does no I/O when warm.

    This function used to run the hourly refresh itself, on whichever unlucky
    request arrived after the cache expired — a 5s synchronous HTTP call in
    front of an async handler on a service with one worker, so every request in
    flight waited behind it. refresh_jwks_cache() has the measurement.
    warm_jwks_cache() now does that work from startup and the scheduler, and a
    held key set is served here whatever its age.

    That also removes the older fault, where an expiry plus one failed refresh
    signed the whole application out an hour after boot. Its docstring claimed
    callers "fall back to the shared-secret path", but that path needs
    SUPABASE_JWT_SECRET, which this deployment does not set. There was no
    fallback, only failure — and now there is no expiry for it to hang on.

    Serving a key set past its intended freshness is not a weakening of
    verification. A token is still checked against the key its `kid` names and
    its signature still has to verify; a rotated-away key simply stops
    matching. Freshness was never the security boundary, and the refresher is
    what keeps it.

    The one fetch left here is the cold one — nothing cached at all, meaning
    startup's warm-up has not landed or failed. It is rate-limited, because
    otherwise every request in that gap pays the full timeout in series and
    reintroduces the stall this change removes.

    Returns None only when nothing is cached and no key set can be fetched.
    """
    global _JWKS_COLD_ATTEMPTED_AT

    # Cache first: a key set already in hand stays valid whether or not a URL
    # is configured, and checking the URL first made a warm cache unusable.
    if _JWKS is not None:
        return _JWKS
    if not settings.supabase_url:
        return None

    now = time.time()
    if now - _JWKS_COLD_ATTEMPTED_AT < _JWKS_COLD_RETRY_AFTER:
        return None
    _JWKS_COLD_ATTEMPTED_AT = now
    refresh_jwks_cache()
    return _JWKS


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
