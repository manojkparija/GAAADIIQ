"""
What an insurance partner adapter is.

BRD §13 asks that GAADIIQ not be coupled to one insurer's API. The reason is
not elegance: partner agreements end, and an integration written directly into
the router is one whose removal touches every insurance endpoint. So the router
knows only the two types below, and each partner is made to fit them.

THE IMPORTANT PART OF THIS FILE IS THE EXCEPTION.

`PartnerUnavailable` is raised when no partner can answer — none configured,
none active, the call failed, the credentials are missing. There is no fallback
path that produces numbers anyway, and adding one would defeat the schema's
central guarantee (models/insurance.py: every displayed premium is attributable
to a regulated party).

This matters more than usual at launch, because partners are onboarded *after*
the production release. Every quote request in the first weeks will raise this.
That is the correct behaviour, not a degraded one: the honest answer to "what
will this cost" when nobody has quoted is that we do not know yet.

The temptation here is real and worth naming, because this codebase has met it
before. `services/credit_bureau.py::fetch_score` raises rather than returning a
plausible credit score, for the same reason: a generated number is
indistinguishable from a real one at the call site, and will be believed. A
simulated premium is worse than a simulated score, because it is a
representation about a financial product attributed to a named insurer.

The router that catches this must degrade to something that is true — capture
the user's interest, tell them plainly that quotes are not available yet — and
never to an invented figure.
"""
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable


class PartnerUnavailable(Exception):
    """No regulated partner can answer this request.

    Carries a machine-readable `reason` so the router can distinguish "we have
    not onboarded anyone yet" (expected at launch, and the user should be
    offered the interest flow) from "the partner we have is erroring" (a real
    incident, and the user should be asked to try again shortly).
    """

    #: no partner rows, or none active
    NOT_CONFIGURED = "not_configured"
    #: a partner exists but the call failed
    UPSTREAM_ERROR = "upstream_error"
    #: a partner exists but does not sell this product
    UNSUPPORTED_PRODUCT = "unsupported_product"

    def __init__(self, reason: str, detail: str | None = None) -> None:
        self.reason = reason
        self.detail = detail
        super().__init__(detail or reason)


@dataclass(frozen=True)
class QuoteRequest:
    """Everything a partner needs, and deliberately nothing more.

    No name, no email. A quote is priced on the vehicle and the risk, not on
    who is asking, so contact details are not sent at this stage — they go only
    with a lead the user has consented to share. Keeping them out of this type
    means an adapter cannot leak them by accident.
    """

    make: str
    model: str
    policy_type: str
    variant: str | None = None
    fuel_type: str | None = None
    manufacturing_year: int | None = None
    registration_no: str | None = None
    city: str | None = None
    #: GAADIIQ's attribution reference, passed through so the partner can echo
    #: it back on conversion (BRD §12).
    reference: str | None = None


@dataclass(frozen=True)
class PartnerQuote:
    """One plan, as the partner described it.

    Every field is something the partner supplied. There is no computed field
    on this type and there should never be one: the moment GAADIIQ derives a
    premium, an IDV or a ranking score, the result is no longer attributable to
    the party that has to stand behind it.

    `insurer_name` is separate from the partner: a broker returns products from
    several insurers, and the user must be told whose product it is, not merely
    who passed it along (BRD §22, product display and disclosure).
    """

    insurer_name: str
    plan_name: str
    policy_type: str
    premium: float
    idv: float | None = None
    #: Free-form as the partner sends it; not parsed into a schema GAADIIQ
    #: invents, because two insurers will not mean the same thing by the same
    #: add-on name.
    coverages: list[str] = field(default_factory=list)
    add_ons: list[str] = field(default_factory=list)
    #: Where the regulated purchase journey continues (BRD §10, Option A).
    purchase_url: str | None = None
    partner_quote_id: str | None = None


@runtime_checkable
class PartnerAdapter(Protocol):
    """The contract a partner integration implements.

    Kept to one method for now. BRD §13 lists proposal creation, policy status
    and cancellation as well; those are added when a partner exists to
    implement them, rather than being defined speculatively against nobody's
    API and getting the shape wrong.
    """

    #: Matches InsurancePartner.adapter_key.
    key: str

    async def fetch_quotes(self, request: QuoteRequest) -> list[PartnerQuote]:
        """Return the partner's plans, or raise PartnerUnavailable.

        An adapter must not return an empty list to mean failure — empty means
        "this partner has no product for this vehicle", which is a real and
        different answer.
        """
        ...
