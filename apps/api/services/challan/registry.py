"""
Which challan source answers, and what happens when none can.

THE REGISTRY IS EMPTY, AND THAT IS THE CURRENT CORRECT STATE.

GAADIIQ is pursuing direct NIC/Parivahan API access. That is an authorisation
process rather than an engineering task — the entity applies and is granted
access — so no adapter can be written against it yet, and none is registered
here.

Until one is, `active_provider` raises ProviderUnavailable(NOT_CONFIGURED) and
every verification is recorded as VERIFICATION_PENDING. That is the designed
behaviour, not a degraded one. The alternative — a stub that returns "no
challans found" — would be indistinguishable at the call site from a real
clean result, and would publish unverified vehicles under a badge saying they
were checked. Same rule as services/credit_bureau.py and the insurance
registry: refuse rather than invent.

WHEN NIC ACCESS IS GRANTED

One file, `providers/nic_parivahan.py`, implementing `ChallanProvider`, and one
`register_provider(...)` call here. Credentials come from the environment and
are read inside the adapter; `PROVIDER_ENV_KEYS` below names them so a missing
credential is reported as a configuration error rather than as a mysterious
upstream failure at 2am.

Nothing else in the codebase changes.
"""
import logging
import os

from .base import ChallanProvider, ProviderUnavailable

logger = logging.getLogger(__name__)

#: provider key -> adapter. Empty until an authorised source is connected.
_PROVIDERS: dict[str, ChallanProvider] = {}

#: Which environment variable each provider needs. Checked before use so a
#: half-configured deployment fails loudly at the first request rather than
#: looking like an outage.
PROVIDER_ENV_KEYS: dict[str, str] = {
    "nic_parivahan": "NIC_PARIVAHAN_API_KEY",
}

#: Names the provider to use, e.g. CHALLAN_PROVIDER=nic_parivahan. Absent means
#: no verification is possible, which is the state today.
PROVIDER_ENV = "CHALLAN_PROVIDER"


def register_provider(provider: ChallanProvider) -> None:
    _PROVIDERS[provider.key] = provider


def active_provider() -> ChallanProvider:
    """The configured source, or raise ProviderUnavailable."""
    key = os.getenv(PROVIDER_ENV, "").strip()
    if not key:
        raise ProviderUnavailable(
            ProviderUnavailable.NOT_CONFIGURED,
            "No challan verification source is configured.",
        )

    provider = _PROVIDERS.get(key)
    if provider is None:
        # Configured but unimplemented. Distinct from unconfigured: somebody
        # believes verification is switched on and it is not.
        logger.error(
            "challan: %s=%r but no adapter is registered for that key", PROVIDER_ENV, key
        )
        raise ProviderUnavailable(
            ProviderUnavailable.UPSTREAM_ERROR,
            f"No integration is available for challan provider {key!r}.",
        )

    env_key = PROVIDER_ENV_KEYS.get(key)
    if env_key and not os.getenv(env_key):
        logger.error("challan: provider %r is selected but %s is not set", key, env_key)
        raise ProviderUnavailable(
            ProviderUnavailable.UPSTREAM_ERROR,
            f"Challan provider {key!r} is missing its credentials.",
        )

    return provider
