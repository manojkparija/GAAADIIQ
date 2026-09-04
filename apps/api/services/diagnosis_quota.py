"""
Who may run an AI Diagnosis, and how many times a month.

THE POLICY

    anonymous                     blocked — sign in first
    signed in, no paid plan       3 per calendar month
    Buyer Pro      (pro)          unlimited
    Seller Basic   (seller_basic) 10 per calendar month
    Dealer Pro     (dealer)       unlimited
    admin                         unlimited

A diagnosis costs a model call, so the gate has to be here rather than in the
Angular app: a button that is hidden client-side is a button that is still
reachable with curl. The frontend renders the same numbers, but it reads them
from `GET /diagnosis/quota` — it does not own them.

WHY ANONYMOUS IS BLOCKED RATHER THAN RATIONED

There is no stable identity to ration against. The counter is keyed on a
verified token claim; an anonymous caller has no claim to key on, and anything
that could stand in for one (IP, a client-generated id) is either shared by a
whole building or reset by clearing storage.

WHAT IS CHARGED, AND WHEN

The allowance is consumed *before* the model call, not after — the point of
the quota is to stop the spend, and a counter incremented on success is one a
caller can exhaust for free by cancelling. A diagnosis that then falls back to
the heuristic still cost the attempt and still counts. `run_diagnosis` has its
own fallbacks and effectively always returns something, so this is a narrow
case rather than a common one.

TIER IS NOT PLAN

`services/llm_tier.resolve_tier` answers "which model serves this call" and
this module answers "may this call happen at all". They read the same
subscription row and deliberately stay separate: Buyer Pro and Dealer Pro get
both the better model and no cap, but Seller Basic gets a cap of ten and the
free model, and collapsing the two would have silently handed it Gemini.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.diagnosis_usage import DiagnosisUsage
from models.subscription import Subscription, SubscriptionTier
from models.user import User, UserRole
from services.llm_tier import VerifiedCaller, load_user

logger = logging.getLogger("gaadiiq.diagnosis_quota")

#: Runs allowed per calendar month. `None` means unlimited.
#:
#: Keyed by the plan label this module reports, not by SubscriptionTier, so the
#: admin case has somewhere to live and the labels match what the UI shows.
MONTHLY_QUOTA: dict[str, int | None] = {
    "anonymous": 0,
    "free": 3,
    "seller_basic": 10,
    "pro": None,
    "dealer": None,
    "admin": None,
}

#: What the plan is called on the pricing page. `pro` and `dealer` predate it.
PLAN_LABEL: dict[str, str] = {
    "free": "Free",
    "seller_basic": "Seller Basic",
    "pro": "Buyer Pro",
    "dealer": "Dealer Pro",
    "admin": "Admin",
}

#: Error codes the Angular app switches on. Changing one is a breaking change.
CODE_SIGN_IN_REQUIRED = "sign_in_required"
CODE_QUOTA_EXHAUSTED = "diagnosis_quota_exhausted"


@dataclass(frozen=True)
class Allowance:
    """The answer to "may this caller run a diagnosis right now?"."""

    plan: str
    #: None when unlimited.
    limit: int | None
    used: int
    allowed: bool

    @property
    def label(self) -> str:
        return PLAN_LABEL.get(self.plan, self.plan)

    @property
    def remaining(self) -> int | None:
        if self.limit is None:
            return None
        return max(self.limit - self.used, 0)

    def as_dict(self) -> dict:
        return {
            "plan": self.plan,
            "plan_label": self.label,
            "limit": self.limit,
            "used": self.used,
            "remaining": self.remaining,
            "unlimited": self.limit is None,
            "allowed": self.allowed,
            "period": current_period(),
        }


def current_period(now: datetime | None = None) -> str:
    """The UTC calendar month, as the counter stores it."""
    return (now or datetime.now(timezone.utc)).strftime("%Y-%m")


def subject_of(caller: VerifiedCaller) -> str:
    """
    The key the counter is stored under.

    Email first: it is the one field this backend's users table and Supabase
    agree on, and it survives a caller having no local row at all. A token with
    no email claim falls back to the API user id, prefixed so the two key
    spaces cannot collide with each other.
    """
    if caller.email:
        return caller.email.lower()
    return f"id:{caller.user_id}"


async def resolve_plan(db: AsyncSession, caller: VerifiedCaller | None) -> str:
    """
    Which plan this caller holds, from server-side state only.

    Mirrors `resolve_tier`'s resolution order — admin allowlist, then role,
    then subscription — because a user who is an admin in one and not the
    other would be confusing in a way nobody would think to look for.

    Any failure resolves to "free". That is the conservative direction here:
    it grants the smallest non-zero allowance rather than an unlimited one.
    """
    if caller is None:
        return "anonymous"

    try:
        if caller.email and caller.email in settings.admin_email_set:
            return "admin"

        user: User | None = await load_user(db, caller)
        if user is None:
            return "free"
        if user.role == UserRole.admin:
            return "admin"

        sub = (
            await db.execute(select(Subscription).where(Subscription.user_id == user.id))
        ).scalar_one_or_none()
        if sub is None or sub.tier == SubscriptionTier.free:
            return "free"

        # An expired subscription is a free subscription — same rule as the
        # model tier, so a lapsed payer does not keep an unlimited allowance.
        if sub.valid_until is not None:
            valid_until = sub.valid_until
            if valid_until.tzinfo is None:
                valid_until = valid_until.replace(tzinfo=timezone.utc)
            if valid_until < datetime.now(timezone.utc):
                return "free"

        return sub.tier.value
    except Exception as exc:  # noqa: BLE001 — see docstring
        logger.warning("Plan resolution failed, treating as free: %s", exc)
        return "free"


async def peek(db: AsyncSession, caller: VerifiedCaller | None) -> Allowance:
    """Report the allowance without spending any of it (GET /diagnosis/quota)."""
    plan = await resolve_plan(db, caller)
    limit = MONTHLY_QUOTA.get(plan, MONTHLY_QUOTA["free"])

    if caller is None:
        return Allowance(plan=plan, limit=0, used=0, allowed=False)
    if limit is None:
        return Allowance(plan=plan, limit=None, used=0, allowed=True)

    used = await _used(db, subject_of(caller)) or 0
    return Allowance(plan=plan, limit=limit, used=used, allowed=used < limit)


async def consume(db: AsyncSession, caller: VerifiedCaller | None) -> Allowance:
    """
    Spend one run if the caller has one, and report what happened.

    `allowed=False` means nothing was spent — the caller is over the cap (or
    anonymous) and the endpoint must refuse before touching a model.

    The increment is a conditional UPDATE (`... WHERE used < limit`) rather
    than read-then-write, so two requests arriving together cannot both see
    "2 of 3 used" and both be allowed through. The unique constraint on
    (subject, period) covers the other race: two first-of-the-month requests
    racing to insert the row, where the loser retries against the winner's row
    instead of raising.
    """
    plan = await resolve_plan(db, caller)
    limit = MONTHLY_QUOTA.get(plan, MONTHLY_QUOTA["free"])

    if caller is None:
        return Allowance(plan=plan, limit=0, used=0, allowed=False)
    if limit is None:
        return Allowance(plan=plan, limit=None, used=0, allowed=True)

    subject = subject_of(caller)
    period = current_period()

    for _ in range(3):
        result = await db.execute(
            update(DiagnosisUsage)
            .where(
                DiagnosisUsage.subject == subject,
                DiagnosisUsage.period == period,
                DiagnosisUsage.used < limit,
            )
            .values(used=DiagnosisUsage.used + 1)
        )
        if result.rowcount:
            await db.commit()
            used = await _used(db, subject) or limit
            return Allowance(plan=plan, limit=limit, used=used, allowed=True)

        # Either the row is already at the cap, or it does not exist yet.
        existing = await _used(db, subject)
        if existing is not None:
            return Allowance(plan=plan, limit=limit, used=existing, allowed=False)

        db.add(DiagnosisUsage(subject=subject, period=period, used=1))
        try:
            await db.commit()
            return Allowance(plan=plan, limit=limit, used=1, allowed=True)
        except IntegrityError:
            # Another request inserted the row first; go round and UPDATE it.
            await db.rollback()

    logger.warning("Quota increment for %s kept losing its race; allowing", subject)
    return Allowance(plan=plan, limit=limit, used=0, allowed=True)


async def _used(db: AsyncSession, subject: str) -> int | None:
    """Runs used this month, or None when there is no row for it yet."""
    return await db.scalar(
        select(DiagnosisUsage.used).where(
            DiagnosisUsage.subject == subject,
            DiagnosisUsage.period == current_period(),
        )
    )
