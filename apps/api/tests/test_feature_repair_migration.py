"""
Repairing features already stored as Python dict reprs.

Fixing the cleaner stops new rows going bad; it does nothing for the ones
already written, and buyers are looking at those now. This is the repair, and
what matters about it is its restraint: it rewrites a value only when it can
read the phrase out of it confidently, and leaves anything ambiguous alone.

A feature it cannot repair stays visibly broken, which someone will report. One
silently replaced by a guess will not be.
"""

import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "repair_0039",
    Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0039_repair_dict_repr_features.py",
)
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
_repair = _module._repair


def test_the_reported_value_is_repaired():
    assert _repair("{'feature': 'Head-Up Display'}") == "Head-Up Display"


def test_a_phrase_with_punctuation_survives():
    assert _repair("{'feature': '9-inch SmartPlay Pro+ Touchscreen'}") == (
        "9-inch SmartPlay Pro+ Touchscreen"
    )


def test_double_quoted_reprs_are_handled():
    assert _repair('{"name": "360-Degree Camera"}') == "360-Degree Camera"


def test_a_healthy_feature_is_left_untouched():
    # The common case by far: most rows are fine and must not be rewritten.
    assert _repair("Head-Up Display") is None


def test_something_that_merely_starts_with_a_brace_is_left_alone():
    assert _repair("{not a dict") is None
    assert _repair("{}") is None


def test_an_ambiguous_object_is_refused():
    # Two candidate strings and no trusted key: printing the wrong one is
    # worse than leaving it visibly broken.
    assert _repair("{'a': 'one', 'b': 'two'}") is None


def test_a_single_valued_object_is_repaired_whatever_the_key():
    assert _repair("{'unexpected': 'Ventilated Seats'}") == "Ventilated Seats"


def test_a_named_key_wins_over_another_string():
    assert _repair("{'category': 'Comfort', 'feature': 'Ventilated Seats'}") == (
        "Ventilated Seats"
    )


def test_a_non_string_is_ignored():
    assert _repair(42) is None
    assert _repair(None) is None


def test_nothing_executable_is_run():
    # literal_eval, not eval. This is stored data; it must parse without being
    # able to run anything.
    assert _repair("{'feature': __import__('os').system('echo hi')}") is None


def test_a_long_phrase_is_trimmed():
    assert len(_repair("{'feature': '" + "x" * 300 + "'}")) == 80
