"""
How long the stop will actually take.

BRD §12-13. The naive form — energy needed divided by charger power — is the
one people write first and it is optimistic by a wide margin, in a direction
that leaves someone waiting at a motorway charger wondering what went wrong.
Two effects account for most of the gap:

  * LOSSES. Not all the energy drawn reaches the battery. Roughly 8-12% goes to
    heat, the on-board charger and thermal management, and the AC side is worse
    than DC because the conversion happens in the car.

  * TAPER. A battery does not accept its peak rate all the way up. Charging is
    near-flat to about half, eases off toward 80%, and above 80% collapses —
    the last 20% can take as long as the first 60. This is why public charging
    is quoted 20→80 rather than 0→100, and why a session that includes the top
    of the pack cannot be estimated as if it did not.

WHAT THIS DELIBERATELY DOES NOT DO

It does not model a specific car's charging curve. The BRD puts that in §13 as
a future enhancement and it needs per-model measured data GAADIIQ does not
have. Inventing a curve would produce a precise-looking number with nothing
behind it. Instead the taper is applied as coarse average-power factors per
band, and the result is returned as a RANGE (BR-06) — because a range is an
honest description of what is known, and a single figure is not.
"""
from dataclasses import dataclass

#: Fraction of drawn energy that reaches the battery. AC is worse: conversion
#: happens in the car's on-board charger, and at low power the fixed overheads
#: are a larger share.
AC_EFFICIENCY = 0.88
DC_EFFICIENCY = 0.92

#: Average power actually accepted across a band, as a fraction of the
#: session's peak. Coarse on purpose — these are not a curve and are not
#: presented as one.
#:
#: CALIBRATED AGAINST PUBLISHED FIGURES, NOT CHOSEN FOR TIDINESS.
#:
#: The first version of this table used 1.00 for the first half of the pack,
#: on the reasoning that charging is "near-flat" below 50%. Checked against
#: what manufacturers actually quote, it was badly optimistic:
#:
#:   Nexon EV 45, 10→80% at 50 kW DC — quoted about 56 minutes.
#:   That table produced 34–49.
#:
#: Optimistic is the dangerous direction. A driver plans a 35-minute stop,
#: waits an hour, and concludes the charger is broken. The error to make here
#: is the boring one.
#:
#: Peak power is held only briefly in reality — it is a headline figure, not a
#: plateau — so the first band is well under 1.0. With the values below the
#: same car comes out at 46–66 minutes, which contains the quoted 56; a
#: 60 kWh car at 120 kW comes out near the quoted figure; and an MG ZS EV
#: 0→80% lands slightly long, which is the right way to be wrong given
#: manufacturer numbers assume ideal battery temperature.
_TAPER_BANDS: tuple[tuple[float, float, float], ...] = (
    #  from%,  to%,  average fraction of peak power
    (0.0, 50.0, 0.80),
    (50.0, 80.0, 0.50),
    (80.0, 90.0, 0.28),
    (90.0, 100.0, 0.13),
)

#: The estimate is presented as a band around the central figure. Real sessions
#: vary with battery temperature, ambient temperature, state of health, and
#: whether the charger is sharing power with the bay next door — none of which
#: is known here. Tighter than this would be false precision.
RANGE_LOWER = 0.90
RANGE_UPPER = 1.30


@dataclass(frozen=True)
class ChargingEstimate:
    energy_needed_kwh: float
    #: Central estimate, minutes.
    minutes: int
    #: What is shown: "45–60 minutes" (BR-06).
    minutes_low: int
    minutes_high: int
    #: The power the estimate assumed, after the vehicle/charger minimum.
    assumed_kw: float
    #: True when the window includes the region above 80%, where the estimate
    #: is least reliable and the UI should say so.
    includes_taper_zone: bool


def _average_power_fraction(from_pct: float, to_pct: float) -> float:
    """
    Energy-weighted average of the taper factors across the requested window.

    Weighted by how much of the window sits in each band, not by a simple mean
    of the bands touched: a 20→85% session is mostly flat charging with a short
    slow tail, and averaging the four band factors evenly would overstate the
    tail badly.
    """
    span = to_pct - from_pct
    if span <= 0:
        return 1.0

    weighted = 0.0
    for band_from, band_to, factor in _TAPER_BANDS:
        overlap = max(0.0, min(to_pct, band_to) - max(from_pct, band_from))
        if overlap > 0:
            weighted += (overlap / span) * factor
    return weighted or 1.0


def estimate(
    *,
    usable_capacity_kwh: float,
    from_pct: float,
    to_pct: float,
    power_kw: float,
    is_dc: bool,
) -> ChargingEstimate | None:
    """
    Estimate a charging session.

    Returns None rather than a number when the inputs cannot support one — a
    zero or negative capacity or power, or a target at or below the current
    level. A "0 minutes" answer to a nonsensical question reads as a real
    answer, and this feature's whole value is that its numbers can be trusted.

    `usable_capacity_kwh` is the usable figure, not the gross pack. Cars hold
    back a buffer at both ends, and using the headline capacity overstates the
    energy needed by several percent — always in the direction of a longer
    quoted time than reality, which is the safer error but still wrong.
    """
    if usable_capacity_kwh <= 0 or power_kw <= 0:
        return None
    if not (0 <= from_pct < to_pct <= 100):
        return None

    energy_needed = usable_capacity_kwh * (to_pct - from_pct) / 100.0

    efficiency = DC_EFFICIENCY if is_dc else AC_EFFICIENCY
    taper = _average_power_fraction(from_pct, to_pct)
    effective_kw = power_kw * taper * efficiency

    if effective_kw <= 0:
        return None

    hours = energy_needed / effective_kw
    minutes = hours * 60.0

    return ChargingEstimate(
        energy_needed_kwh=round(energy_needed, 1),
        minutes=max(1, round(minutes)),
        minutes_low=max(1, round(minutes * RANGE_LOWER)),
        minutes_high=max(1, round(minutes * RANGE_UPPER)),
        assumed_kw=power_kw,
        includes_taper_zone=to_pct > 80.0,
    )


def describe(est: ChargingEstimate) -> str:
    """
    The sentence shown under the estimate.

    Always says "about", always a range, and says so out loud when the window
    runs past 80% — where the number is least reliable and a driver who does
    not know about taper will otherwise think the charger is faulty.
    """
    base = f"About {est.minutes_low}–{est.minutes_high} minutes"
    if est.includes_taper_zone:
        return (
            f"{base}. Charging slows markedly above 80%, so the last part of this "
            f"session takes far longer than the first — most drivers stop at 80%."
        )
    return f"{base}. Actual time varies with battery and outside temperature."
