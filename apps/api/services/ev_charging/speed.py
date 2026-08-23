"""
Turning a charger's power rating into something a person understands.

BR-02 wants a friendly category; BR-03 insists the actual kW is never replaced
by it. Both are right, and the reason is the same: "Fast Charger" is a claim
about how long someone will be standing there, and two chargers both called
"fast" can differ by a factor of five. The category is a hint for scanning a
list; the number is the fact.

So nothing in this module ever returns a category on its own. `classify()`
returns the band, and every caller is expected to render it alongside the kW —
the API response carries both, and the card template shows both.
"""
import enum
from dataclasses import dataclass


class SpeedCategory(str, enum.Enum):
    """
    BRD §7. Names chosen for what a driver does about them, not for marketing.

    `unknown` exists because a feed that omits the power rating is common, and
    guessing a band from a missing number is how someone ends up planning a
    twenty-minute stop at a 3 kW socket.
    """

    slow = "slow"
    normal = "normal"
    fast = "fast"
    high_speed = "high_speed"
    ultra_fast = "ultra_fast"
    unknown = "unknown"


#: What each band is called on screen.
DISPLAY_LABEL: dict[SpeedCategory, str] = {
    SpeedCategory.slow: "Slow Charging",
    SpeedCategory.normal: "Normal / Destination Charging",
    SpeedCategory.fast: "Fast Charging",
    SpeedCategory.high_speed: "High-Speed Charging",
    SpeedCategory.ultra_fast: "Ultra-Fast Charging",
    SpeedCategory.unknown: "Charging speed not known",
}


@dataclass(frozen=True)
class SpeedBand:
    """One row of the classification table: everything above `min_kw`, up to `max_kw`."""

    category: SpeedCategory
    min_kw: float
    max_kw: float | None  # None = no upper bound


#: BRD §7's defaults. Used only when no admin-configured table exists — the
#: same arrangement as the challan rules, so an operator can retune the bands
#: without a deploy but an empty table still behaves sensibly.
DEFAULT_BANDS: tuple[SpeedBand, ...] = (
    SpeedBand(SpeedCategory.slow, 0.0, 7.0),
    SpeedBand(SpeedCategory.normal, 7.0, 22.0),
    SpeedBand(SpeedCategory.fast, 22.0, 100.0),
    SpeedBand(SpeedCategory.high_speed, 100.0, 250.0),
    SpeedBand(SpeedCategory.ultra_fast, 250.0, None),
)


def classify(power_kw: float | None, bands: tuple[SpeedBand, ...] = DEFAULT_BANDS) -> SpeedCategory:
    """
    The band a charger falls in.

    Boundaries are exclusive at the bottom and inclusive at the top, matching
    the BRD's "Above 7 kW to 22 kW" wording. So exactly 7 kW is Slow and 7.2 kW
    is Normal — which matters, because 7.2 kW is the single most common AC
    rating on Indian EVs and putting it in the wrong band would mislabel most
    of the home-charging fleet.

    A missing or nonsensical rating returns `unknown` rather than defaulting to
    a band. Nought kW is not slow charging, it is an absence of information.
    """
    if power_kw is None or power_kw <= 0:
        return SpeedCategory.unknown

    for band in bands:
        if power_kw > band.min_kw and (band.max_kw is None or power_kw <= band.max_kw):
            return band.category

    # Below the first band's floor — a positive rating under 0 kW is not
    # reachable, but a retuned table could leave a gap and silence is worse
    # than saying so.
    return SpeedCategory.unknown


def label(category: SpeedCategory) -> str:
    return DISPLAY_LABEL.get(category, DISPLAY_LABEL[SpeedCategory.unknown])
