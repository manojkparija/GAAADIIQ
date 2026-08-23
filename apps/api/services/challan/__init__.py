"""
Vehicle challan verification.

  * `base`     — what a provider adapter is, and the exception it raises.
  * `registry` — which provider answers, and what happens when none can.
  * `rules`    — the configurable decision engine (BRD §9, §10).
  * `plate`    — registration-number normalisation (FR-02).
"""
from .base import ChallanRecord, ChallanResult, ProviderUnavailable, VerificationRequest
from .plate import normalise_registration
from .registry import active_provider, register_provider
from .rules import RuleOutcome, evaluate

__all__ = [
    "ChallanRecord",
    "ChallanResult",
    "ProviderUnavailable",
    "VerificationRequest",
    "normalise_registration",
    "active_provider",
    "register_provider",
    "RuleOutcome",
    "evaluate",
]
