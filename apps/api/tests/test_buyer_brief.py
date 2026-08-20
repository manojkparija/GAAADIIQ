"""
Reading a buyer's sentence into search criteria.

Every case here is a phrasing a person actually types. The ones worth the most
are not the happy path — they are the near-misses that a regex gets wrong in a
way nobody notices, because a misparse produces a confident recommendation for
requirements the buyer never stated:

  - a number that is money vs. one that is distance ("1,000 km/month")
  - a sum that is money but not the budget (a down payment, an EMI)
  - a range whose unit is written once ("8 to 12 lakh")
  - a seat count that must not become a body type

Plain functions, not a class: the project collects only `Test*Suite` and
`Test*Case`, so a differently named class would run zero tests and pass.
"""

import pytest

from services.buyer_brief import parse_query

LAKH = 100_000


# ── The reported scenario ─────────────────────────────────────────────────────


def test_reads_the_whole_reported_sentence():
    """The exact line from the feature request, read in full."""
    need = parse_query(
        "I have ₹12 lakh budget, family of 5, mostly city driving, 1,000 km/month"
    )

    assert need.budget_max == 12 * LAKH
    assert need.seats == 5
    assert need.km_per_month == 1000
    assert need.usage == "city"
    # Everything the advisor needs was stated, so it must not ask anything.
    assert need.missing == []


def test_distance_is_not_read_as_money():
    """
    The single most damaging confusion available here.

    "1,000 km/month" contains a comma-grouped number. Read as rupees it would
    cap the budget at a thousand and return an empty result set that looks
    exactly like an empty catalogue.
    """
    need = parse_query("1,000 km/month")
    assert need.budget_max is None
    assert need.budget_min is None
    assert need.km_per_month == 1000


# ── Money ─────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "text,expected",
    [
        ("12 lakh", 12 * LAKH),
        ("₹12L", 12 * LAKH),
        ("Rs 12 lakhs", 12 * LAKH),
        ("12.5 lakh", 1_250_000),
        ("budget 12,00,000", 12 * LAKH),
        ("1.2 crore", 12_000_000),
        ("INR 45,00,000", 4_500_000),
    ],
)
def test_budget_phrasings(text, expected):
    assert parse_query(text).budget_max == expected


def test_a_lone_figure_is_a_ceiling():
    """"I have 12 lakh" means at most twelve, not exactly twelve."""
    need = parse_query("I have 12 lakh")
    assert need.budget_max == 12 * LAKH
    assert need.budget_min is None


def test_above_makes_a_figure_a_floor():
    need = parse_query("above 20 lakh")
    assert need.budget_min == 20 * LAKH
    assert need.budget_max is None


@pytest.mark.parametrize(
    "text", ["between 8 and 12 lakh", "8 to 12 lakh", "8-12 lakh", "8–12 lakhs"]
)
def test_a_range_shares_one_unit(text):
    """
    The unit is written once and governs both figures.

    Without this the lower bound parses as eight rupees, is discarded as too
    small, and the range silently collapses to a ceiling — a buyer who said
    "at least 8 lakh" gets shown two-lakh cars.
    """
    need = parse_query(text)
    assert need.budget_min == 8 * LAKH
    assert need.budget_max == 12 * LAKH


@pytest.mark.parametrize(
    "text",
    [
        "Rs 40,000 down payment, 6 lakh budget",
        "down payment of Rs 2,00,000 and budget 6 lakh",
        "EMI under 15000, car budget 6 lakh",
        "my monthly salary is 80,000, budget 6 lakh",
    ],
)
def test_money_that_is_not_the_budget_is_ignored(text):
    """
    A sentence can hold several sums and only one of them is the ceiling.

    A down payment read as the bottom of a range starts the search at forty
    thousand rupees; an EMI read as the ceiling caps it at fifteen thousand.
    """
    need = parse_query(text)
    assert need.budget_max == 6 * LAKH
    assert need.budget_min is None


