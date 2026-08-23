"""
Whether this car can charge here, and how fast it will actually go.

BRD §10-11. This is the feature: a map of pins is a commodity, and the thing
worth building is the sentence "your car will draw about 50 kW from that
120 kW charger". Getting it wrong in the optimistic direction is what strands
someone, so every rule below fails toward "we do not know" rather than "yes".

THE MISLEADING NUMBER

A station advertises its own maximum. A driver reads 120 kW and plans a
twenty-minute stop; their car accepts 50 kW and the stop is fifty minutes. The
BRD calls this out twice (§2, §10) because it is the single most common way EV
charging information misleads people. So the delivered power is always
min(charger, vehicle), and the UI states both numbers rather than the smaller
one alone — a driver who sees only "50 kW" cannot tell whether the limit is
their car or the charger, and that changes whether a different station would
help.
"""
import enum
from dataclasses import dataclass


class ConnectorType(str, enum.Enum):
    """
    Connectors GAADIIQ recognises.

    `unknown` is not a connector, it is the absence of one in the data. A feed
    that omits the connector must not be silently treated as the common case:
    guessing CCS2 because most DC chargers in India are CCS2 would produce a
    confident green tick in front of a plug that does not fit.
    """

    type2 = "type2"          # AC, the near-universal Indian standard
    ccs2 = "ccs2"            # DC, the near-universal Indian fast standard
    chademo = "chademo"      # DC, rare in India, present on older imports
    type1 = "type1"          # AC, older imports
    bharat_ac_001 = "bharat_ac_001"
    bharat_dc_001 = "bharat_dc_001"
    three_pin = "three_pin"  # a domestic socket; genuinely slow but genuinely used
    unknown = "unknown"


#: Which connectors carry DC. Used to decide which of the vehicle's two limits
#: applies, so it has to be right rather than inferred from the power rating —
#: a 22 kW AC charger and a 22 kW DC charger are different situations.
DC_CONNECTORS = frozenset(
    {ConnectorType.ccs2, ConnectorType.chademo, ConnectorType.bharat_dc_001}
)


class CompatibilityStatus(str, enum.Enum):
    """
    BRD §11's four states, in the order they matter to a driver.

    `limited_by_vehicle` is deliberately separate from `compatible` rather than
    a flag on it. They are different answers to "should I drive there": one
    means the advertised speed is what you get, the other means it is not, and
    collapsing them is exactly the misleading-number problem this module exists
    to prevent.
    """

    compatible = "compatible"                    # GREEN
    limited_by_vehicle = "limited_by_vehicle"    # BLUE
    not_compatible = "not_compatible"            # RED
    unknown = "unknown"                          # GRAY


@dataclass(frozen=True)
class VehicleChargingSpec:
    """What a car can accept. Every field optional — real spec sheets have gaps."""

    battery_capacity_kwh: float | None = None
    usable_battery_capacity_kwh: float | None = None
    ac_connector: ConnectorType | None = None
    max_ac_kw: float | None = None
    dc_connector: ConnectorType | None = None
    max_dc_kw: float | None = None


@dataclass(frozen=True)
class ChargerSpec:
    """What a charger offers."""

    connector: ConnectorType
    power_kw: float | None
    is_dc: bool | None = None

    def dc(self) -> bool:
        """
        DC or AC.

        Taken from the connector unless the feed said otherwise explicitly.
        Deriving it from the power rating would be wrong for 22 kW, which is a
        common rating on both sides.
        """
        if self.is_dc is not None:
            return self.is_dc
        return self.connector in DC_CONNECTORS


@dataclass(frozen=True)
class CompatibilityResult:
    status: CompatibilityStatus
    #: What the car will actually draw, kW. None when unknown.
    expected_max_kw: float | None
    #: What the charger advertises, for the "your car is the limit" comparison.
    charger_max_kw: float | None
    #: What the car accepts on this current type.
    vehicle_max_kw: float | None
    is_dc: bool
    #: One sentence for the user. Never states a figure the data does not support.
    message: str


