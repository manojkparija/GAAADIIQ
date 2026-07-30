"""
Dashboard telltale identification from an uploaded image.

These tests draw the symbols rather than shipping binary fixtures, so the
inputs are inspectable and the suite has no binary blobs to review.
"""
import io
from unittest.mock import patch

import pytest
from PIL import Image, ImageDraw

from services.warning_lights import (
    _classify_colour,
    identify_warning_light,
)

BLACK = (0, 0, 0)
RED = (255, 0, 0)
AMBER = (255, 170, 0)


def _png(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def battery_icon(ink=RED, bg=BLACK) -> bytes:
    """The ISO battery/charging telltale: wide box, two terminals, + and -."""
    im = Image.new("RGB", (470, 260), bg)
    d = ImageDraw.Draw(im)
    d.rectangle([135, 10, 185, 45], fill=ink)
    d.rectangle([310, 10, 360, 45], fill=ink)
    d.rectangle([90, 38, 395, 215], fill=ink)
    d.rectangle([115, 60, 370, 192], fill=bg)
    d.rectangle([130, 112, 185, 132], fill=ink)
    d.rectangle([300, 112, 355, 132], fill=ink)
    d.rectangle([317, 92, 338, 155], fill=ink)
    return _png(im)


def oil_can_icon(ink=RED, bg=BLACK) -> bytes:
    """The ISO oil-pressure telltale: wide can, handle, spout and a drip."""
    im = Image.new("RGB", (975, 520), bg)
    d = ImageDraw.Draw(im)
    d.polygon([(275, 290), (500, 290), (575, 470), (280, 470)], fill=ink)
    d.rectangle([275, 290, 510, 470], fill=ink)
    d.rounded_rectangle([345, 215, 440, 290], 12, fill=ink)
    d.polygon([(165, 340), (300, 245), (300, 300), (215, 340), (300, 380), (300, 430)], fill=ink)
    d.polygon([(500, 300), (740, 240), (765, 290), (545, 355)], fill=ink)
    d.polygon([(560, 315), (700, 265), (690, 290), (575, 330)], fill=bg)
    d.polygon([(760, 355), (790, 410), (730, 410)], fill=ink)
    d.ellipse([728, 390, 792, 435], fill=ink)
    return _png(im)


def transmission_temp_icon(ink=AMBER, bg=BLACK) -> bytes:
    """Gear wheel with a thermometer inside — transmission over-temperature."""
    import math

    im = Image.new("RGB", (960, 585), bg)
    d = ImageDraw.Draw(im)
    cx, cy, R, r = 480, 292, 255, 196
    for k in range(16):
        a = 2 * math.pi * k / 16
        d.polygon(
            [
                (cx + rad * math.cos(a + da), cy + rad * math.sin(a + da))
                for da, rad in ((-0.085, R + 40), (0.085, R + 40), (0.11, R), (-0.11, R))
            ],
            fill=ink,
        )
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=ink)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=bg)
    d.ellipse([440, 330, 530, 420], fill=ink)
    d.rounded_rectangle([462, 140, 508, 360], 23, fill=ink)
    for y in (210, 250, 290):
        d.rectangle([508, y, 560, y + 22], fill=ink)
    return _png(im)


def blank_image() -> bytes:
    return _png(Image.new("RGB", (200, 200), BLACK))


class TestColourClassificationSuite:
    """Colour decides stop-now versus service-soon, so it must be right."""

    def test_pure_red(self):
        assert _classify_colour(255, 0, 0) == "red"

    def test_dashboard_amber(self):
        assert _classify_colour(255, 170, 0) == "amber"

    def test_warm_red_is_not_amber(self):
        # Reds photograph orange under warm cabin light; they must stay red,
        # because red is the one that means stop driving.
        assert _classify_colour(230, 60, 30) == "red"

    def test_green_and_blue_are_status_lamps(self):
        assert _classify_colour(0, 200, 60) == "green"
        assert _classify_colour(40, 80, 220) == "blue"


