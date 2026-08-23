"""
Indian registration-number normalisation (BRD FR-02).

One vehicle, many spellings: `WB 02 AB 1234`, `wb02ab1234`, `WB-02-AB-1234`.
They must collapse to one stored form or the lookup index is useless and the
same vehicle gets verified twice under two keys.

WHAT IS DELIBERATELY NOT VALIDATED HERE

The full grammar of Indian plates is not a regex anyone should trust. Alongside
the familiar `SS RR XX NNNN` there are:

  * two-letter and three-letter series, and single-letter ones on older plates;
  * district codes from 1 to 99, sometimes zero-padded and sometimes not;
  * BH-series numbers (`YY BH NNNN XX`), which put the year first;
  * army, diplomatic and temporary registrations in wholly different shapes.

So this rejects only what cannot be a registration at all — empty, too short,
too long, or containing characters plates do not use — and normalises the rest.
A stricter pattern would reject real vehicles, and a seller whose valid plate is
refused has no way forward; a slightly lax one costs a failed lookup, which the
source reports cleanly.

That trade is the opposite of the one made for phone numbers in the insurance
form, and deliberately so: mobile numbers have one fixed shape, plates do not.
"""
import re

# Plates use A-Z and 0-9. Everything else here is separator noise people type.
_STRIP = re.compile(r"[\s\-.·_/]+")
_ALLOWED = re.compile(r"^[A-Z0-9]+$")

MIN_LENGTH = 6   # e.g. an old-style "MH1A99" style short plate
MAX_LENGTH = 15  # BH-series and temporary registrations run long


def normalise_registration(raw: str | None) -> str | None:
    """Return the canonical form, or None if it cannot be a registration.

    Canonical means upper-case with all separators removed: `WB 02 AB 1234`
    and `wb-02-ab-1234` both become `WB02AB1234`.
    """
    if not raw:
        return None

    cleaned = _STRIP.sub("", raw).upper()
    if not cleaned or not _ALLOWED.match(cleaned):
        return None
    if not (MIN_LENGTH <= len(cleaned) <= MAX_LENGTH):
        return None
    # A plate is never all digits and never all letters.
    if cleaned.isdigit() or cleaned.isalpha():
        return None
    return cleaned


def state_code(registration: str | None) -> str | None:
    """The leading state code, when the plate starts with one.

    Returns None for BH-series and anything else that does not begin with two
    letters, rather than guessing. The state is used for display and for
    routing to a state-specific source; a wrong guess would route to the wrong
    one, which is worse than not routing.
    """
    if not registration or len(registration) < 2:
        return None
    head = registration[:2]
    return head if head.isalpha() else None
