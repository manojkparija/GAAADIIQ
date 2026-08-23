"""
What a challan data provider is (BRD §22).

GAADIIQ must not be coupled to one source. NIC/Parivahan access is being
pursued; if it is slow or is later supplemented by a licensed aggregator, that
should be one new file rather than a change to every caller.

WHY THERE IS NO SCRAPER IN THIS PACKAGE, AND MUST NOT BE

The obvious shortcut is to drive echallan.parivahan.gov.in with a headless
browser. It is rejected on three independent grounds, any one of which is
enough:

  * The page is CAPTCHA-protected. A CAPTCHA is an access control stating that
    only humans may use the service; automating past it is circumvention, not
    integration, and it breaks the portal's terms of use.
  * It would be unreliable in a way that matters. Markup, session handling and
    the CAPTCHA itself change without notice, and every change silently breaks
    verification for every seller mid-listing.
  * BRD §6 forbids it in terms: GAADIIQ "should not depend on fragile browser
    scraping of a CAPTCHA-protected public website as the production solution."

If a seller wants to use that portal, the right move is to send them to it and
let them solve the CAPTCHA themselves. That is a human doing a human step, and
it is a supported flow — not something this package does on their behalf.

THE EXCEPTION IS THE IMPORTANT PART

`ProviderUnavailable` is raised whenever no authorised source can answer. There
is no fallback that produces challan data, and there must never be one. The
failure mode this guards against is specific and severe: a vehicle that could
not be checked being recorded as clear, then published under a badge saying it
was verified. "We asked and found nothing" and "we could not ask" must stay
distinguishable all the way to the buyer.
"""
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Protocol, runtime_checkable


def ensure_aware(value: datetime | None) -> datetime | None:
    """Treat a naive timestamp as UTC.

    Columns here are DateTime(timezone=True), which Postgres honours and
    SQLite does not — it hands back a naive datetime, and comparing that to an
    aware `now()` raises TypeError. The suite runs on both, so every comparison
    against a stored timestamp goes through this.

    Reading a naive value as UTC is correct rather than merely convenient:
    everything written here is written with `datetime.now(timezone.utc)`, so
    the wall-clock figure already is UTC and only the tzinfo was dropped in
    transit.
    """
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


class ProviderUnavailable(Exception):
    """No authorised challan source could answer.

    `reason` lets the caller tell an outage from an absence — they need
    different responses from whoever is on call, and different words to the
    seller.
    """

    #: No provider rows, or none active. The state until NIC access is granted.
    NOT_CONFIGURED = "not_configured"
    #: A provider exists and the call failed — timeout, 5xx, bad payload.
    UPSTREAM_ERROR = "upstream_error"
    #: The source does not cover this state or this plate series.
    UNSUPPORTED_VEHICLE = "unsupported_vehicle"

    def __init__(self, reason: str, detail: str | None = None) -> None:
        self.reason = reason
        self.detail = detail
        super().__init__(detail or reason)


@dataclass(frozen=True)
class VerificationRequest:
    """What a provider is asked. The normalised plate and nothing more.

    No seller name, no phone. A challan lookup is keyed on the vehicle, so
    sending personal data would be sharing it with a third party for no
    purpose — and keeping it out of the type means an adapter cannot leak it
    by accident.
    """

    registration_number: str
    state_code: str | None = None


@dataclass(frozen=True)
class ChallanRecord:
    """One challan, as the source described it.

    Every field is the source's. Nothing here is derived by GAADIIQ, for the
    same reason the insurance module holds no computed premium: the moment a
    figure is ours, it is no longer attributable to the authority that issued
    it.
    """

    challan_number: str | None = None
    challan_date: date | None = None
    amount: float | None = None
    outstanding_amount: float | None = None
    state: str | None = None
    department: str | None = None
    status: str | None = None
    court_status: str | None = None
    #: The adapter decides this, because only it knows how its source words
    #: "sent to court" — the rule engine must not pattern-match free text.
    is_court_case: bool = False


@dataclass(frozen=True)
class ChallanResult:
    """A provider's complete answer.

    `found_records` is explicit rather than inferred from `len(records)`. A
    source that answered and holds nothing is NO_RECORD_FOUND; one that
    answered with an empty list because it does not cover the state is not the
    same thing, and an empty list cannot distinguish them.
    """

    provider: str
    found_records: bool
    records: list[ChallanRecord] = field(default_factory=list)
    provider_reference_id: str | None = None

    @property
    def outstanding_total(self) -> float:
        """Sum of what is still owed.

        Falls back to `amount` when the source gives no separate outstanding
        figure — many do not — because treating an unpaid challan with no
        outstanding field as ₹0 would understate liability, which is the error
        that matters here.
        """
        total = 0.0
        for r in self.records:
            if r.outstanding_amount is not None:
                total += float(r.outstanding_amount)
            elif r.amount is not None:
                total += float(r.amount)
        return total

    @property
    def outstanding_count(self) -> int:
        return sum(
            1
            for r in self.records
            if (r.outstanding_amount or r.amount or 0) > 0
        )

    @property
    def has_court_case(self) -> bool:
        return any(r.is_court_case for r in self.records)


@runtime_checkable
class ChallanProvider(Protocol):
    """The contract an authorised source implements."""

    #: Matches the configured provider key, e.g. "nic_parivahan".
    key: str

    async def fetch(self, request: VerificationRequest) -> ChallanResult:
        """Return the source's answer, or raise ProviderUnavailable.

        An adapter must not return an empty ChallanResult to signal failure —
        `found_records=False` means the source answered and held nothing, which
        is a real and different answer from not reaching it.
        """
        ...