class TestTelltaleIdentificationSuite:
    def test_battery_icon_is_identified(self):
        r = identify_warning_light(battery_icon())
        assert r["colour"] == "red"
        assert r["identified"] is True
        assert r["best"]["id"] == "WL_BATTERY"
        assert r["best"]["safe_to_drive"] is False

    def test_battery_survives_a_white_background(self):
        # Users crop icons off white pages as often as off dark dashboards.
        r = identify_warning_light(battery_icon(ink=RED, bg=(255, 255, 255)))
        assert r["colour"] == "red"
        assert r["candidates"][0]["id"] == "WL_BATTERY"

    def test_oil_pressure_icon_is_identified(self):
        # Reported as unrecognised in the field: the real symbol is far wider
        # and more hole-rich than the signature originally allowed.
        r = identify_warning_light(oil_can_icon())
        assert r["identified"] is True
        assert r["best"]["id"] == "WL_OIL"
        assert r["best"]["severity"] == "Critical"
        assert r["best"]["safe_to_drive"] is False

    def test_transmission_temperature_icon_is_identified(self):
        # A gear wheel with a thermometer is the transmission warning, not the
        # coolant one — the catalogue had no entry for it at all.
        r = identify_warning_light(transmission_temp_icon())
        assert r["identified"] is True
        assert r["best"]["id"] == "WL_TRANSMISSION"
        assert r["colour"] == "amber"

    def test_transmission_is_not_confused_with_coolant_temperature(self):
        # Both show a thermometer; only one is amber and ringed by a gear.
        r = identify_warning_light(transmission_temp_icon())
        assert r["best"]["id"] != "WL_TEMP"

    def test_amber_urgency_differs_from_red(self):
        amber = identify_warning_light(transmission_temp_icon())["urgency_note"]
        red = identify_warning_light(oil_can_icon())["urgency_note"]
        assert "soon" in amber.lower()
        assert "stop" in red.lower()

    def test_red_urgency_is_reported_even_when_unidentified(self):
        # The colour convention is standard across every car sold in India, so
        # it is safe to act on even when the symbol itself is ambiguous.
        r = identify_warning_light(battery_icon())
        assert "stop" in r["urgency_note"].lower()

    def test_blank_image_identifies_nothing(self):
        r = identify_warning_light(blank_image())
        assert r["identified"] is False
        assert r["best"] is None
        assert r["candidates"] == []

    def test_corrupt_bytes_do_not_raise(self):
        r = identify_warning_light(b"this is not an image")
        assert r["identified"] is False
        assert r["confidence"] == 0

    def test_unidentified_never_asserts_a_name(self):
        # The contract the diagnosis prompt relies on: no confident claim
        # unless one candidate is decisively ahead.
        r = identify_warning_light(blank_image())
        assert r["best"] is None


class TestTelltaleReachesDiagnosisSuite:
    @pytest.mark.asyncio
    async def test_battery_photo_diagnoses_without_any_llm(self):
        """
        The case that matters: no vision model, no Ollama, no Gemini.

        Retrieval alone must still reach the battery/alternator case, because
        the telltale was identified locally and added to warning_lights.
        """
        from services.diagnosis import run_diagnosis

        with patch("services.diagnosis.fetch_image_bytes", return_value=battery_icon()):
            with patch("services.vision.analyse_image_url") as vision:
                vision.return_value = {"vision_model_used": False, "severity": "Unknown"}
                # Every LLM call fails — only the heuristic path remains.
                with patch("httpx.AsyncClient", side_effect=RuntimeError("offline")):
                    r = await run_diagnosis(
                        manufacturer="Maruti Suzuki", model="Swift", variant=None,
                        model_year=2019, fuel_type="Petrol", transmission="Manual",
                        odometer_km=60000,
                        problem_description="This light came on while driving",
                        warning_lights=[], when_occurs=[], severity="high",
                        image_urls=["https://media.gaadiiq.com/light.png"],
                    )

        blob = str(r).lower()
        assert "battery" in blob or "alternator" in blob
        assert r["warning_light_match"]["best"]["id"] == "WL_BATTERY"

    @pytest.mark.asyncio
    async def test_identified_light_is_added_to_warning_lights(self):
        from services.diagnosis import run_diagnosis

        seen = {}

        def _capture(desc, lights, when, fuel):
            seen["lights"] = list(lights)
            return [], "keyword"

        with patch("services.diagnosis.fetch_image_bytes", return_value=battery_icon()):
            with patch("services.vision.analyse_image_url") as vision:
                vision.return_value = {"vision_model_used": False, "severity": "Unknown"}
                with patch("services.diagnosis._retrieve_cases", side_effect=_capture):
                    with patch("httpx.AsyncClient", side_effect=RuntimeError("offline")):
                        await run_diagnosis(
                            manufacturer="Maruti Suzuki", model="Swift", variant=None,
                            model_year=2019, fuel_type="Petrol", transmission="Manual",
                            odometer_km=60000, problem_description="Light on",
                            warning_lights=[], when_occurs=[], severity="high",
                            image_urls=["https://media.gaadiiq.com/light.png"],
                        )

        assert any("battery" in x.lower() for x in seen["lights"])
