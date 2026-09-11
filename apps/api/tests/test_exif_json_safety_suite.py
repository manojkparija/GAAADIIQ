"""
EXIF from a real camera cannot take an upload down.

THE PRODUCTION FAILURE

Uploading Grand Vitara photographs through Admin → Car Images returned 500, and
Render logged:

    sqlalchemy.exc.StatementError: (builtins.TypeError)
    Object of type IFDRational is not JSON serializable
    [SQL: INSERT INTO vehicle_media (...)]

Pillow returns every EXIF rational as IFDRational — exposure time, f-number,
focal length, and each GPS coordinate. extract_exif claimed to "handle other
non-serializable types" and to skip what it could not serialize, and did
neither: the only conversions were bytes and anything iterable, and its
try/except wrapped the conversion rather than any serialization. IFDRational is
neither bytes nor iterable, so it went into the dict untouched and json.dumps
raised several layers later, at INSERT.

So an ordinary photograph from an ordinary camera failed to upload, with a 500
and no usable message, on the screen whose entire job is uploading photographs.
Worse than the generic case: it was blocking exactly the Grand Vitara uploads
the "priced, but hidden from buyers" panel was asking for.

THE RULE

EXIF here is enrichment — nothing in the product reads a specific tag — so a
value that cannot be written is worth dropping and a failed upload is not.
Every test below ends at json.dumps, because that is the operation that
actually failed; asserting on the shape of the dict would have passed in the
broken version too.
"""
import json
from fractions import Fraction

import pytest

from services.pdf_ingest import _json_safe_exif_value


def dumps(value):
    """The operation that broke in production."""
    return json.dumps(_json_safe_exif_value(value))


# ── the reported type ───────────────────────────────────────────────────────

def test_a_pillow_rational_becomes_a_number():
    # IFDRational is a Fraction subclass; Fraction stands in for it so the test
    # does not need an image file to reproduce the reported crash.
    assert _json_safe_exif_value(Fraction(1, 200)) == pytest.approx(0.005)
    assert dumps(Fraction(1, 200))


def test_a_tuple_of_rationals_becomes_numbers():
    # GPS coordinates arrive as (degrees, minutes, seconds), all rationals. The
    # old code called list() on this and produced a list of IFDRationals —
    # still unwritable, which is why "handle iterables" did not save it.
    gps = (Fraction(20, 1), Fraction(17, 1), Fraction(4593, 100))

    assert dumps(gps) == "[20.0, 17.0, 45.93]"


def test_a_rational_with_a_zero_denominator_is_dropped():
    # Legal in EXIF and written by real cameras. float() on it either raises or
    # yields inf, and json.dumps writes inf as `Infinity` — not valid JSON, and
    # refused by Postgres. Losing the tag is the right trade.
    class ZeroDenominator:
        numerator = 1
        denominator = 0

        def __float__(self):
            raise ZeroDivisionError

    assert _json_safe_exif_value(ZeroDenominator()) is None


def test_a_non_finite_float_is_dropped():
    assert _json_safe_exif_value(float("inf")) is None
    assert _json_safe_exif_value(float("nan")) is None


# ── the types that already worked keep working ──────────────────────────────

def test_plain_values_are_left_alone():
    assert _json_safe_exif_value("Canon") == "Canon"
    assert _json_safe_exif_value(1080) == 1080
    assert _json_safe_exif_value(1.5) == 1.5
    assert _json_safe_exif_value(True) is True
    assert _json_safe_exif_value(None) is None


def test_bytes_are_decoded_without_raising_on_rubbish():
    # EXIF byte fields are routinely not UTF-8. Replacing is what keeps a
    # maker-note blob from costing the upload.
    assert _json_safe_exif_value(b"Nikon") == "Nikon"
    assert dumps(b"\xff\xfe not utf-8")


def test_a_nested_structure_is_cleaned_throughout():
    value = {"lens": {"focal": Fraction(35, 1), "junk": object()}}

    assert json.loads(dumps(value)) == {"lens": {"focal": 35.0}}


def test_a_value_of_an_unknown_type_is_dropped_rather_than_guessed():
    # str(o) would keep something, but an EXIF tag rendered as
    # "<object object at 0x...>" is noise stored forever.
    assert _json_safe_exif_value(object()) is None


def test_a_container_that_empties_out_is_dropped():
    # A tag whose every member was unwritable should not leave [] or {} behind
    # pretending a value was recorded.
    assert _json_safe_exif_value([object(), object()]) is None
    assert _json_safe_exif_value({"a": object()}) is None


def test_deep_nesting_costs_a_tag_not_a_recursion_error():
    # EXIF is attacker-supplied. The bound must be hit before Python's.
    deep = value = []
    for _ in range(50):
        nested: list = []
        value.append(nested)
        value = nested

    assert dumps(deep) is not None


# ── the whole dict, which is what actually gets inserted ────────────────────

def test_a_realistic_camera_exif_dict_is_writable():
    # The shape extract_exif builds, with the values a phone actually produces.
    # json.dumps over the whole dict is the exact operation the INSERT does.
    exif = {
        "Make": "Canon",
        "Model": b"EOS R5",
        "ExposureTime": Fraction(1, 200),
        "FNumber": Fraction(28, 10),
        "FocalLength": Fraction(50, 1),
        "GPSLatitude": (Fraction(20, 1), Fraction(17, 1), Fraction(4593, 100)),
        "Orientation": 1,
        "Unknown(42)": object(),
    }

    cleaned = {
        k: safe for k, v in exif.items()
        if (safe := _json_safe_exif_value(v)) is not None
    }

    json.dumps(cleaned)  # would have raised TypeError before this change
    assert cleaned["ExposureTime"] == pytest.approx(0.005)
    assert cleaned["Model"] == "EOS R5"
    assert "Unknown(42)" not in cleaned
