"""
The report carries text written to be listened to, in its own language.

WHY THIS FIELD EXISTS

The app assembled the spoken report itself, joining JSON fields under English
labels — "Preliminary diagnosis:", "Possible causes:", "Recommended next
steps:". Two problems, both only audible:

  1. A Hindi or Tamil report was read out wrapped in English scaffolding. The
     values were translated; the words around them never were.
  2. Joined fields are readable text, not listenable text. A driver heard a
     list of database columns punctuated with full stops.

The obvious fix — hand-written labels for eleven languages — means writing
translations nobody on the team can verify, which is the same failure mode as
inventing a credit score. So the model that already writes every value in the
driver's language writes this sentence too (services/diagnosis.py, the LANGUAGE
instruction). Nothing is invented here and nothing is translated twice.

WHY IT CAN BE EMPTY

The heuristic engine has no language but English and no ability to compose
prose. It leaves the field empty and the client falls back to its own
assembly — honest, because heuristic output is English anyway.
"""
from services.diagnosis import _build_prompt


def _prompt(language: str = "en-IN") -> str:
    return _build_prompt(
        manufacturer="Maruti Suzuki",
        model="Swift",
        variant=None,
        model_year=2024,
        fuel_type="Petrol",
        transmission="Manual",
        odometer_km=35000,
        problem_description="The brakes squeal when stopping.",
        warning_lights=[],
        when_occurs=[],
        severity="medium",
        retrieved_cases=[],
        response_language=language,
    )


class TestSpokenSummaryIsAskedForSuite:
    def test_the_json_shape_includes_it(self):
        # Without a slot in the skeleton the model has nowhere to put it.
        assert '"spoken_summary"' in _prompt()

    def test_the_rules_say_it_is_for_listening(self):
        p = _prompt()

        assert "READ ALOUD" in p
        assert "cannot see the screen" in p

    def test_it_forbids_headings_and_field_names(self):
        # The failure being replaced: field names read out as speech.
        p = _prompt()

        assert "no field names" in p
        assert "No headings" in p

    def test_it_must_not_disagree_with_the_report(self):
        # A summary that quietly softens "do not drive" would be worse than no
        # summary at all.
        assert "must match the rest of the JSON exactly" in _prompt()

    def test_safety_leads_when_the_car_is_not_safe_to_drive(self):
        assert "if safe_to_drive is false say so" in _prompt()


class TestSpokenSummaryIsTranslatedSuite:
    def test_a_non_english_request_names_it(self):
        # It is listed with the other human-readable values, so it comes back
        # in the driver's language from the same single call.
        p = _prompt("hi-IN")

        assert "spoken_summary" in p.split("IMPORTANT — LANGUAGE")[1]

    def test_english_asks_for_no_translation_at_all(self):
        # No LANGUAGE block for English: nothing to translate, no extra tokens.
        assert "IMPORTANT — LANGUAGE" not in _prompt("en-IN")

    def test_each_supported_language_is_named_by_name(self):
        # "Write every human-readable VALUE in Tamil", not "in ta-IN".
        assert "Tamil" in _prompt("ta-IN")
        assert "Odia" in _prompt("or-IN")
