"""
What a car is likely to be worth to a trade buyer in 30, 60 or 90 days.

Two things separate this from the resale curve next door:

RETAIL IS NOT WHOLESALE. `resale_forecast` projects what a private buyer pays.
A dealer selling into the trade gets less — the trade buyer has to recondition
it, floor it, and sell it again with a margin. That discount is the whole
reason a dealer needs a separate number, and quoting the retail curve at them
would consistently overstate what they can actually get.

MONTHS, NOT YEARS. The retail curve answers "what will this be worth when I
sell in three years". A dealer with stock on the lot is asking "how much does
waiting another 60 days cost me", which is a question about the next quarter.

WHAT THIS DOES NOT CLAIM

It is not a market forecast. It does not know that the festive season lifts
prices, that a facelift is coming, or that fuel policy is about to move — and
so it does not pretend to. It is depreciation at short horizons plus a trade
discount, stated as such, which is a floor for reasoning rather than a
prediction to trade against.

The discount below is the standard shape of the Indian used-car trade rather
than a figure measured from GAADIIQ's own sales, because GAADIIQ has no
wholesale transactions to measure. That is stated in the response, on every
response, so nobody mistakes it for something the platform observed.
"""

from __future__ import annotations

import logging

logger = logging.getLogger("gaadiiq.wholesale")

#: Horizons a dealer actually plans around.
HORIZONS_DAYS = (30, 60, 90)

#: What the trade pays against retail, before condition and demand.
#:
#: The gap covers reconditioning, the cost of holding the car, and the trade
#: buyer's own margin. 15% is the conservative end of the range usually quoted
#: for the Indian market; it is a convention, not a measurement, and the API
#: says so wherever the number is shown.
TRADE_DISCOUNT = 0.15

#: Annual depreciation applied at short horizons.
#:
#: Deliberately flat rather than the tiered retail curve: over 90 days the
#: difference between a year-two and a year-five rate is a few hundred rupees,
#: and a tiered curve would imply a precision that a three-month projection
#: does not have.
ANNUAL_DEPRECIATION = 0.12

#: Cars past this age are priced by condition and service history, not by any
#: curve, and the projection says so instead of producing a number.
MAX_MEANINGFUL_AGE = 15


def wholesale_forecast(retail_price: int, age_years: int = 0) -> dict:
    """
    Trade value now and at each horizon.

    `retail_price` is what the car would fetch from a private buyer today.
    Returns the horizons plus the cost of holding, which is the figure the
    dealer is actually weighing: what another month on the lot takes off.
    """
    if retail_price <= 0:
        return {
            "available": False,
            "reason": "No retail price to work from.",
            "horizons": [],
        }

    if age_years > MAX_MEANINGFUL_AGE:
        return {
            "available": False,
            "reason": (
                f"Cars over {MAX_MEANINGFUL_AGE} years are priced by condition and "
                "service history rather than by any depreciation curve."
            ),
            "horizons": [],
        }

    today = int(round(retail_price * (1 - TRADE_DISCOUNT)))

    horizons = []
    for days in HORIZONS_DAYS:
        remaining = (1 - ANNUAL_DEPRECIATION) ** (days / 365)
        value = int(round(today * remaining))
        horizons.append({
            "days": days,
            "value": value,
            # The number the decision turns on: what waiting costs.
            "cost_of_waiting": today - value,
        })

    return {
        "available": True,
        "retail_price": retail_price,
        "wholesale_today": today,
        "horizons": horizons,
        "trade_discount_pct": int(TRADE_DISCOUNT * 100),
        # On every response. A dealer must be able to tell a convention from a
        # measurement, and this platform has no wholesale sales to measure.
        "basis": (
            f"Trade value is estimated at {int(TRADE_DISCOUNT * 100)}% below retail — "
            "the usual allowance for reconditioning, holding cost and the trade "
            "buyer's margin. It is a market convention, not a figure measured from "
            "sales on GAADIIQ. The projection is depreciation only: it does not "
            "account for seasonal demand, a facelift, or policy changes."
        ),
    }
