"""
The charging intelligence: speed bands, compatibility, session estimates.

These are the numbers a driver plans around, so what is asserted here is
mostly about the failure direction. An optimistic error strands someone at a
charger; a missing-data error that reads as a confident answer is worse than
saying nothing.
"""
import pytest

from services.ev_charging import (
    ChargerSpec,
    CompatibilityStatus,
    ConnectorType,
    SpeedCategory,
    VehicleChargingSpec,
    assess,
    classify,
    describe,
    estimate,
)
from services.ev_charging.duration import _TAPER_BANDS, _average_power_fraction

# ── Speed classification (BRD §7, BR-02, BR-03) ──────────────────────────────


def test_the_bands_match_the_brd():
    assert classify(3.3) is SpeedCategory.slow
    assert classify(7.0) is SpeedCategory.slow          # "Up to 7 kW"
    assert classify(7.2) is SpeedCategory.normal        # "Above 7 kW"
    assert classify(22.0) is SpeedCategory.normal
    assert classify(50.0) is SpeedCategory.fast
    assert classify(100.0) is SpeedCategory.fast
    assert classify(120.0) is SpeedCategory.high_speed
    assert classify(250.0) is SpeedCategory.high_speed
    assert classify(350.0) is SpeedCategory.ultra_fast


def test_72kw_lands_in_normal_not_slow():
    """
    The single most common AC rating on Indian EVs sits one notch above the
    Slow ceiling. An inclusive-at-the-bottom boundary would put most of the
    home-charging fleet in the wrong band.
    """
    assert classify(7.2) is SpeedCategory.normal


def test_a_missing_rating_is_unknown_not_slow():
    """
    Nought kW is an absence of information, not a slow charger. Defaulting a
    missing rating into the bottom band would label every gap in the feed as
    something a driver should avoid.
    """
    for value in (None, 0, -5):
        assert classify(value) is SpeedCategory.unknown


# ── Compatibility (BRD §10-11) ───────────────────────────────────────────────

NEXON_LIKE = VehicleChargingSpec(
    battery_capacity_kwh=40.5,
    usable_battery_capacity_kwh=37.5,
    ac_connector=ConnectorType.type2,
    max_ac_kw=7.2,
    dc_connector=ConnectorType.ccs2,
    max_dc_kw=50.0,
)


def test_the_headline_case_from_the_brd():
    """
    §10's worked example: a 120 kW post and a car that accepts 50. The driver
    must not come away thinking they will get 120.
    """
    result = assess(NEXON_LIKE, ChargerSpec(ConnectorType.ccs2, 120.0))

    assert result.status is CompatibilityStatus.limited_by_vehicle
    assert result.expected_max_kw == 50.0
    # Both figures present, so the driver can tell which side is the limit.
    assert result.charger_max_kw == 120.0
    assert result.vehicle_max_kw == 50.0
    assert "50 kW" in result.message and "120 kW" in result.message


def test_limited_by_vehicle_is_a_distinct_state_from_compatible():
    """
    Collapsing them would answer "should I drive there" the same way for two
    genuinely different situations.
    """
    limited = assess(NEXON_LIKE, ChargerSpec(ConnectorType.ccs2, 120.0))
    matched = assess(NEXON_LIKE, ChargerSpec(ConnectorType.ccs2, 50.0))
    charger_limited = assess(NEXON_LIKE, ChargerSpec(ConnectorType.ccs2, 25.0))

    assert limited.status is CompatibilityStatus.limited_by_vehicle
    assert matched.status is CompatibilityStatus.compatible
    # The charger being the smaller number is still plain "compatible": the
    # car is not the constraint, so a different car would not go faster.
    assert charger_limited.status is CompatibilityStatus.compatible
    assert charger_limited.expected_max_kw == 25.0


def test_a_connector_mismatch_is_a_hard_no_whatever_the_power():
    result = assess(NEXON_LIKE, ChargerSpec(ConnectorType.chademo, 400.0))
    assert result.status is CompatibilityStatus.not_compatible
    assert result.expected_max_kw is None, "a plug that does not fit has no charging speed"
    assert "CHAdeMO" in result.message and "CCS2" in result.message