def assess(vehicle: VehicleChargingSpec, charger: ChargerSpec) -> CompatibilityResult:
    """
    Can this car use this charger, and at what power.

    Order matters. The connector is checked first because a mismatch is a hard
    no whatever the numbers say — a CCS2 car at a CHAdeMO post cannot charge at
    any speed, and reporting a power limit for it would be nonsense.
    """
    is_dc = charger.dc()
    vehicle_connector = vehicle.dc_connector if is_dc else vehicle.ac_connector
    vehicle_max = vehicle.max_dc_kw if is_dc else vehicle.max_ac_kw

    # ── Unknown, on either side ──────────────────────────────────────────────
    # Before the mismatch check: not knowing the car's connector is not the
    # same as knowing it is wrong, and a red "Not compatible" on missing data
    # sends someone past a charger that would have worked.
    if charger.connector == ConnectorType.unknown or vehicle_connector is None:
        return CompatibilityResult(
            status=CompatibilityStatus.unknown,
            expected_max_kw=None,
            charger_max_kw=charger.power_kw,
            vehicle_max_kw=vehicle_max,
            is_dc=is_dc,
            message=(
                "We do not have enough information about this charger or your car "
                "to say whether they work together. Check with the operator before travelling."
            ),
        )

    # ── Hard mismatch ────────────────────────────────────────────────────────
    if vehicle_connector != charger.connector:
        return CompatibilityResult(
            status=CompatibilityStatus.not_compatible,
            expected_max_kw=None,
            charger_max_kw=charger.power_kw,
            vehicle_max_kw=vehicle_max,
            is_dc=is_dc,
            message=(
                f"This is a {_connector_label(charger.connector)} charger and your car uses "
                f"{_connector_label(vehicle_connector)}. It will not fit."
            ),
        )

    # ── The plug fits; how fast? ─────────────────────────────────────────────
    if charger.power_kw is None or vehicle_max is None:
        # The plug fitting IS useful information, so this is not a flat unknown
        # — but no speed may be claimed from a missing number.
        return CompatibilityResult(
            status=CompatibilityStatus.compatible,
            expected_max_kw=None,
            charger_max_kw=charger.power_kw,
            vehicle_max_kw=vehicle_max,
            is_dc=is_dc,
            message=(
                "The connector fits your car. We do not have the power figures needed "
                "to estimate how fast it will charge."
            ),
        )

    expected = min(charger.power_kw, vehicle_max)
    current = "DC" if is_dc else "AC"

    if vehicle_max < charger.power_kw:
        return CompatibilityResult(
            status=CompatibilityStatus.limited_by_vehicle,
            expected_max_kw=expected,
            charger_max_kw=charger.power_kw,
            vehicle_max_kw=vehicle_max,
            is_dc=is_dc,
            message=(
                f"Your car can use this charger, but will draw up to about {_kw(expected)} — "
                f"the station offers {_kw(charger.power_kw)} and your car's {current} limit "
                f"is {_kw(vehicle_max)}."
            ),
        )

    return CompatibilityResult(
        status=CompatibilityStatus.compatible,
        expected_max_kw=expected,
        charger_max_kw=charger.power_kw,
        vehicle_max_kw=vehicle_max,
        is_dc=is_dc,
        message=(
            f"Your car can use this charger at up to about {_kw(expected)}."
            + (
                ""
                if vehicle_max == charger.power_kw
                else f" The station is the limit here, not your car ({_kw(vehicle_max)} {current})."
            )
        ),
    )


_CONNECTOR_LABELS = {
    ConnectorType.type2: "Type 2",
    ConnectorType.ccs2: "CCS2",
    ConnectorType.chademo: "CHAdeMO",
    ConnectorType.type1: "Type 1",
    ConnectorType.bharat_ac_001: "Bharat AC-001",
    ConnectorType.bharat_dc_001: "Bharat DC-001",
    ConnectorType.three_pin: "3-pin socket",
    ConnectorType.unknown: "an unrecorded connector",
}


def _connector_label(c: ConnectorType) -> str:
    return _CONNECTOR_LABELS.get(c, c.value)


def _kw(value: float) -> str:
    """Whole numbers where the value is whole — "7.2 kW" but "50 kW", not "50.0 kW"."""
    return f"{value:g} kW"
