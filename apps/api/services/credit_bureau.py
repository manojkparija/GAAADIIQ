"""Establishing an applicant's credit standing.

There is no real bureau behind this yet, and that is a licensing question rather
than an engineering one. Querying CIBIL, Experian or CRIF requires being a
credit institution or a registered Specified User under the Credit Information
Companies (Regulation) Act, with a signed agreement and an audited consent
flow. A marketplace cannot simply call the API.

So this module does two things and refuses a third:

  * it converts a score into the band a rate card is written against;
  * it provides the seam a real bureau integration drops into later;
  * it never invents a score.

That last point is the whole design. The tempting shortcut — generate a
plausible score from income and age so the demo looks complete — produces a
number a buyer will believe, act on, and be contradicted by when the lender
runs the real check. An honest `unknown` priced at the lender's worst published
rate is worth more than a convincing fiction.
"""

from __future__ import annotations

import logging

from models.lending_partner import CreditBand

logger = logging.getLogger(__name__)

#: CIBIL runs 300-900. Below 300 means "no history", which is not the same as a
#: bad history and is why `NO_HISTORY_SCORES` is handled separately.
MIN_SCORE = 300
MAX_SCORE = 900

#: -1 means "no credit history"; 0 means "fewer than six months of history".
#: Both are common for a first-time borrower and neither is a low score.
NO_HISTORY_SCORES = (-1, 0)


def band_for_score(score: int | None) -> CreditBand:
    """The band a score falls in, as lenders publish them.

    A thin file (`-1`/`0`) returns `unknown` rather than `poor`: a first-time
    borrower has not demonstrated bad credit, and pricing them as though they
    had is both wrong and the sort of thing that quietly excludes younger
    applicants.
    """
    if score is None or score in NO_HISTORY_SCORES:
        return CreditBand.unknown
    if score >= 750:
        return CreditBand.excellent
    if score >= 700:
        return CreditBand.good
    if score >= 650:
        return CreditBand.fair
    return CreditBand.poor


def band_label(band: CreditBand) -> str:
    """Wording for the UI, including the score range so the band is checkable."""
    return {
        CreditBand.excellent: "Excellent (750+)",
        CreditBand.good: "Good (700-749)",
        CreditBand.fair: "Fair (650-699)",
        CreditBand.poor: "Needs work (below 650)",
        CreditBand.unknown: "Not checked",
    }[band]


class BureauUnavailable(RuntimeError):
    """No bureau is configured, or the one configured did not answer."""


async def fetch_score(pan: str, *, consent_reference: str | None = None) -> tuple[int, str]:
    """Pull a live credit score for a PAN. Not implemented.

    Raises `BureauUnavailable` unconditionally, and deliberately: a stub that
    returned a made-up score would be indistinguishable from a working
    integration at every call site, and would ship as one.

    A real implementation belongs here and must, before anything else, verify
    that consent was recorded on the application — the bureau agreement makes
    that our obligation, not the caller's.
    """
    raise BureauUnavailable(
        "No credit bureau is configured. A CIBIL/Experian integration requires "
        "registration as a Specified User under the CIC(R) Act."
    )


def is_bureau_configured() -> bool:
    """Whether a live check can be offered at all.

    Read by the API so the UI can say "we will use your declared band" up front,
    rather than asking for consent to a check that cannot happen.
    """
    return False