def test_the_right_side_of_the_car_is_compared():
    """
    An AC post is checked against the AC limit and a DC post against the DC
    limit. Comparing a 22 kW AC charger against the car's 50 kW DC figure would
    report a green tick and a wildly optimistic speed.
    """
    ac = assess(NEXON_LIKE, ChargerSpec(ConnectorType.type2, 22.0))
    assert ac.is_dc is False
    assert ac.status is CompatibilityStatus.limited_by_vehicle
    assert ac.expected_max_kw == 7.2, "must use the AC limit, not the 50 kW DC one"


def test_missing_data_is_unknown_rather_than_a_refusal():
    """
    Not knowing a car's connector is not the same as knowing it is wrong. A red
    "Not compatible" on missing data sends someone past a charger that works.
    """
    blank = VehicleChargingSpec()
    assert assess(blank, ChargerSpec(ConnectorType.ccs2, 60.0)).status is (
        CompatibilityStatus.unknown
    )
    assert assess(NEXON_LIKE, ChargerSpec(ConnectorType.unknown, 60.0)).status is (
        CompatibilityStatus.unknown
    )


def test_a_fitting_plug_with_no_power_figures_claims_no_speed():
    """The connector fitting is real information; a speed would not be."""
    car = VehicleChargingSpec(dc_connector=ConnectorType.ccs2)  # no max_dc_kw
    result = assess(car, ChargerSpec(ConnectorType.ccs2, None))

    assert result.status is CompatibilityStatus.compatible
    assert result.expected_max_kw is None
    assert "kW" not in result.message.replace("power figures", "")


def test_ac_dc_comes_from_the_connector_not_the_power_rating():
    """22 kW is a common rating on both sides, so the number cannot decide."""
    assert ChargerSpec(ConnectorType.type2, 22.0).dc() is False
    assert ChargerSpec(ConnectorType.ccs2, 22.0).dc() is True


# ── Session estimates (BRD §12-13, BR-06) ────────────────────────────────────


def test_a_session_is_always_a_range_never_a_single_figure():
    est = estimate(
        usable_capacity_kwh=60.0, from_pct=20, to_pct=80, power_kw=50.0, is_dc=True
    )
    assert est is not None
    assert est.minutes_low < est.minutes_high, "BR-06: an estimate, not a guarantee"
    assert "–" in describe(est)


def test_the_estimate_is_longer_than_the_naive_division():
    """
    Energy ÷ power is the number people write first and it is optimistic. The
    session must account for losses and taper, or someone plans a stop that
    runs over.
    """
    est = estimate(
        usable_capacity_kwh=60.0, from_pct=20, to_pct=80, power_kw=50.0, is_dc=True
    )
    naive_minutes = (60.0 * 0.6 / 50.0) * 60  # 43.2
    assert est.minutes > naive_minutes, (
        f"estimate {est.minutes} should exceed the naive {naive_minutes:.0f}"
    )


def test_the_last_twenty_percent_costs_far_more_than_the_first():
    """
    Taper is the effect that surprises drivers most: 80→100% takes longer than
    60→80% despite being the same energy.
    """
    mid = estimate(
        usable_capacity_kwh=60.0, from_pct=60, to_pct=80, power_kw=100.0, is_dc=True
    )
    top = estimate(
        usable_capacity_kwh=60.0, from_pct=80, to_pct=100, power_kw=100.0, is_dc=True
    )
    assert top.minutes > mid.minutes * 1.5, (
        f"top-of-pack {top.minutes}min should dwarf {mid.minutes}min for the same energy"
    )


def test_a_session_past_eighty_percent_says_so():
    past = estimate(
        usable_capacity_kwh=60.0, from_pct=20, to_pct=100, power_kw=50.0, is_dc=True
    )
    upto = estimate(
        usable_capacity_kwh=60.0, from_pct=20, to_pct=80, power_kw=50.0, is_dc=True
    )
    assert past.includes_taper_zone and "80%" in describe(past)
    assert not upto.includes_taper_zone


def test_ac_is_less_efficient_than_dc():
    """Conversion happens in the car's on-board charger, and it costs."""
    ac = estimate(usable_capacity_kwh=40.0, from_pct=20, to_pct=80, power_kw=7.2, is_dc=False)
    dc = estimate(usable_capacity_kwh=40.0, from_pct=20, to_pct=80, power_kw=7.2, is_dc=True)
    assert ac.minutes > dc.minutes


