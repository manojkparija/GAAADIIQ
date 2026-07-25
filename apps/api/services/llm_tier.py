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

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.subscription import Subscription, SubscriptionTier
from models.user import User, UserRole

logger = logging.getLogger("gaadiiq.llm_tier")


class ModelTier(str, enum.Enum):
    """Which model family serves a given request."""
    free = "free"       # Ollama (self-hosted)
    premium = "premium"  # Gemini Flash


# Subscription tiers that unlock the premium model.
_PAID_TIERS = {SubscriptionTier.pro, SubscriptionTier.dealer}


def gemini_available() -> bool:
    """True when a Gemini key is configured. Without one, everyone uses Ollama."""
    return bool(settings.gemini_api_key)


async def resolve_tier(db: AsyncSession, user_id: uuid.UUID | None) -> ModelTier:
    """
    Determine which model tier serves this request.

    Anonymous and free users get Ollama. Admins and users with an unexpired
    pro/dealer subscription get Gemini. Any failure resolves to free — a
    lookup error must not deny someone a diagnosis.
    """
    if not gemini_available() or user_id is None:
        return ModelTier.free

    try:
        q = await db.execute(select(User).where(User.id == user_id))
        user = q.scalar_one_or_none()
        if user is None:
            return ModelTier.free

        # Admins always get the better model — they are triaging quality.
        if user.role == UserRole.admin:
            return ModelTier.premium

        sq = await db.execute(select(Subscription).where(Subscription.user_id == user_id))
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
        logger.warning("Tier resolution failed for %s, defaulting to free: %s", user_id, exc)
        return ModelTier.free
