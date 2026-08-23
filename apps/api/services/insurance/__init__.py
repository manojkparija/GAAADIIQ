"""Insurance partner integration.

Split into three pieces on purpose:

  * `base` defines what an adapter is — the shape every partner must be made
    to fit, so nothing outside this package knows which partner it is talking
    to (BRD §13).
  * `registry` decides which partner handles a request, and refuses when none
    can.
  * `reference` mints the GIQ-INS attribution ID.
"""
from .base import (
    PartnerAdapter,
    PartnerQuote,
    PartnerUnavailable,
    QuoteRequest,
)
from .reference import next_reference
from .registry import active_partner, register_adapter, resolve_adapter

__all__ = [
    "PartnerAdapter",
    "PartnerQuote",
    "PartnerUnavailable",
    "QuoteRequest",
    "next_reference",
    "active_partner",
    "register_adapter",
    "resolve_adapter",
]
