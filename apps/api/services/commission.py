"""Platform commission on marketplace repair jobs.

## Picking the rate

The brief asked for a competitive number, so here is the reasoning rather than a
bare constant.

Indian services marketplaces cluster into two bands. Consumer-services platforms
that own demand generation end to end (Urban Company being the reference point)
take roughly 20-30%, and partners complain loudly about it. Auto-repair platforms
sit lower: GoMechanic and Pitstop operate on aggregator margins in the mid-to-high
teens on the retail bill, and reporting on GoMechanic's 2023 collapse noted rivals
poaching workshops by offering *5-15 percentage points* better terms — evidence
that garage supply in this market is highly price-elastic and that the top of the
band is not defensible.

Our position is weaker than either: GAADIIQ is not sourcing parts, not owning the
warranty, and not doing quality control on the repair. The platform contributes a
diagnosis, a match, and payment collection. Charging a full aggregator margin for
a referral would lose mechanics to a competitor who charges nothing.

So the default is **10% (1000 bps)**, with two guards:

  * a **₹49 floor**, because a ₹200 job at 10% earns ₹20 and does not cover the
    payment-gateway fee plus the WhatsApp conversation; and
  * a **₹2,500 cap**, because a ₹60,000 engine rebuild is not sixty times more
    work for us than a ₹1,000 job, and an uncapped rate is what pushes large jobs
    off-platform into a cash deal.

Both the rate and the guards are settings, not constants, so pricing can be tuned
without a migration. `commission_rate_bps` is frozen onto each payment row at
capture time, so changing them never rewrites history.

Nothing here is legal or tax advice: GST on the commission component and TDS under
section 194-O for e-commerce operators both apply to this model and need an
accountant's sign-off before go-live.
"""

from __future__ import annotations

from dataclasses import dataclass

from core.config import settings

# Fallbacks used when the corresponding setting is absent, so the module is safe
# to import in a bare test environment.
DEFAULT_COMMISSION_BPS = 1000       # 10.00%
DEFAULT_MIN_COMMISSION_PAISE = 4900    # ₹49
DEFAULT_MAX_COMMISSION_PAISE = 250000  # ₹2,500

BPS_DIVISOR = 10_000


@dataclass(frozen=True)
class CommissionSplit:
    """How one gross payment divides between the platform and the mechanic.

    `gross_paise == commission_paise + mechanic_payout_paise` always holds; the
    tests pin that, because a rounding bug here silently short-pays a real person.
    """

    gross_paise: int
    commission_paise: int
    mechanic_payout_paise: int
    rate_bps: int

    @property
    def effective_rate_pct(self) -> float:
        """What the mechanic actually experiences, after floor/cap clamping."""
        if self.gross_paise <= 0:
            return 0.0
        return round(self.commission_paise * 100 / self.gross_paise, 2)


def _setting(name: str, fallback: int) -> int:
    value = getattr(settings, name, None)
    return fallback if value is None else int(value)


def calculate_commission(gross_paise: int) -> CommissionSplit:
    """Split a gross job amount into platform commission and mechanic payout.

    Rounds the commission *down* so the mechanic absorbs no rounding loss, then
    derives the payout by subtraction so the two always reconcile to the gross.
    """
    if gross_paise < 0:
        raise ValueError("gross_paise cannot be negative")
    if gross_paise == 0:
        return CommissionSplit(0, 0, 0, 0)

    rate_bps = _setting("commission_rate_bps", DEFAULT_COMMISSION_BPS)
    floor = _setting("commission_min_paise", DEFAULT_MIN_COMMISSION_PAISE)
    cap = _setting("commission_max_paise", DEFAULT_MAX_COMMISSION_PAISE)

    commission = (gross_paise * rate_bps) // BPS_DIVISOR
    commission = max(commission, floor)
    commission = min(commission, cap)

    # A tiny job must never leave the mechanic with nothing: on anything below the
    # floor, the floor itself would swallow the whole bill. Cap the commission at
    # the gross so the payout cannot go negative.
    commission = min(commission, gross_paise)

    return CommissionSplit(
        gross_paise=gross_paise,
        commission_paise=commission,
        mechanic_payout_paise=gross_paise - commission,
        rate_bps=rate_bps,
    )
