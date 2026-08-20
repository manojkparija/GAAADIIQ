"""
Checking an entered price against one a person looked up.

UAT asked for a warning when an admin or dealer enters a price that differs
significantly from the market. The tempting implementation is to fetch or
estimate a market price. This deliberately does not: a reference figure the
system produced would read exactly like one somebody verified, and the reader
has no way to tell them apart. `services/credit_bureau.py` refuses the same
trade — it raises rather than returning a plausible score — and the reasoning
carries over unchanged.

So the reference is whatever a human entered against the model, with the source
and the date they checked it. This module only compares. When there is no
reference it says so, rather than reporting agreement, because "no warning"
and "checked and fine" are different facts and a publisher will act on them
differently.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

# Ex-showroom prices move with taxes, discounts and mid-year revisions, so a
# small gap is ordinary and warning about it would teach admins to dismiss the
# warning. Ten per cent is wide enough to stay quiet through normal drift and
# narrow enough to catch the failure this came from: a base variant repriced
# to a higher trim's figure, which in the reported Fronx case was a 77% jump.
SIGNIFICANT_DIFFERENCE = Decimal("0.10")

# Past this, the likelier explanation is a typo — a missing or extra zero —
# than a real price change, and the message should say so.
LIKELY_TYPO_DIFFERENCE = Decimal("0.60")

# A reference nobody has revisited in this long is still evidence, but weaker
# evidence, and the reader should be told rather than left to assume it is
# current.
STALE_AFTER_DAYS = 180


@dataclass(frozen=True)
class PriceCheck:
    """The outcome of comparing an entered price with the stored reference."""

    #: False when there is no reference to compare against.
    has_reference: bool
    #: True only when a reference exists and the gap exceeds the threshold.
    is_significant: bool
    #: Signed fraction: +0.2 means the entered price is 20% above the reference.
    difference: Decimal | None
    #: Days since the reference was checked, when a date was recorded.
    reference_age_days: int | None
    #: Whether that age is past STALE_AFTER_DAYS.
    is_stale: bool
    #: One sentence for a human, or None when there is nothing to say.
    message: str | None


def _percent(value: Decimal) -> str:
    return f"{abs(value) * 100:.0f}%"


def check_price(
    entered: Decimal | int | float | None,
    *,
    reference: Decimal | int | float | None,
    source: str | None = None,
    checked_on: date | None = None,
    today: date | None = None,
) -> PriceCheck:
    """
    Compare an entered price against the reference, if there is one.

    `today` is a parameter rather than a call to date.today() so the staleness
    branch can be tested without waiting six months.
    """
    if entered is None or reference is None:
        return PriceCheck(
            has_reference=reference is not None,
            is_significant=False,
            difference=None,
            reference_age_days=None,
            is_stale=False,
            # Said out loud. Silence here would be read as "checked and fine",
            # and the difference matters to whoever is about to publish.
            message=(
                None
                if reference is not None
                else "No reference price recorded for this model, so nothing was checked."
            ),
        )

    entered_d = Decimal(str(entered))
    reference_d = Decimal(str(reference))

    if reference_d <= 0:
        return PriceCheck(
            has_reference=False,
            is_significant=False,
            difference=None,
            reference_age_days=None,
            is_stale=False,
            message="The recorded reference price is not a usable figure, so nothing was checked.",
        )

    difference = (entered_d - reference_d) / reference_d

    age_days: int | None = None
    is_stale = False
    if checked_on is not None:
        age_days = ((today or date.today()) - checked_on).days
        is_stale = age_days > STALE_AFTER_DAYS

    if abs(difference) < SIGNIFICANT_DIFFERENCE:
        return PriceCheck(
            has_reference=True,
            is_significant=False,
            difference=difference,
            reference_age_days=age_days,
            is_stale=is_stale,
            message=None,
        )

    direction = "above" if difference > 0 else "below"
    parts = [
        f"The entered price is {_percent(difference)} {direction} the reference "
        f"of ₹{reference_d:,.0f}."
    ]

    if abs(difference) >= LIKELY_TYPO_DIFFERENCE:
        parts.append("A gap this large is usually a digit out of place.")

    if source:
        parts.append(f"Reference source: {source}.")
    if checked_on is not None:
        parts.append(
            f"Checked {checked_on.isoformat()}"
            + (f" — {age_days} days ago, so it may be out of date." if is_stale else ".")
        )

    parts.append("Please verify before publishing.")

    return PriceCheck(
        has_reference=True,
        is_significant=True,
        difference=difference,
        reference_age_days=age_days,
        is_stale=is_stale,
        message=" ".join(parts),
    )
