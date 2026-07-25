"""
Golden fixture regression suite (BR-PERF-02, BR-PERF-03).

Asserts the deterministic layers of the pipeline — vehicle extraction,
language detection, safety normalisation and injection fencing — against a
checked-in corpus. LLM prose is deliberately out of scope: it is not
reproducible, so asserting on it would only produce flaky failures.

Marked `golden` so CI can run it informationally:

    pytest -m golden                 # run only these
    pytest -m "not golden"           # skip in a blocking gate

A failure here means behaviour moved. That is sometimes correct (a KB update,
a new language) — review the diff rather than assuming a bug.
"""
import json
from pathlib import Path

import pytest

from services.diagnosis import _normalise_follow_ups, _sanitise

FIXTURES = json.loads((Path(__file__).parent / "fixtures" / "golden_diagnosis.json").read_text())

pytestmark = pytest.mark.golden


# The vehicle extractor lives in the Angular app; these mirror its dictionaries
# so a divergence between client and server extraction is caught here.
_MAKES = {
    # English
    "maruti suzuki": "Maruti Suzuki", "maruti": "Maruti Suzuki",
    "hyundai": "Hyundai", "tata": "Tata", "honda": "Honda",
    # Devanagari (Hindi/Marathi)
    "मारुति सुजुकी": "Maruti Suzuki", "मारुति": "Maruti Suzuki",
    "टाटा": "Tata", "होंडा": "Honda",
    # Bengali — visually close to Devanagari but a distinct script, so the
    # entries are genuinely separate keys, not duplicates.
    "টাটা": "Tata", "মারুতি": "Maruti Suzuki", "হোন্ডা": "Honda",
    # Tamil
    "ஹோண்டா": "Honda", "மாருதி": "Maruti Suzuki",
}

_SCRIPT_RANGES = [
    ((0x0900, 0x097F), "deva"), ((0x0980, 0x09FF), "beng"),
    ((0x0B80, 0x0BFF), "taml"), ((0x0C00, 0x0C7F), "telu"),
    ((0x0C80, 0x0CFF), "knda"), ((0x0D00, 0x0D7F), "mlym"),
    ((0x0A80, 0x0AFF), "gujr"), ((0x0A00, 0x0A7F), "guru"),
    ((0x0B00, 0x0B7F), "orya"),
]
_SCRIPT_TO_LANG = {
    "beng": "bn-IN", "taml": "ta-IN", "telu": "te-IN", "knda": "kn-IN",
    "mlym": "ml-IN", "gujr": "gu-IN", "guru": "pa-IN", "orya": "or-IN",
}
_MARATHI_MARKERS = ["माझ", "आहे", "मला", "तुमच", "नाही", "आणि", "येतो", "काय"]


def _detect_language(text: str) -> str:
    """Mirror of the client's detectLanguageFromText, for cross-checking."""
    if not text or len(text) < 3:
        return "en-IN"
    counts: dict[str, int] = {}
    for ch in text:
        cp = ord(ch)
        for (lo, hi), name in _SCRIPT_RANGES:
            if lo <= cp <= hi:
                counts[name] = counts.get(name, 0) + 1
                break
    if not counts:
        return "en-IN"
    dominant, n = max(counts.items(), key=lambda kv: kv[1])
    if n < 2:
        return "en-IN"
    if dominant == "deva":
        return "mr-IN" if any(m in text for m in _MARATHI_MARKERS) else "hi-IN"
    return _SCRIPT_TO_LANG.get(dominant, "en-IN")


class TestGoldenLanguageDetectionSuite:
    @pytest.mark.parametrize(
        "case", FIXTURES["language_detection"], ids=lambda c: c["expect"]
    )
    def test_detects_expected_language(self, case):
        assert _detect_language(case["text"]) == case["expect"]


class TestGoldenExtractionSuite:
    """Brand recognition parity between the server corpus and client dictionaries."""

    @pytest.mark.parametrize(
        "case",
        [c for c in FIXTURES["stt_transcripts"] if "manufacturer" in c.get("expect", {})],
        ids=lambda c: c["id"],
    )
    def test_manufacturer_is_recognisable(self, case):
        transcript = case["transcript"]
        expected = case["expect"]["manufacturer"]
        # Longest key first so "मारुति सुजुकी" wins over "मारुति".
        matched = None
        for key in sorted(_MAKES, key=len, reverse=True):
            haystack = transcript if not key.isascii() else transcript.lower()
            if key in haystack:
                matched = _MAKES[key]
                break
        assert matched == expected

    @pytest.mark.parametrize(
        "case",
        [c for c in FIXTURES["stt_transcripts"] if not c.get("expect")],
        ids=lambda c: c["id"],
    )
    def test_noise_yields_no_manufacturer(self, case):
        transcript = case["transcript"].lower()
        # "weather" contains "at"; short keys must not match inside words.
        assert not any(k in transcript for k in _MAKES if k.isascii() and len(k) > 3)

    @pytest.mark.parametrize(
        "case", FIXTURES["stt_transcripts"], ids=lambda c: c["id"]
    )
    def test_declared_language_matches_transcript_script(self, case):
        # Guards against a fixture drifting out of step with its own transcript.
        assert _detect_language(case["transcript"]) == case["language"]


class TestGoldenSafetyNormalisationSuite:
    @pytest.mark.parametrize(
        "case", FIXTURES["safety_normalisation"], ids=lambda c: c["id"]
    )
    def test_follow_up_gating(self, case):
        payload = {}
        if "analysis_confidence" in case:
            payload["analysis_confidence"] = case["analysis_confidence"]
        result = _normalise_follow_ups(payload)
        assert result["needs_more_info"] is case["expect_needs_more_info"]


class TestGoldenInjectionCorpusSuite:
    @pytest.mark.parametrize("attack", FIXTURES["injection_corpus"])
    def test_every_known_attack_is_redacted(self, attack):
        assert "[REDACTED]" in _sanitise(attack)

    @pytest.mark.parametrize("text", FIXTURES["injection_safe_corpus"])
    def test_legitimate_symptom_text_is_untouched(self, text):
        # False positives are as damaging as misses — they silently corrupt
        # the symptom description the diagnosis is built on.
        assert "[REDACTED]" not in _sanitise(text)
