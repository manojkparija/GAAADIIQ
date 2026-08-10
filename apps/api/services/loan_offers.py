"""Turning an application into a ranked set of lender offers.

The interesting decision here is what "best bank" means. The obvious answer is
the lowest interest rate, and it is wrong often enough to matter: a lender
quoting 8.45% with a ₹10,000 processing fee costs more over three years than one
quoting 8.75% with a ₹2,000 fee on a small loan. So offers are ranked by the
total cost of credit — interest plus fees over the actual tenure — which is the
number the borrower pays and the one a comparison page owes them.

The second decision is that ineligible lenders are still returned, with the
reason. Hiding them produces a short unexplained list; showing them tells the
applicant what to change ("₹5,000 more monthly income and three more lenders
open up"), which is the more useful page.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import Decimal

from models.lending_partner import CreditBand, EmploymentType, LenderRateSlab, LendingPartner

#: Rounded to whole rupees everywhere. Paise on an EMI is noise, and the figure
#: is indicative regardless — the lender's own amortisation will differ slightly.
_MONEY = 2


def monthly_emi(principal: float, annual_rate_pct: float, tenure_months: int) -> float:
    """Standard reducing-balance EMI.

    EMI = P·r·(1+r)^n / ((1+r)^n − 1), r = annual rate / 1200.

    Matches routers/loans.py's calculator deliberately: a quote that disagreed
    with the site's own EMI calculator on the same inputs would be the first
    thing a buyer noticed and the last thing they trusted.
    """
    if tenure_months <= 0:
        raise ValueError("tenure_months must be positive")
    r = annual_rate_pct / 1200
    if r == 0:
        return round(principal / tenure_months, _MONEY)
    factor = math.pow(1 + r, tenure_months)
    return round(principal * r * factor / (factor - 1), _MONEY)


@dataclass(frozen=True)
class OfferQuote:
    """One lender's answer, eligible or not."""

    partner: LendingPartner
    is_eligible: bool
    ineligible_reason: str | None = None
    annual_rate_pct: float | None = None
    approved_amount: float | None = None
    tenure_months: int | None = None
    emi: float | None = None
    total_interest: float | None = None
    processing_fee: float | None = None
    total_cost: float | None = None


def _f(value) -> float:
    """Numeric columns come back as Decimal; the arithmetic here is float."""
    return float(value) if isinstance(value, Decimal) else float(value or 0)


def rate_for(
    partner: LendingPartner,
    band: CreditBand,
    employment: EmploymentType,
) -> LenderRateSlab | None:
    """The slab that applies, most specific first.

    A slab typed to the applicant's employment wins over the lender's general
    card for that band. Falls back to `unknown`, which is where a lender puts
    its worst published rate — an applicant we know nothing about is priced as
    the lender prices that, not excluded and not given the benefit of the doubt.
    """
    slabs = list(partner.rate_slabs)

    for candidate_band in (band, CreditBand.unknown):
        typed = [
            s for s in slabs
            if s.credit_band == candidate_band and s.employment_type == employment
        ]
        if typed:
            return typed[0]
        general = [
            s for s in slabs
            if s.credit_band == candidate_band and s.employment_type is None
        ]
        if general:
            return general[0]
    return None


def quote(
    partner: LendingPartner,
    *,
    vehicle_price: float,
    loan_amount: float,
    tenure_months: int,
    monthly_income: float,
    existing_emi: float,
    band: CreditBand,
    employment: EmploymentType,
    vehicle_condition_used: bool,
    vehicle_age_years: int | None,
) -> OfferQuote:
    """What one lender would offer, or why it would not.

    Checks run in the order an underwriter would care about, and the first
    failure is the one reported — a lender that declines on three counts is
    still one conversation, and listing all three reads as piling on.
    """
    if vehicle_condition_used and not partner.finances_used_cars:
        return OfferQuote(partner, False, "Finances new cars only")

    if (
        vehicle_condition_used
        and vehicle_age_years is not None
        and vehicle_age_years > partner.max_vehicle_age_years
    ):
        return OfferQuote(
            partner, False,
            f"Vehicle is older than {partner.max_vehicle_age_years} years",
        )

    if monthly_income < _f(partner.min_monthly_income):
        return OfferQuote(
            partner, False,
            f"Needs monthly income of ₹{_f(partner.min_monthly_income):,.0f}",
        )

    if not (partner.min_tenure_months <= tenure_months <= partner.max_tenure_months):
        return OfferQuote(
            partner, False,
            f"Offers {partner.min_tenure_months}-{partner.max_tenure_months} month tenures",
        )

    slab = rate_for(partner, band, employment)
    if slab is None:
        return OfferQuote(partner, False, "No published rate for this profile")

    # --- How much they will actually lend -----------------------------------
    # Two caps, and the tighter one wins. LTV bounds the loan against the car;
    # FOIR bounds the EMI against the income. A buyer asking for more than
    # either gets a smaller approved amount rather than a refusal, because a
    # smaller loan is usually an acceptable answer and a flat no never is.
    ltv_pct = _f(slab.max_ltv_pct) if slab.max_ltv_pct is not None else _f(partner.max_ltv_pct)
    ltv_cap = vehicle_price * ltv_pct / 100

    rate = _f(slab.annual_rate_pct)
    headroom = monthly_income * _f(partner.max_foir_pct) / 100 - existing_emi
    if headroom <= 0:
        return OfferQuote(
            partner, False,
            "Existing EMIs already use the income this lender allows",
        )

    # Invert the EMI formula for the principal that fits the headroom.
    r = rate / 1200
    factor = math.pow(1 + r, tenure_months)
    foir_cap = headroom * (factor - 1) / (r * factor) if r else headroom * tenure_months

    approved = min(loan_amount, ltv_cap, foir_cap)
    if approved < _f(partner.min_loan_amount):
        return OfferQuote(
            partner, False,
            f"Minimum loan is ₹{_f(partner.min_loan_amount):,.0f}",
        )
    approved = min(approved, _f(partner.max_loan_amount))

    emi = monthly_emi(approved, rate, tenure_months)
    total_interest = round(emi * tenure_months - approved, _MONEY)
    fee = min(
        max(approved * _f(partner.processing_fee_pct) / 100, _f(partner.processing_fee_min)),
        _f(partner.processing_fee_max),
    )
    fee = round(fee, _MONEY)

    return OfferQuote(
        partner=partner,
        is_eligible=True,
        annual_rate_pct=rate,
        approved_amount=round(approved, _MONEY),
        tenure_months=tenure_months,
        emi=emi,
        total_interest=total_interest,
        processing_fee=fee,
        # Interest plus fees: what the credit costs. Not the total payable,
        # which includes the principal and so ranks a bigger approved amount
        # as worse than a smaller one.
        total_cost=round(total_interest + fee, _MONEY),
    )


def rank(quotes: list[OfferQuote]) -> list[OfferQuote]:
    """Order the eligible offers cheapest first; ineligible ones last.

    Cheapest by total cost of credit, not by headline rate — see the module
    docstring. Ties break on the larger approved amount: two loans that cost the
    same are not equal if one of them lends more.
    """
    eligible = [q for q in quotes if q.is_eligible]
    rejected = [q for q in quotes if not q.is_eligible]
    eligible.sort(key=lambda q: (q.total_cost or 0, -(q.approved_amount or 0)))
    rejected.sort(key=lambda q: q.partner.sort_order)
    return eligible + rejected