def test_a_tiny_marked_sum_is_not_a_budget():
    """"Rs 500" is a typo or a per-unit price. No car costs it."""
    assert parse_query("Rs 500").budget_max is None


# ── Distance ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "text,expected",
    [
        ("1000 km/month", 1000),
        ("1000 kms/month", 1000),      # plural: "km" alone strands the "s"
        ("1200 kilometers per month", 1200),
        ("1,000 km a month", 1000),
        ("50 km/day", 1500),
        ("50 km a day", 1500),
        ("15000 km/year", 1250),
    ],
)
def test_distance_normalises_to_km_per_month(text, expected):
    assert parse_query(text).km_per_month == expected


def test_distance_without_a_period_is_not_guessed():
    """
    "1000 km" could be a month, a year, or a trip.

    Guessing sets the fuel bill, so it is reported unstated instead — the
    caller can ask, which is cheap, where a wrong monthly figure is invisible.
    """
    need = parse_query("I drive 1000 km")
    assert need.km_per_month is None
    assert "km_per_month" in need.missing


# ── People ────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "text,expected",
    [
        ("family of 5", 5),
        ("family of five", 5),
        ("5 people", 5),
        ("we are 4", 4),
        ("7 seater", 7),
        ("seats 7", 7),
    ],
)
def test_seat_count_phrasings(text, expected):
    assert parse_query(text).seats == expected


def test_seven_seater_does_not_become_a_body_type():
    """
    A seat count is a requirement, not a body style.

    Mapping "7 seater" to MPV filters out every three-row SUV — which is most
    of what an Indian buyer asking for seven seats actually shops for. The
    seat count alone expresses it, and the scorer treats it as a floor.
    """
    need = parse_query("7 seater under 20 lakh")
    assert need.seats == 7
    assert need.body is None


def test_an_absurd_headcount_is_rejected():
    """No passenger car seats forty; the number is a misread of something."""
    assert parse_query("family of 40").seats is None


# ── Categories ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "text,field,expected",
    [
        ("mostly city driving", "usage", "city"),
        ("highway use", "usage", "highway"),
        ("city and highway", "usage", "mixed"),
        ("diesel", "fuel", "diesel"),
        ("need an EV", "fuel", "electric"),
        ("cng", "fuel", "cng"),
        ("want an SUV", "body", "suv"),
        ("a sedan", "body", "sedan"),
        ("automatic", "transmission", "automatic"),
        ("second-hand", "condition", "used"),
        ("brand new", "condition", "new"),
    ],
)
def test_categorical_preferences(text, field, expected):
    assert getattr(parse_query(text), field) == expected


def test_mixed_is_not_shadowed_by_city():
    """"city and highway" contains "city" and must still read as mixed."""
    assert parse_query("I drive both city and highway").usage == "mixed"


# ── Absence ───────────────────────────────────────────────────────────────────


def test_nothing_stated_is_reported_not_defaulted():
    """
    The whole point of the module.

    A default family size or a default monthly distance produces a confident
    recommendation for a household that does not exist. Unanswered is a
    reportable state, not a gap to fill.
    """
    need = parse_query("I want a car")

    assert need.budget_max is None
    assert need.seats is None
    assert need.km_per_month is None
    assert need.usage is None
    assert set(need.missing) == {"budget", "seats", "km_per_month", "usage"}
    assert need.is_empty


@pytest.mark.parametrize("text", ["", "   ", "\n"])
def test_empty_input_is_not_an_error(text):
    need = parse_query(text)
    assert need.is_empty
    assert need.missing


def test_understood_lines_describe_only_what_was_found():
    """
    These strings are shown back to the buyer as "here is what I read".

    They must never describe a field that was not stated, because a buyer who
    sees a requirement they did not give has no reason to trust the rest.
    """
    need = parse_query("12 lakh, family of 5")

    joined = " ".join(need.understood).lower()
    assert "12 lakh" in joined
    assert "5 people" in joined
    assert "km" not in joined
    assert len(need.understood) == 2
