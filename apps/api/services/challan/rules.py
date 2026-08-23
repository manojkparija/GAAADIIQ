"""
The listing decision engine (BRD §10).

Turns a provider's answer into one of four decisions, using rules stored as
rows rather than constants in this file. BRD §9 and §29 both require that; the
reason is that a threshold in code is a business rule that needs an engineer
and a deploy to change, and one that cannot be reconstructed after it changes.

ORDER IS THE DESIGN, NOT AN IMPLEMENTATION DETAIL

BRD §10 specifies the order and it is deliberately not "worst outcome wins":

    failed            -> VERIFICATION_PENDING
    court / legal     -> MANUAL_REVIEW
    amount over limit -> BLOCKED
    count over limit  -> MANUAL_REVIEW
    otherwise         -> VERIFIED

The first branch is the one that matters most. A verification that did not
happen is *not* a pass and *not* a block — it is unknown, and unknown must be
its own outcome. If a failed lookup fell through to the final `else`, an
outage would mark every vehicle VERIFIED, which is the worst failure this
module can have and the easiest one to write by accident.

The court branch sits above the amount branch so a vehicle that is both in
court and over the threshold is routed to a human rather than auto-blocked: a
court matter may be resolved or contested in ways a rupee threshold cannot
express, and the seller deserves the review.
"""
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.challan import (
    ChallanRiskCategory,
    ChallanRuleAction,
    ChallanRuleType,
    ChallanVerificationRule,
    ListingDecision,
)

from .base import ChallanResult, ensure_aware

# Used only when no rule row exists for a type. They are the BRD's worked
# examples, and they are the conservative direction: a missing configuration
# must not mean "no limit". Any real threshold is a row an administrator set.
FALLBACK_MAX_AMOUNT = 5000.0
FALLBACK_MAX_COUNT = 2
FALLBACK_VALIDITY_DAYS = 7


@dataclass(frozen=True)
class RuleOutcome:
    decision: ListingDecision
    risk: ChallanRiskCategory
    #: Why, in words a seller and an admin can both read. Stored on the
    #: verification so the decision stays explainable after the rule changes.
    reason: str


async def active_rules(db: AsyncSession) -> dict[ChallanRuleType, ChallanVerificationRule]:
    """The rules in force right now, keyed by type.

    Filters on the effective window rather than trusting `is_active` alone: a
    rule scheduled to start next month is active but not yet in force, and
    applying it early would block vehicles under a threshold nobody agreed to
    yet.

    When two rows of one type are in force, the lower `priority` wins. That is
    a configuration mistake rather than a supported state, but silently picking
    a random one would be worse than picking deterministically.
    """
    now = datetime.now(timezone.utc)
    rows = (
        await db.execute(
            select(ChallanVerificationRule)
            .where(ChallanVerificationRule.is_active.is_(True))
            .order_by(ChallanVerificationRule.priority)
        )
    ).scalars().all()

    in_force: dict[ChallanRuleType, ChallanVerificationRule] = {}
    for r in rows:
        # ensure_aware: SQLite drops tzinfo on the way out, and comparing a
        # naive value to an aware `now` raises. See services/challan/base.py.
        start = ensure_aware(r.effective_from)
        end = ensure_aware(r.effective_to)
        if start and start > now:
            continue
        if end and end < now:
            continue
        in_force.setdefault(r.rule_type, r)
    return in_force


def _number(rule: ChallanVerificationRule | None, fallback: float) -> float:
    """A rule's configured value as a number, or the fallback.

    A malformed value falls back rather than raising. An administrator typing
    "5,000" should not take down verification for every seller; it should
    behave as though the rule were unset, which is the conservative default.
    """
    if rule is None:
        return fallback
    try:
        return float(str(rule.configured_value).replace(",", "").strip())
    except (TypeError, ValueError):
        return fallback


async def validity_days(db: AsyncSession) -> int:
    """How long a PASS stays usable (BRD §14)."""
    rules = await active_rules(db)
    return int(_number(rules.get(ChallanRuleType.verification_validity_days), FALLBACK_VALIDITY_DAYS))


async def evaluate(
    db: AsyncSession,
    result: ChallanResult | None,
    *,
    failure_reason: str | None = None,
) -> RuleOutcome:
    """Apply BRD §10 in order. `result=None` means the lookup did not happen."""
    rules = await active_rules(db)

    # 1. Verification did not complete. Not a pass, not a block — unknown.
    if result is None:
        return RuleOutcome(
            ListingDecision.verification_pending,
            ChallanRiskCategory.unknown,
            failure_reason or "Challan verification could not be completed.",
        )

    # 2. Court or legal review. Above the amount test on purpose — see the
    #    module docstring.
    if result.has_court_case:
        court_rule = rules.get(ChallanRuleType.court_status)
        if court_rule is None or court_rule.action is not ChallanRuleAction.allow:
            return RuleOutcome(
                ListingDecision.manual_review,
                ChallanRiskCategory.court_review,
                "One or more challans are recorded as being with a court or "
                "requiring legal review.",
            )

    outstanding = result.outstanding_total
    count = result.outstanding_count

    # 3. Amount over the configured maximum.
    max_amount = _number(rules.get(ChallanRuleType.max_outstanding_amount), FALLBACK_MAX_AMOUNT)
    if outstanding > max_amount:
        amount_rule = rules.get(ChallanRuleType.max_outstanding_amount)
        action = amount_rule.action if amount_rule else ChallanRuleAction.block
        decision = (
            ListingDecision.manual_review
            if action is ChallanRuleAction.manual_review
            else ListingDecision.blocked
        )
        return RuleOutcome(
            decision,
            ChallanRiskCategory.high,
            f"Outstanding challan amount is above the configured maximum of "
            f"{max_amount:,.0f}.",
        )

    # 4. Too many outstanding challans.
    max_count = int(_number(rules.get(ChallanRuleType.max_outstanding_count), FALLBACK_MAX_COUNT))
    if count > max_count:
        return RuleOutcome(
            ListingDecision.manual_review,
            ChallanRiskCategory.moderate,
            f"{count} outstanding challans, above the configured maximum of {max_count}.",
        )

    # 5. Nothing fired.
    #
    # `clear` only when the source actually held no records. A vehicle with
    # challans under the threshold is `low`, not clear — it passed, but saying
    # "clear" of a vehicle with an unpaid challan would be false, and this
    # value reaches the buyer-facing badge.
    if not result.found_records:
        return RuleOutcome(
            ListingDecision.verified,
            ChallanRiskCategory.clear,
            "No challan records were held by the verification source at the "
            "time of checking.",
        )
    if outstanding > 0:
        return RuleOutcome(
            ListingDecision.verified,
            ChallanRiskCategory.low,
            f"Outstanding challan amount is within the configured limit of "
            f"{max_amount:,.0f}.",
        )
    return RuleOutcome(
        ListingDecision.verified,
        ChallanRiskCategory.clear,
        "Challan records were found but none are outstanding.",
    )
