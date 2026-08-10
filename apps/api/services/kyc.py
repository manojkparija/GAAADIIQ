"""KYC validation for mechanic registration — PAN and Aadhaar.

The Aadhaar number is validated here and then immediately discarded. Only a
peppered digest and the last four digits survive into the database; see
`models/mechanic.py` for why.

Validation is structural, not authoritative. A Verhoeff-valid Aadhaar is a
well-formed one, not a real one — proving that a number belongs to the person
holding it requires UIDAI e-KYC / OTP authentication through a licensed AUA/KUA.
Until that integration exists, `Mechanic.status` starts at `pending_verification`
and a human checks the documents.
"""

from __future__ import annotations

import hashlib
import re

from core.config import settings

# Five letters, four digits, one letter. The fourth letter encodes holder type
# ('P' individual, 'C' company, ...), which we do not constrain: a garage may
# legitimately register a firm's PAN rather than a personal one.
PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")

AADHAAR_RE = re.compile(r"^[2-9][0-9]{11}$")


class KycError(ValueError):
    """Raised when a KYC field is missing or structurally invalid."""


# --- Verhoeff checksum ------------------------------------------------------
# UIDAI numbers carry a Verhoeff check digit. It catches the transpositions and
# single-digit slips that a typed-in 12-digit number actually suffers from, which
# a plain length check does not.
_D = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    (1, 2, 3, 4, 0, 6, 7, 8, 9, 5),
    (2, 3, 4, 0, 1, 7, 8, 9, 5, 6),
    (3, 4, 0, 1, 2, 8, 9, 5, 6, 7),
    (4, 0, 1, 2, 3, 9, 5, 6, 7, 8),
    (5, 9, 8, 7, 6, 0, 4, 3, 2, 1),
    (6, 5, 9, 8, 7, 1, 0, 4, 3, 2),
    (7, 6, 5, 9, 8, 2, 1, 0, 4, 3),
    (8, 7, 6, 5, 9, 3, 2, 1, 0, 4),
    (9, 8, 7, 6, 5, 4, 3, 2, 1, 0),
)
_P = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    (1, 5, 7, 6, 2, 8, 3, 0, 9, 4),
    (5, 8, 0, 3, 7, 9, 6, 1, 4, 2),
    (8, 9, 1, 6, 0, 4, 3, 5, 2, 7),
    (9, 4, 5, 3, 1, 2, 6, 8, 7, 0),
    (4, 2, 8, 6, 5, 7, 3, 9, 0, 1),
    (2, 7, 9, 3, 8, 0, 6, 4, 1, 5),
    (7, 0, 4, 6, 9, 1, 3, 2, 5, 8),
)


def _verhoeff_ok(digits: str) -> bool:
    c = 0
    for i, ch in enumerate(reversed(digits)):
        c = _D[c][_P[i % 8][int(ch)]]
    return c == 0


def normalise_pan(raw: str | None) -> str:
    """Uppercase and validate a PAN, or raise `KycError`."""
    if not raw or not raw.strip():
        raise KycError("PAN number is required")
    pan = raw.strip().upper().replace(" ", "")
    if not PAN_RE.match(pan):
        raise KycError("PAN must be 10 characters in the format ABCDE1234F")
    return pan


def normalise_aadhaar(raw: str | None) -> str:
    """Strip formatting and validate an Aadhaar number, or raise `KycError`.

    The return value is the raw 12 digits and must not be persisted — pass it
    straight to `aadhaar_digest` / `aadhaar_last4` and let it go out of scope.
    """
    if not raw or not raw.strip():
        # The product rule: no Aadhaar, no registration.
        raise KycError("Aadhaar number is required to register as a mechanic")
    digits = re.sub(r"[\s-]", "", raw.strip())
    if not AADHAAR_RE.match(digits):
        raise KycError("Aadhaar must be 12 digits and cannot start with 0 or 1")
    if not _verhoeff_ok(digits):
        raise KycError("Aadhaar number failed its checksum — please re-check the digits")
    return digits


def aadhaar_digest(digits: str) -> str:
    """Peppered SHA-256 of a validated Aadhaar number.

    The pepper is what makes this safe. Without it the input space is 12 digits —
    a few billion candidates, which is a minutes-long brute force on commodity
    hardware, so an unpeppered digest would be reversible in practice.
    """
    pepper = settings.kyc_hash_pepper or ""
    return hashlib.sha256(f"{pepper}:{digits}".encode()).hexdigest()


def aadhaar_last4(digits: str) -> str:
    return digits[-4:]


def mask_aadhaar(last4: str) -> str:
    """Render the fragment the way UIDAI requires it to be displayed."""
    return f"XXXX XXXX {last4}"


def pan_digest(pan: str) -> str:
    """Peppered SHA-256 of a validated PAN.

    Unlike Aadhaar, the PAN itself is stored — a loan application is useless to
    a lender without it, and a digest cannot be forwarded. This exists for
    lookup: finding an applicant's history by PAN should not mean scanning the
    column holding the number.

    Peppered for the same reason as Aadhaar. PAN has a small structured space
    (five letters, four digits, a letter), so an unpeppered digest is a
    dictionary attack rather than a real one-way function.
    """
    pepper = settings.kyc_hash_pepper or ""
    return hashlib.sha256(f"pan:{pepper}:{pan}".encode()).hexdigest()


def mask_pan(pan: str | None) -> str:
    """`ABCDE1234F` -> `ABCDE****F`. The only form the API returns."""
    if not pan or len(pan) != 10:
        return "****"
    return f"{pan[:5]}****{pan[9:]}"
