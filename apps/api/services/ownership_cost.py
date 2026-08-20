"""
What a car costs over five years, and how much of that is actually known.

The advisor page has shown a "5-year ownership cost" since it was built. The
figure was assembled in the browser from this:

    const RESALE = { 'Maruti Suzuki': 0.65, 'Toyota': 0.62, ... };
    const resalePct = RESALE[car.make] || 0.52;

Eight hardcoded brand ratios and a flat 0.52 for every other manufacturer,
rendered to the rupee and presented to a buyer as analysis. Nothing about the
output said which parts were computed from the car in front of them and which
were a constant somebody typed. That is the trade `services/credit_bureau.py`
refuses by raising rather than returning a plausible score, and the same
reasoning applies with more force here, because a buyer will act on this.

So every component of the total carries its `basis`:

  calculated  derived from figures belonging to this car — its price, its
              published mileage, a rate the caller supplied. Reproducible.
  estimated   a rule applied because the specific number is not knowable from
              what we hold. The rule is stated in `note` so a reader can judge
              it, and the figure is rounded coarsely so it does not perform a
              precision it does not have.
  unavailable required input missing. Contributes nothing to the total and
              says so, rather than silently defaulting to zero.

`CostBreakdown.excludes` names every component that could not be computed. A
total that quietly omits fuel because mileage was missing is worse than no
total, since it is lower than the truth and looks complete.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

# ── Fuel prices ───────────────────────────────────────────────────────────────
#
# Pump prices differ by state and change weekly. These are a stated assumption,
# not a lookup, so they travel with the date they were set and are returned to
# the caller for display: a running cost is only meaningful next to the price
# it assumed. The EV calculator page makes the same figures user-editable,
# which is the honest treatment, and this exposes them for the same reason.
FUEL_PRICES_AS_OF = date(2026, 8, 1)
FUEL_PRICES: dict[str, float] = {
    "petrol": 106.0,   # ₹/litre
    "diesel": 94.0,    # ₹/litre
    "cng": 88.0,       # ₹/kg
    "hybrid": 106.0,   # runs on petrol
    "electric": 9.0,   # ₹/kWh, domestic slab
}

# Loan terms the EMI is quoted on. Assumptions, shown with the figure.
DEFAULT_DOWN_PAYMENT_PCT = 0.20
DEFAULT_INTEREST_PCT = 9.0
DEFAULT_TENURE_MONTHS = 60

OWNERSHIP_YEARS = 5

# Annual insurance as a share of the car's current value. A genuine premium
# depends on the owner's age, city, claim history and add-ons, none of which
# we hold, so this is a rule and is labelled as one.
_INSURANCE_RATE_YEAR_ONE = 0.035
_INSURANCE_RATE_LATER = 0.025

# Annual servicing, by price segment rather than by brand. Segment is the
# honest granularity: it reflects that parts and labour scale with the car,
# which is true, without asserting a brand-specific figure nobody measured.
# Rounded to the nearest thousand on output so it does not read as precise.
_MAINTENANCE_BY_SEGMENT: list[tuple[int, int, str]] = [
    (600_000, 9_000, "small hatchback segment"),
    (1_000_000, 12_000, "mid hatchback and compact sedan segment"),
    (1_800_000, 18_000, "compact SUV and sedan segment"),
    (3_500_000, 30_000, "large SUV and premium segment"),
    (10**12, 60_000, "luxury segment"),
]


@dataclass
class CostComponent:
    """One line of the ownership total."""

    label: str
    #: Rupees over the whole ownership period. None when unavailable.
    amount: int | None
    #: "calculated" | "estimated" | "unavailable"
    basis: str
    #: What was assumed or what is missing. Always populated for the
    #: non-calculated cases, because that is the whole point of the field.
    note: str = ""

    @property
    def is_known(self) -> bool:
        return self.amount is not None


@dataclass
class CostBreakdown:
    components: list[CostComponent] = field(default_factory=list)
    #: Sum of known components. Never includes a guessed stand-in.
    total: int = 0
    #: Labels of components that could not be computed.
    excludes: list[str] = field(default_factory=list)
    #: True when any part of the total came from a rule rather than the car.
    has_estimates: bool = False
    #: The assumptions used, for display next to the figure.
    assumptions: dict = field(default_factory=dict)


# ── Mileage ───────────────────────────────────────────────────────────────────

# Mileage is free text on a variant ("21.5 kmpl", "18-20 km/l", "410 km range")
# because that is how manufacturers publish it. A range is read at its lower
# bound: a running cost quoted at the optimistic end of a claimed range is the
# number the buyer will not achieve.
_MILEAGE = re.compile(r"(\d+(?:\.\d+)?)", re.IGNORECASE)


def parse_mileage(raw: str | None) -> float | None:
    """
    Efficiency as a number, or None when nothing usable was written.

    Returns km per litre (or per kg, or per kWh — the unit follows the fuel).
    """
    if not raw or not isinstance(raw, str):
        return None
    values = [float(m) for m in _MILEAGE.findall(raw)]
    values = [v for v in values if v > 0]
    if not values:
        return None
    # Lower bound of whatever was written, and a sanity ceiling: a "mileage"
    # above 100 is a range figure in km, not an efficiency, and using it would
    # underestimate the fuel bill by an order of magnitude.
    low = min(values)
    return low if low <= 100 else None


# ── Components ────────────────────────────────────────────────────────────────


def calc_emi(principal: float, annual_rate_pct: float, months: int) -> int:
    """Standard reducing-balance EMI, rounded to the rupee."""
    if principal <= 0 or months <= 0:
        return 0
    r = annual_rate_pct / 12 / 100
    if r == 0:
        return int(round(principal / months))
    factor = (1 + r) ** months
    return int(round(principal * r * factor / (factor - 1)))


def fuel_cost(
    *,
    fuel: str,
    mileage_raw: str | None,
    km_per_month: int | None,
    years: int = OWNERSHIP_YEARS,
) -> CostComponent:
    """Fuel over the period, or an explicit unavailable."""
    fuel_key = (fuel or "").strip().lower()
    price = FUEL_PRICES.get(fuel_key)

    if km_per_month is None:
        return CostComponent(
            "Fuel", None, "unavailable",
            "No monthly running distance given, so fuel cannot be worked out.",
        )
    if price is None:
        return CostComponent(
            "Fuel", None, "unavailable", f"No pump price held for {fuel or 'this fuel'}.",
        )

    # EV specs publish *range*, not efficiency: "410 km" has to be divided by
    # the battery size to give a cost per km, and the battery size is not
    # recorded. Assuming one would put a precise-looking running cost on the
    # page that nothing supports, so the electric case reports unavailable.
    efficiency = None if fuel_key == "electric" else parse_mileage(mileage_raw)
    if efficiency is None:
        missing = (
            "Electric running cost needs battery capacity, which is not recorded "
            "for this variant."
            if fuel_key == "electric"
            else "No published mileage recorded for this variant."
        )
        return CostComponent("Fuel", None, "unavailable", missing)

    total = (km_per_month * 12 * years / efficiency) * price
    unit = "km/kWh" if fuel_key == "electric" else ("km/kg" if fuel_key == "cng" else "kmpl")
    return CostComponent(
        "Fuel", int(round(total)), "calculated",
        f"{km_per_month:,} km a month at {efficiency:g} {unit}, "
        f"fuel at ₹{price:g}.",
    )


def insurance_cost(price: int, years: int = OWNERSHIP_YEARS) -> CostComponent:
    """
    Insurance over the period, as a rule on the car's declining value.

    Labelled an estimate because a real premium turns on the owner — age,
    city, claim history, add-ons — and none of that is known here.
    """
    if price <= 0:
        return CostComponent("Insurance", None, "unavailable", "Car has no price recorded.")

    total = price * _INSURANCE_RATE_YEAR_ONE
    value = price
    for _ in range(1, years):
        # Premiums track the insured declared value, which falls with the car.
        value *= 0.85
        total += value * _INSURANCE_RATE_LATER

    return CostComponent(
        "Insurance", int(round(total / 1000) * 1000), "estimated",
        f"{_INSURANCE_RATE_YEAR_ONE * 100:g}% of value in year one and "
        f"{_INSURANCE_RATE_LATER * 100:g}% after. A real quote depends on your "
        "city, age and claim history.",
    )


def maintenance_cost(price: int, years: int = OWNERSHIP_YEARS) -> CostComponent:
    """
    Servicing over the period, by price segment.

    Segment rather than brand on purpose. A per-brand figure would assert
    something specific about that manufacturer that nobody here measured;
    segment only asserts that parts and labour scale with the car, which is
    both true and visible in the rule.
    """
    if price <= 0:
        return CostComponent("Maintenance", None, "unavailable", "Car has no price recorded.")

    annual, segment = next(
        (amount, name) for ceiling, amount, name in _MAINTENANCE_BY_SEGMENT if price <= ceiling
    )
    return CostComponent(
        "Maintenance", annual * years, "estimated",
        f"About ₹{annual:,} a year for the {segment}, over {years} years. "
        "Scheduled servicing only — not wear items or repairs.",
    )


def depreciation_cost(price: int, resale_value: int | None, source: str) -> CostComponent:
    """
    Value lost over the period.

    `resale_value` comes from services.resale_forecast, which labels its own
    source, and that label is carried through rather than restated — a figure
    Gemini produced for a specific model and one off the generic curve are
    different kinds of claim and the buyer should be able to tell.
    """
    if price <= 0 or resale_value is None:
        return CostComponent(
            "Depreciation", None, "unavailable",
            "No resale projection available for this car.",
        )

    lost = max(0, price - resale_value)
    basis = "calculated" if source == "ai" else "estimated"
    note = (
        f"Projected resale ₹{resale_value:,} after five years."
        if source == "ai"
        else f"Projected resale ₹{resale_value:,} after five years, from a "
             "general depreciation curve rather than data on this model."
    )
    return CostComponent("Depreciation", int(lost), basis, note)


# ── Assembly ──────────────────────────────────────────────────────────────────


def build_breakdown(
    *,
    price: int,
    fuel: str,
    mileage_raw: str | None,
    km_per_month: int | None,
    resale_value: int | None,
    resale_source: str,
    years: int = OWNERSHIP_YEARS,
    down_payment_pct: float = DEFAULT_DOWN_PAYMENT_PCT,
    interest_pct: float = DEFAULT_INTEREST_PCT,
    tenure_months: int = DEFAULT_TENURE_MONTHS,
) -> CostBreakdown:
    """
    The whole five-year picture, with every component's provenance attached.

    Note what is *not* in the total: the purchase price itself. The total is
    the cost of running and holding the car, and adding the price to a total
    that also subtracts nothing for resale would double-count the capital.
    Depreciation is the line that represents the money the car consumed.
    """
    components = [
        fuel_cost(fuel=fuel, mileage_raw=mileage_raw, km_per_month=km_per_month, years=years),
        insurance_cost(price, years),
        maintenance_cost(price, years),
        depreciation_cost(price, resale_value, resale_source),
    ]

    known = [c for c in components if c.is_known]
    breakdown = CostBreakdown(
        components=components,
        total=sum(c.amount or 0 for c in known),
        excludes=[c.label for c in components if not c.is_known],
        has_estimates=any(c.basis == "estimated" for c in known),
        assumptions={
            "years": years,
            "fuel_prices": dict(FUEL_PRICES),
            "fuel_prices_as_of": FUEL_PRICES_AS_OF.isoformat(),
            "down_payment_pct": down_payment_pct * 100,
            "interest_pct": interest_pct,
            "tenure_months": tenure_months,
        },
    )
    return breakdown


def monthly_emi(
    price: int,
    *,
    down_payment_pct: float = DEFAULT_DOWN_PAYMENT_PCT,
    interest_pct: float = DEFAULT_INTEREST_PCT,
    tenure_months: int = DEFAULT_TENURE_MONTHS,
) -> CostComponent:
    """
    The monthly instalment on the stated terms.

    Calculated, not estimated: given a price, a rate and a tenure this is
    arithmetic with one right answer. The *terms* are assumptions, and they
    travel in the note so the figure can be checked.
    """
    if price <= 0:
        return CostComponent("Monthly EMI", None, "unavailable", "Car has no price recorded.")

    principal = price * (1 - down_payment_pct)
    emi = calc_emi(principal, interest_pct, tenure_months)
    return CostComponent(
        "Monthly EMI", emi, "calculated",
        f"On {down_payment_pct * 100:g}% down (₹{int(price * down_payment_pct):,}), "
        f"{interest_pct:g}% for {tenure_months // 12} years. Your rate depends on "
        "your credit profile.",
    )
