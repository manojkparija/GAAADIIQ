"""
Turning a sentence a buyer typed into the answers the advisor needs.

`/ai-advisor` asks twelve questions. A buyer who already knows what they want
types the whole thing in one line:

    "I have Rs 12 lakh budget, family of 5, mostly city driving, 1,000 km/month"

This reads that sentence. Deliberately rule-based rather than a model call:
the phrasings are a small, closed set (lakh/L/crore, km per month/day, family
of N, city/highway), the answer feeds a *filter* rather than prose, and a
wrong parse here is expensive — it silently searches the wrong price band and
the buyer cannot see why. Rules can be tested exhaustively against real
phrasings; a model cannot, and would also cost a call and a timeout path on
the critical render.

The important design point is that this never guesses. Every field it did not
find stays None and is reported in `missing`, so the caller can ask for it
rather than assuming a default and quietly acting on it. Reading "1,000
km/month" and defaulting the family size to four would produce a confident
recommendation for a household that does not exist.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# ── Money ─────────────────────────────────────────────────────────────────────

# Indian buyers write budgets in lakh and crore far more often than in rupees,
# and they write them a dozen ways: "12 lakh", "12L", "12 lakhs", "Rs 12L",
# "₹12,00,000", "1.2 crore". The multiplier is captured separately from the
# number so "12.5 lakh" and "12,50,000" land on the same figure.
_LAKH = 100_000
_CRORE = 10_000_000

_UNIT_MULTIPLIER: dict[str, int] = {
    "l": _LAKH,
    "lac": _LAKH,
    "lacs": _LAKH,
    "lakh": _LAKH,
    "lakhs": _LAKH,
    "cr": _CRORE,
    "crore": _CRORE,
    "crores": _CRORE,
}

# A number, optionally with Indian digit grouping, optionally followed by a
# unit. "12", "12.5", "12,00,000" and "1,200" all match the number part.
_NUMBER = r"(\d+(?:[,\d]*\d)?(?:\.\d+)?)"
_UNIT = r"\s*(lakhs?|lacs?|crores?|cr|l)\b"

_MONEY_WITH_UNIT = re.compile(_NUMBER + _UNIT, re.IGNORECASE)

# "8 to 12 lakh", "8-12 lakh", "between 8 and 12 lakhs". The unit is written
# once and governs both figures; without this the lower bound parses as eight
# rupees and is discarded, leaving a range silently read as a ceiling.
_MONEY_RANGE = re.compile(
    _NUMBER + r"\s*(?:to|and|[-–—])\s*" + _NUMBER + _UNIT, re.IGNORECASE
)

# A bare rupee amount, which only counts as money when it is marked as such by
# a currency symbol or the word rupees. Without that marker "1000" in "1,000
# km/month" would be read as a thousand-rupee budget.
_MONEY_BARE = re.compile(
    r"(?:₹|rs\.?|inr|rupees)\s*" + _NUMBER + r"(?!\s*(?:lakhs?|lacs?|crores?|cr|l)\b)",
    re.IGNORECASE,
)

# An unmarked figure large enough that nothing else in a car-buying sentence
# is written that way — "budget 12,00,000". The distance lookahead is what
# keeps it from eating "50000 km/year", which is the one other place a number
# this size appears.
_MONEY_PLAIN_LARGE = re.compile(
    _NUMBER + r"(?!\s*(?:lakhs?|lacs?|crores?|cr|l)\b)"
    r"(?!\s*(?:kms?|kilometres|kilometers|seater|seats?|people|persons|members))",
    re.IGNORECASE,
)

# Below this an unmarked number is not a car budget. Marked amounts use the
# lower threshold in _parse_money, because "Rs 40,000" is at least explicit
# about being money even though it buys no car.
_PLAIN_MONEY_FLOOR = 50_000

# Sums that are money but are not the budget. "Rs 40,000 down payment, 6 lakh
# budget" states two figures and only one of them is the ceiling; without this
# the down payment becomes the bottom of a range and the search starts at
# forty thousand rupees.
_NOT_A_BUDGET = re.compile(
    r"\b(down[\s-]?payment|downpayment|emi|instal?ment|deposit|monthly|salary|"
    r"income|per month|booking amount|exchange|scrap)\b",
    re.IGNORECASE,
)

# Those words only disqualify a figure in the *same clause*. A fixed window of
# characters cannot express that: "Rs 40,000 down payment, 6 lakh budget" puts
# the two twenty-four characters apart, so any window wide enough to catch
# "down payment of Rs 40,000" also swallows the real budget in the next
# clause. Splitting on punctuation is what the writer already did.
_CLAUSE_BREAK = re.compile(r"[,;.]|\band\b|\bbut\b", re.IGNORECASE)


def _clause_around(text: str, start: int, end: int) -> str:
    """The text between the punctuation either side of a span."""
    left = 0
    for m in _CLAUSE_BREAK.finditer(text, 0, start):
        left = m.end()
    right_match = _CLAUSE_BREAK.search(text, end)
    right = right_match.start() if right_match else len(text)
    return text[left:right]

# A single figure is read as a ceiling unless one of these puts it at the
# bottom of the range instead. There is no matching "under/below" list because
# those only confirm the default reading.
_LOWER_BOUND_WORDS = re.compile(
    r"\b(above|over|more than|at least|min(?:imum)?|starting|upwards of)\b", re.IGNORECASE
)


def _to_number(digits: str) -> float:
    """'12,00,000' -> 1200000.0. Commas are grouping, wherever they fall."""
    return float(digits.replace(",", ""))


def _parse_money(text: str) -> list[tuple[int, int, int]]:
    """
    Every rupee amount in the text, as (value, start, end).

    Positions travel with the value because whether a figure is a ceiling or a
    floor is decided by the words in front of it, which the caller has to look
    up by position.
    """
    found: list[tuple[int, int, int]] = []

    def claim(value: float, start: int, end: int, floor: float) -> None:
        """Record an amount unless it is too small, spoken for, or covered."""
        if value < floor:
            return
        if _NOT_A_BUDGET.search(_clause_around(text, start, end)):
            return
        # Passes run widest-first, so an overlap means an earlier, more
        # specific reading already owns these characters.
        if any(s < end and start < e for _, s, e in found):
            return
        found.append((int(round(value)), start, end))

    # Widest first: a shared-unit range covers spans that the single-figure
    # patterns would otherwise claim one at a time and misread.
    for m in _MONEY_RANGE.finditer(text):
        multiplier = _UNIT_MULTIPLIER.get(m.group(3).lower())
        if multiplier is None:
            continue
        # Each figure claims its own span rather than the whole match, so the
        # second is not rejected as overlapping the first.
        claim(_to_number(m.group(1)) * multiplier, *m.span(1), 0)
        claim(_to_number(m.group(2)) * multiplier, *m.span(2), 0)

    for m in _MONEY_WITH_UNIT.finditer(text):
        multiplier = _UNIT_MULTIPLIER.get(m.group(2).lower())
        if multiplier is None:
            continue
        claim(_to_number(m.group(1)) * multiplier, m.start(), m.end(), 0)

    # A currency-marked figure under ten thousand is a typo or a per-unit
    # price, not a car budget. Reading "Rs 500" as one would return nothing
    # and look like the catalogue was empty.
    for m in _MONEY_BARE.finditer(text):
        claim(_to_number(m.group(1)), m.start(), m.end(), 10_000)

    for m in _MONEY_PLAIN_LARGE.finditer(text):
        claim(_to_number(m.group(1)), m.start(), m.end(), _PLAIN_MONEY_FLOOR)

    return sorted(found, key=lambda item: item[1])


# ── Distance ──────────────────────────────────────────────────────────────────

# Captured with its period so "1000 km/month" and "50 km a day" both normalise
# to the same unit. Everything downstream works in km per month, because that
# is what a fuel bill is quoted against.
# Longest alternative first: with "km" leading, "2000 kms/month" matches the
# "km", strands the "s", and then fails to find the period — so the whole
# distance is read as unstated.
_DISTANCE = re.compile(
    _NUMBER + r"\s*(?:kilometres|kilometers|kms|km)\s*"
    r"(?:/|per|a|every|each)?\s*"
    r"(month|months|mo|day|days|daily|week|weeks|year|years|annum|yr)?",
    re.IGNORECASE,
)

_PER_MONTH: dict[str, float] = {
    "day": 30.0, "days": 30.0, "daily": 30.0,
    "week": 52 / 12, "weeks": 52 / 12,
    "month": 1.0, "months": 1.0, "mo": 1.0,
    "year": 1 / 12, "years": 1 / 12, "annum": 1 / 12, "yr": 1 / 12,
}


def _parse_km_per_month(text: str) -> int | None:
    """Monthly distance, or None when the sentence did not state one."""
    for m in _DISTANCE.finditer(text):
        raw = _to_number(m.group(1))
        period = (m.group(2) or "").lower()
        if not period:
            # "1000 km" with no period stated. A month is the common reading
            # in Indian car-buying conversation, but it is a guess, and a
            # guess about the fuel bill is exactly what this module must not
            # make. Treated as unstated so the caller asks.
            continue
        factor = _PER_MONTH.get(period)
        if factor is None:
            continue
        km = int(round(raw * factor))
        if km <= 0:
            continue
        return km
    return None


# ── People ────────────────────────────────────────────────────────────────────

_WORD_NUMBERS: dict[str, int] = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
}

# "family of 5", "5 people", "we are 4", "5-seater", "seats 7".
_SEATS_PATTERNS = [
    re.compile(r"\bfamily\s+of\s+(\d+|" + "|".join(_WORD_NUMBERS) + r")\b", re.IGNORECASE),
    re.compile(r"\b(\d+)\s*[-\s]?seater\b", re.IGNORECASE),
    re.compile(r"\bseats?\s+(\d+)\b", re.IGNORECASE),
    re.compile(r"\b(\d+|" + "|".join(_WORD_NUMBERS) + r")\s+(?:people|persons|passengers|members|of us)\b", re.IGNORECASE),
    re.compile(r"\bwe\s+are\s+(\d+|" + "|".join(_WORD_NUMBERS) + r")\b", re.IGNORECASE),
]

# Above this, no passenger car answers the question and the number is more
# likely a misread distance or price than a household.
_MAX_SEATS = 10


def _parse_seats(text: str) -> int | None:
    for pattern in _SEATS_PATTERNS:
        m = pattern.search(text)
        if not m:
            continue
        token = m.group(1).lower()
        value = _WORD_NUMBERS.get(token)
        if value is None:
            try:
                value = int(token)
            except ValueError:
                continue
        if 1 <= value <= _MAX_SEATS:
            return value
    return None


# ── Categorical preferences ───────────────────────────────────────────────────

# Ordered because the first match wins and the more specific phrasing has to be
# tested first: "mostly city" and "city" both mean city, but "mixed" must not
# be shadowed by either.
_USAGE_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("mixed", re.compile(r"\b(mixed|both city and highway|city and highway|50[\s/-]*50)\b", re.IGNORECASE)),
    ("city", re.compile(r"\b(city|urban|office commute|daily commute|stop[\s-]?go|traffic)\b", re.IGNORECASE)),
    ("highway", re.compile(r"\b(highway|outstation|intercity|long drives?|road trips?|expressway)\b", re.IGNORECASE)),
]

_FUEL_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("hybrid", re.compile(r"\bhybrids?\b", re.IGNORECASE)),
    ("electric", re.compile(r"\b(electric|ev|battery)\b", re.IGNORECASE)),
    ("diesel", re.compile(r"\bdiesels?\b", re.IGNORECASE)),
    ("cng", re.compile(r"\bcng\b", re.IGNORECASE)),
    ("petrol", re.compile(r"\bpetrols?\b", re.IGNORECASE)),
]

_BODY_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    # "7-seater" deliberately does NOT appear here. It states a seat count,
    # which _parse_seats already reads and the scorer treats as a floor, so it
    # is satisfied by a three-row SUV as well as an MPV. Mapping it to a body
    # type instead would filter out every seven-seat SUV on the site.
    ("muv", re.compile(r"\b(muv|mpv|people carrier)\b", re.IGNORECASE)),
    ("suv", re.compile(r"\b(suv|crossover)\b", re.IGNORECASE)),
    ("sedan", re.compile(r"\bsedans?\b", re.IGNORECASE)),
    ("hatchback", re.compile(r"\b(hatchbacks?|hatch)\b", re.IGNORECASE)),
]

_TRANSMISSION_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("automatic", re.compile(r"\b(automatic|auto|amt|cvt|dct|dsg)\b", re.IGNORECASE)),
    ("manual", re.compile(r"\bmanuals?\b", re.IGNORECASE)),
]

_CONDITION_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("used", re.compile(r"\b(used|second[\s-]?hand|pre[\s-]?owned)\b", re.IGNORECASE)),
    ("new", re.compile(r"\b(brand[\s-]?new|new car|showroom fresh)\b", re.IGNORECASE)),
]


def _first_match(text: str, patterns: list[tuple[str, re.Pattern[str]]]) -> str | None:
    for value, pattern in patterns:
        if pattern.search(text):
            return value
    return None


# ── Result ────────────────────────────────────────────────────────────────────


@dataclass
class BuyerNeed:
    """
    What the sentence actually said. Anything it did not say stays None.

    There is no `confidence` score here on purpose. A number between 0 and 1
    invites the caller to act on a weak parse anyway, and the honest signal is
    simply which fields were found — which is `missing`.
    """

    budget_min: int | None = None
    budget_max: int | None = None
    seats: int | None = None
    km_per_month: int | None = None
    usage: str | None = None
    fuel: str | None = None
    body: str | None = None
    transmission: str | None = None
    condition: str | None = None

    #: Field names the sentence did not answer, for the caller to ask about.
    missing: list[str] = field(default_factory=list)
    #: One line per understood field, for showing the buyer what was read.
    understood: list[str] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        """True when nothing usable was found — the caller should not search."""
        return not any(
            (self.budget_min, self.budget_max, self.seats,
             self.km_per_month, self.usage, self.fuel, self.body)
        )


def _format_money(value: int) -> str:
    if value >= _CRORE:
        return f"₹{value / _CRORE:g} crore"
    if value >= _LAKH:
        return f"₹{value / _LAKH:g} lakh"
    return f"₹{value:,}"


# Fields a recommendation is materially worse without. Not every field: asking
# a buyer for a transmission preference they did not volunteer adds a step for
# something the scorer treats as a nudge anyway.
_WANTED = ("budget", "seats", "km_per_month", "usage")


def parse_query(text: str) -> BuyerNeed:
    """
    Read a buyer's sentence.

    Returns what was found and what was not. Never raises and never fills a
    gap with a default — an unanswered question is reported, not invented.
    """
    need = BuyerNeed()
    if not text or not text.strip():
        need.missing = list(_WANTED)
        return need

    text = text.strip()

    # ── Budget ────────────────────────────────────────────────────────────
    amounts = _parse_money(text)
    if len(amounts) >= 2:
        # Two figures in one sentence is a range: "between 8 and 12 lakh".
        low, high = sorted(a[0] for a in amounts[:2])
        need.budget_min, need.budget_max = low, high
        need.understood.append(f"Budget {_format_money(low)} to {_format_money(high)}")
    elif len(amounts) == 1:
        value, start, _ = amounts[0]
        # The words immediately before the figure decide which end it is. A
        # short window, because "under" three clauses earlier is not about
        # this number.
        prefix = text[max(0, start - 30):start]
        if _LOWER_BOUND_WORDS.search(prefix):
            need.budget_min = value
            need.understood.append(f"Budget above {_format_money(value)}")
        else:
            # The default reading of a single figure is a ceiling, whether or
            # not "under" was said: "I have 12 lakh" means at most 12 lakh.
            need.budget_max = value
            need.understood.append(f"Budget up to {_format_money(value)}")

    # ── The rest ──────────────────────────────────────────────────────────
    need.seats = _parse_seats(text)
    if need.seats:
        need.understood.append(f"{need.seats} people travelling")

    need.km_per_month = _parse_km_per_month(text)
    if need.km_per_month:
        need.understood.append(f"{need.km_per_month:,} km a month")

    need.usage = _first_match(text, _USAGE_PATTERNS)
    if need.usage:
        need.understood.append(f"Mostly {need.usage} driving")

    need.fuel = _first_match(text, _FUEL_PATTERNS)
    if need.fuel:
        need.understood.append(f"{need.fuel.upper() if need.fuel == 'cng' else need.fuel.capitalize()} preferred")

    need.body = _first_match(text, _BODY_PATTERNS)
    if need.body:
        need.understood.append(f"{need.body.upper() if need.body in ('suv', 'muv') else need.body.capitalize()} body style")

    need.transmission = _first_match(text, _TRANSMISSION_PATTERNS)
    if need.transmission:
        need.understood.append(f"{need.transmission.capitalize()} gearbox")

    need.condition = _first_match(text, _CONDITION_PATTERNS)
    if need.condition:
        need.understood.append(f"{need.condition.capitalize()} cars")

    # A stated seat count is a floor, not a target: a family of five needs at
    # least five seats and is well served by a seven-seater. Applied by the
    # scorer, recorded here so the reasoning is visible in one place.
    present = {
        "budget": need.budget_min is not None or need.budget_max is not None,
        "seats": need.seats is not None,
        "km_per_month": need.km_per_month is not None,
        "usage": need.usage is not None,
    }
    need.missing = [name for name in _WANTED if not present[name]]

    return need
