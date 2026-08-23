"""EV charging intelligence: speed bands, compatibility and session estimates."""
from .compatibility import (
    ChargerSpec,
    CompatibilityResult,
    CompatibilityStatus,
    ConnectorType,
    VehicleChargingSpec,
    assess,
)
from .duration import ChargingEstimate, describe, estimate
from .speed import DEFAULT_BANDS, SpeedBand, SpeedCategory, classify, label

__all__ = [
    "DEFAULT_BANDS",
    "ChargerSpec",
    "ChargingEstimate",
    "CompatibilityResult",
    "CompatibilityStatus",
    "ConnectorType",
    "SpeedBand",
    "SpeedCategory",
    "VehicleChargingSpec",
    "assess",
    "classify",
    "describe",
    "estimate",
    "label",
]