def test_the_taper_average_is_weighted_by_the_window_not_by_band_count():
    """
    A 20→85% session is mostly flat charging with a short slow tail. Averaging
    the touched bands evenly would overstate that tail badly.
    """
    # Derived from the table, not copied from it. An earlier version hardcoded
    # the factors and failed the moment they were recalibrated — reporting a
    # broken weighting when only the constants had moved.
    touched = [f for lo, hi, f in _TAPER_BANDS if not (hi <= 20 or lo >= 85)]
    naive_mean_of_touched_bands = sum(touched) / len(touched)

    weighted = _average_power_fraction(20, 85)
    assert weighted > naive_mean_of_touched_bands


def test_nonsense_inputs_return_nothing_rather_than_zero_minutes():
    """
    "0 minutes" reads as a real answer. This feature's whole value is that its
    numbers can be trusted, so it declines rather than emitting one.
    """
    assert estimate(usable_capacity_kwh=0, from_pct=20, to_pct=80, power_kw=50, is_dc=True) is None
    assert estimate(usable_capacity_kwh=60, from_pct=20, to_pct=80, power_kw=0, is_dc=True) is None
    assert estimate(usable_capacity_kwh=60, from_pct=80, to_pct=20, power_kw=50, is_dc=True) is None
    assert estimate(usable_capacity_kwh=60, from_pct=50, to_pct=50, power_kw=50, is_dc=True) is None
    assert estimate(usable_capacity_kwh=60, from_pct=-10, to_pct=80, power_kw=50, is_dc=True) is None


def test_the_estimate_uses_the_power_the_car_will_actually_draw():
    """
    Estimating from the charger's advertised figure rather than the assessed
    minimum is the misleading-number bug in its most damaging form: it produces
    a specific, confident, far-too-short time.
    """
    result = assess(NEXON_LIKE, ChargerSpec(ConnectorType.ccs2, 120.0))
    honest = estimate(
        usable_capacity_kwh=37.5, from_pct=20, to_pct=80,
        power_kw=result.expected_max_kw, is_dc=True,
    )
    optimistic = estimate(
        usable_capacity_kwh=37.5, from_pct=20, to_pct=80,
        power_kw=result.charger_max_kw, is_dc=True,
    )
    assert honest.minutes > optimistic.minutes * 2


@pytest.mark.parametrize(
    "name,usable_kwh,from_pct,to_pct,power_kw,quoted_minutes",
    [
        ("Nexon EV 45", 37.5, 10, 80, 50, 56),
        ("Curvv EV", 50.0, 10, 80, 70, 40),
        ("MG ZS EV", 48.0, 0, 80, 50, 60),
        ("Creta Electric", 48.0, 10, 80, 50, 58),
    ],
)
def test_estimates_are_calibrated_against_published_figures(
    name, usable_kwh, from_pct, to_pct, power_kw, quoted_minutes
):
    """
    Pins the taper table to reality rather than to tidiness.

    The first version used 1.00 for the bottom half of the pack and produced
    34–49 minutes for the Nexon case against a quoted 56. Optimistic is the
    dangerous direction: a driver plans a 35-minute stop, waits an hour, and
    concludes the charger is faulty.

    The assertion is one-sided. Landing at or above the manufacturer's number
    is correct — those figures assume an ideal battery temperature and a
    charger delivering full power — so being conservative passes and being
    optimistic fails.
    """
    est = estimate(
        usable_capacity_kwh=usable_kwh, from_pct=from_pct,
        to_pct=to_pct, power_kw=power_kw, is_dc=True,
    )
    assert est is not None
    assert est.minutes_high >= quoted_minutes, (
        f"{name}: {est.minutes_low}–{est.minutes_high} min is optimistic against "
        f"the quoted {quoted_minutes} min"
    )
    # Not so conservative as to be useless either — three times the quote would
    # send people to a different charger for no reason.
    assert est.minutes_low <= quoted_minutes * 2, (
        f"{name}: {est.minutes_low}–{est.minutes_high} min is implausibly long "
        f"against the quoted {quoted_minutes} min"
    )
