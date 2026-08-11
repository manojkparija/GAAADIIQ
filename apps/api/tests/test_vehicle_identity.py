"""One spelling per manufacturer.

An image finds its car by matching make + model + year exactly, which makes the
spelling of a brand a functional key. The catalogue held both `Maruti / SPRESSO
/ 2020` and `Maruti Suzuki / S-Presso / 2026`, and a gallery uploaded under one
was invisible under the other — silently, with no error anywhere.
"""

import pytest

from services import vehicle_identity as vi


def test_the_spellings_that_actually_collided_resolve_to_one():
    """The exact pair that split the S-Presso into two cars."""
    assert vi.canonical_make("Maruti") == "Maruti Suzuki"
    assert vi.canonical_make("Maruti Suzuki") == "Maruti Suzuki"
    assert vi.canonical_make("MARUTI SUZUKI") == "Maruti Suzuki"
    assert vi.canonical_make("maruti-suzuki") == "Maruti Suzuki"
    assert vi.canonical_make("  maruti  ") == "Maruti Suzuki"


@pytest.mark.parametrize("raw,expected", [
    ("tata motors", "Tata"),
    ("Mahindra & Mahindra", "Mahindra"),
    ("VW", "Volkswagen"),
    ("mercedes benz", "Mercedes-Benz"),
    ("MG Motor", "MG"),
    ("kia motors", "Kia"),
    ("Hyundai Motor", "Hyundai"),
])
def test_common_alternate_spellings(raw, expected):
    assert vi.canonical_make(raw) == expected


def test_an_unknown_make_is_tidied_not_rejected():
    """
    A marketplace has to be able to list a brand this table has not heard of.
    Blocking that would be worse than an inconsistent name.
    """
    assert vi.canonical_make("  tesla   motors ") == "Tesla Motors"
    assert vi.canonical_make("rivian") == "Rivian"


def test_an_already_capitalised_acronym_is_left_alone():
    """"BMW" must not become "Bmw"."""
    assert vi.canonical_make("BMW") == "BMW"
    assert vi.canonical_make("BYD") == "BYD"


def test_empty_input_is_none_not_a_guess():
    assert vi.canonical_make(None) is None
    assert vi.canonical_make("   ") is None
    assert vi.canonical_model(None) is None


def test_model_names_are_tidied_but_never_mapped():
    """
    Deliberate. "S-Presso" and "SPRESSO" may be the same car or may not, and a
    table that guessed wrong would attach photographs to the wrong vehicle —
    a worse failure than the inconsistency it set out to fix.
    """
    assert vi.canonical_model("  S-Presso  ") == "S-Presso"
    assert vi.canonical_model("Grand  i10   Nios") == "Grand i10 Nios"
    # Not rewritten to match each other:
    assert vi.canonical_model("SPRESSO") == "SPRESSO"
    assert vi.canonical_model("S-Presso") != vi.canonical_model("SPRESSO")


def test_near_duplicate_models_are_reported_for_a_human():
    assert vi.looks_like_variant("S-Presso", "SPRESSO")
    assert vi.looks_like_variant("CR-V", "CRV")
    # Same string is not a duplicate to report.
    assert not vi.looks_like_variant("S-Presso", "S-Presso")
    # Genuinely different cars are not flagged.
    assert not vi.looks_like_variant("Swift", "Baleno")


def test_same_vehicle_is_the_match_the_gallery_actually_performs():
    """The two rows that split, now recognised as one vehicle bar the year."""
    assert vi.same_vehicle("Maruti", "SPRESSO", 2026, "Maruti Suzuki", "S-Presso", 2026)
    # Year is part of the key: a 2020 car is not a 2026 car.
    assert not vi.same_vehicle("Maruti", "S-Presso", 2020, "Maruti Suzuki", "S-Presso", 2026)
    assert not vi.same_vehicle("Tata", "Nexon", 2025, "Maruti Suzuki", "Nexon", 2025)
