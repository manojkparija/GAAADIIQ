"""
Which partner handles a request, and what happens when none can.

Two lookups, deliberately separate:

  * `active_partner` asks the database which partner is switched on. This is
    configuration, changed by an administrator, and it changes without a
    deploy — which is the requirement, since partners are onboarded after the
    production release.
  * `resolve_adapter` asks this process which integration code exists for that
    partner's `adapter_key`. This is code, and it changes only with a deploy.

Separating them makes the failure modes distinguishable. A partner row marked
active whose adapter has not been written is a configuration mistake that must
be loud; it is not the same as having no partner at all, and quietly treating
it as such would let someone believe they had switched insurance on when they
had not.

THE REGISTRY IS EMPTY, AND THAT IS THE CURRENT CORRECT STATE.

No adapter is registered here. There is no partner, so there is no integration
to write yet, and a placeholder adapter returning plausible-looking plans would
be exactly the fabrication this module exists to prevent. When a partner signs,
one file is added and registered here; nothing else in the codebase changes.
"""
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.insurance import InsurancePartner

from .base import PartnerAdapter, PartnerUnavailable

logger = logging.getLogger(__name__)

#: adapter_key -> adapter. Populated by register_adapter at import time.
_ADAPTERS: dict[str, PartnerAdapter] = {}


def register_adapter(adapter: PartnerAdapter) -> None:
    """Make an integration available to partners configured with its key."""
    _ADAPTERS[adapter.key] = adapter


async def active_partner(db: AsyncSession) -> InsurancePartner:
    """The partner currently switched on, or raise PartnerUnavailable.

    Phase 1 supports exactly one active partner. Multi-partner comparison is
    BRD Phase 2, and it needs a decision this code cannot make on its own —
    what "Best Value" ranks on and who is accountable for the ordering (BRD §9
    requires those criteria be defined and auditable). Picking the first row
    would be that decision made silently.

    Ordered by name so the choice is deterministic when a second active row
    exists by mistake, rather than depending on physical row order.
    """
    result = await db.execute(
        select(InsurancePartner)
        .where(InsurancePartner.is_active.is_(True))
        .order_by(InsurancePartner.name)
    )
    partners = list(result.scalars().all())

    if not partners:
        raise PartnerUnavailable(
            PartnerUnavailable.NOT_CONFIGURED,
            "No insurance partner is configured.",
        )

    if len(partners) > 1:
        # Not an error — the request is still answerable — but somebody has
        # configured something the code does not yet support, and finding out
        # from a support ticket would be worse.
        logger.warning(
            "insurance: %d active partners configured; Phase 1 uses one (%s)",
            len(partners),
            partners[0].name,
        )

    return partners[0]


def resolve_adapter(partner: InsurancePartner) -> PartnerAdapter:
    """The integration for this partner, or raise PartnerUnavailable.

    A configured-but-unimplemented partner raises UPSTREAM_ERROR rather than
    NOT_CONFIGURED: from the user's side nothing can be quoted either way, but
    the two need different responses from whoever is on call, and collapsing
    them loses that.
    """
    adapter = _ADAPTERS.get(partner.adapter_key)
    if adapter is None:
        logger.error(
            "insurance: partner %r is active but no adapter is registered for key %r",
            partner.name,
            partner.adapter_key,
        )
        raise PartnerUnavailable(
            PartnerUnavailable.UPSTREAM_ERROR,
            f"No integration is available for partner {partner.name!r}.",
        )
    return adapter
