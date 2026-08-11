"""Canonical make and model names.

An image finds its car by matching make + model + year, all three exact
(`media_library.urls_for_cars`). That makes the spelling of a manufacturer a
functional key, not a label — and nothing was enforcing it. The catalogue ended
up holding the same vehicle twice:

    cars  | Maruti        | SPRESSO  | 2020
    cars  | Maruti Suzuki | S-Presso | 2026

Photographs uploaded against one spelling are invisible to the other, silently
and with no error anywhere. That is a whole gallery disappearing because
somebody typed a shorter brand name.

This module is the single place that decides what a manufacturer is called.
Aliases map the forms people actually type — "Maruti", "MARUTI SUZUKI",
"maruti-suzuki" — onto one canonical spelling. Anything unrecognised is
title-cased and passed through rather than rejected: a marketplace must be able
to list a brand this list has not heard of, and blocking that would be worse
than an inconsistent name.

Model names are only tidied, never mapped. There are thousands of them, they
change every year, and a wrong guess here would file a photograph against the
wrong car — which is the failure this module exists to prevent.
"""

from __future__ import annotations

import re

#: Every spelling seen in the wild, mapped to the one the catalogue uses.
#: Keys are compared after `_squash()`, so case, spacing and punctuation in the
#: key itself do not matter.
_MAKE_ALIASES: dict[str, str] = {
    "maruti": "Maruti Suzuki",
    "marutisuzuki": "Maruti Suzuki",
    "suzuki": "Maruti Suzuki",
    "msil": "Maruti Suzuki",
    "hyundai": "Hyundai",
    "hyundaimotor": "Hyundai",
    "tata": "Tata",
    "tatamotors": "Tata",
    "mahindra": "Mahindra",
    "mahindramahindra": "Mahindra",
    "mm": "Mahindra",
    "kia": "Kia",
    "kiamotors": "Kia",
    "toyota": "Toyota",
    "toyotakirloskar": "Toyota",
    "honda": "Honda",
    "hondacars": "Honda",
    "renault": "Renault",
    "nissan": "Nissan",
    "skoda": "Skoda",
    "vw": "Volkswagen",
    "volkswagen": "Volkswagen",
    "mg": "MG",
    "mgmotor": "MG",
    "morrisgarages": "MG",
    "jeep": "Jeep",
    "citroen": "Citroen",
    "bmw": "BMW",
    "mercedes": "Mercedes-Benz",
    "mercedesbenz": "Mercedes-Benz",
    "merc": "Mercedes-Benz",
    "audi": "Audi",
    "volvo": "Volvo",
    "lexus": "Lexus",
    "jaguar": "Jaguar",
    "landrover": "Land Rover",
    "porsche": "Porsche",
    "mini": "MINI",
    "isuzu": "Isuzu",
    "force": "Force Motors",
    "forcemotors": "Force Motors",
    "byd": "BYD",
    "ola": "Ola Electric",
    "olaelectric": "Ola Electric",
    "ather": "Ather",
}


def _squash(value: str) -> str:
    """Lowercase, and drop everything that is not a letter or digit.

    So "Maruti-Suzuki", "MARUTI SUZUKI" and "maruti  suzuki" all reduce to the
    same lookup key.
    """
    return re.sub(r"[^a-z0-9]", "", value.lower())


def canonical_make(raw: str | None) -> str | None:
    """The catalogue's spelling of a manufacturer.

    Returns None for empty input. Unknown makes are collapsed to single spaces
    and title-cased, so "  tesla   motors " becomes "Tesla Motors" — consistent
    even when it is not in the list.
    """
    if not raw or not raw.strip():
        return None
    cleaned = re.sub(r"\s+", " ", raw.strip())
    known = _MAKE_ALIASES.get(_squash(cleaned))
    if known:
        return known
    # Title-case, but leave an already-mixed-case word alone: "BMW" and "MG"
    # must not become "Bmw" and "Mg".
    return " ".join(w if any(c.isupper() for c in w[1:]) else w.capitalize()
                    for w in cleaned.split(" "))


def canonical_model(raw: str | None) -> str | None:
    """A model name with its whitespace tidied, and nothing else changed.

    Deliberately not mapped through an alias table. "S-Presso" and "SPRESSO"
    may or may not be the same trim of the same car, and a lookup table that
    guessed wrong would attach photographs to the wrong vehicle — a worse
    failure than the inconsistency it set out to fix. Use `looks_like_variant`
    to *report* near-duplicates and let a human decide.
    """
    if not raw or not raw.strip():
        return None
    return re.sub(r"\s+", " ", raw.strip())


def looks_like_variant(a: str | None, b: str | None) -> bool:
    """Whether two model names are plausibly the same car spelled differently.

    "S-Presso" vs "SPRESSO", "CR-V" vs "CRV". For flagging duplicates to an
    admin — never for merging them automatically.
    """
    if not a or not b:
        return False
    return _squash(a) == _squash(b) and a.strip() != b.strip()


def same_vehicle(
    make_a: str | None, model_a: str | None, year_a: int | None,
    make_b: str | None, model_b: str | None, year_b: int | None,
) -> bool:
    """Whether two identities would resolve to the same catalogue car.

    The comparison `media_library` performs, in one place, so a change to what
    "the same vehicle" means cannot drift between the two.
    """
    if year_a != year_b:
        return False
    return (
        canonical_make(make_a) == canonical_make(make_b)
        and _squash(model_a or "") == _squash(model_b or "")
    )
