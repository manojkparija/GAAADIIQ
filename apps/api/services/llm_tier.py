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


def _verify_supabase_token(token: str) -> VerifiedCaller | None:
    """
    Verify a Supabase-issued JWT (HS256, project secret).

    The UI authenticates against Supabase, so without this the backend cannot
    tell a signed-in admin from an anonymous visitor. Returns None when no
    secret is configured or the token does not verify — never trusts unverified
    claims.
    """
    if not settings.supabase_jwt_secret:
        return None
    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            # Supabase sets aud="authenticated" on user tokens.
            options={"verify_aud": False},
        )
    except JWTError:
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
    return bool(settings.gemini_api_key)


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

        user = await _load_user(db, caller)
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


async def _load_user(db: AsyncSession, caller: VerifiedCaller) -> User | None:
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
