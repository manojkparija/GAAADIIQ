"""
Turning whatever the model returned into a feature a buyer can read.

Reported from UAT with a screenshot of the Fronx Features tab showing

    ✓ {'feature': 'Head-Up Display'}
    ✓ {'feature': '9-inch SmartPlay Pro+ Touchscreen'}

The prompt asks for a list of strings and usually gets one. When it returned a
list of objects instead, the cleaner's str(f) rendered the whole dict, and the
page displayed a Python dict repr as a selling point. Two code paths had their
own copy of that str() call, so both had the bug.

These cover the shapes a language model actually produces, including the ones
that must be dropped rather than coerced: str(True) is "True", which reads like
a feature and is not one.
"""

from services.variant_research import _clean_features, _feature_text


def test_a_plain_string_is_left_alone():
    assert _clean_features(["Head-Up Display"]) == ["Head-Up Display"]


def test_the_reported_shape_is_unwrapped():
    # Exactly what the screenshot showed.
    raw = [
        {"feature": "Head-Up Display"},
        {"feature": "9-inch SmartPlay Pro+ Touchscreen"},
        {"feature": "360-Degree Camera"},
    ]
    assert _clean_features(raw) == [
        "Head-Up Display",
        "9-inch SmartPlay Pro+ Touchscreen",
        "360-Degree Camera",
    ]


def test_other_common_keys_are_unwrapped_too():
    assert _clean_features([{"name": "Sunroof"}]) == ["Sunroof"]
    assert _clean_features([{"label": "Cruise Control"}]) == ["Cruise Control"]
    assert _clean_features([{"title": "6 Airbags"}]) == ["6 Airbags"]


def test_a_single_valued_object_is_unwrapped_whatever_the_key():
    assert _clean_features([{"unexpected_key": "Ventilated Seats"}]) == ["Ventilated Seats"]


def test_a_named_key_wins_over_a_lucky_one():
    item = {"category": "Comfort", "feature": "Ventilated Seats"}
    assert _feature_text(item) == "Ventilated Seats"


def test_an_ambiguous_object_is_dropped_rather_than_guessed():
    # Two strings and no key worth trusting: printing the wrong one is worse
    # than printing nothing.
    assert _clean_features([{"a": "one", "b": "two"}]) == []


def test_strings_and_objects_can_be_mixed():
    assert _clean_features(["ABS", {"feature": "EBD"}]) == ["ABS", "EBD"]


def test_numbers_and_booleans_are_not_features():
    # str(True) is "True", which reads like one.
    assert _clean_features([True, 42, None, "Real Feature"]) == ["Real Feature"]


def test_blank_entries_are_dropped():
    assert _clean_features(["  ", {"feature": ""}, "Sunroof"]) == ["Sunroof"]


def test_a_non_list_returns_nothing():
    assert _clean_features("Sunroof, ABS") == []
    assert _clean_features(None) == []


def test_the_list_is_capped():
    assert len(_clean_features([f"F{i}" for i in range(20)])) == 6


def test_the_cap_is_adjustable_for_the_model_level_path():
    assert len(_clean_features([f"F{i}" for i in range(20)], limit=10)) == 10


def test_a_very_long_phrase_is_trimmed():
    assert len(_clean_features(["x" * 300])[0]) == 80
