"""
Brochure ingestion: PDF in, images and vehicle data out.

The PDFs here are built in-test rather than committed as binary fixtures, so
the inputs are reviewable and the suite carries no opaque blobs.
"""
import io
import json
import uuid

import pytest

from core.config import settings
from services import pdf_ingest


def _car_png(colour=(190, 40, 40), w=900, h=520) -> bytes:
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (w, h), (245, 245, 248))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([80, 180, 820, 400], 40, fill=colour)
    d.rounded_rectangle([220, 90, 660, 210], 30, fill=colour)
    d.ellipse([160, 350, 290, 470], fill=(30, 30, 30))
    d.ellipse([620, 350, 750, 470], fill=(30, 30, 30))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def _brochure_pdf() -> bytes:
    import fitz
    doc = fitz.open()
    p = doc.new_page()
    p.insert_text((60, 70), "MARUTI SUZUKI DZIRE 2025", fontsize=24)
    p.insert_text((60, 110), "ZXi+ AGS - Ex-showroom Rs 9,29,000", fontsize=14)
    p.insert_text((60, 140), "Petrol | AGS | Sedan | Mileage 25.71 km/l", fontsize=11)
    p.insert_image(fitz.Rect(60, 200, 540, 480), stream=_car_png())
    p2 = doc.new_page()
    p2.insert_text((60, 70), "DZIRE VXi - Rs 7,79,000", fontsize=14)
    p2.insert_image(fitz.Rect(60, 120, 540, 400), stream=_car_png((40, 90, 190)))
    data = doc.tobytes()
    doc.close()
    return data


class TestPdfValidationSuite:
    def test_real_pdf_is_accepted(self):
        assert pdf_ingest.is_pdf(_brochure_pdf()) is True

    def test_renamed_file_is_rejected(self):
        # Trusting the .pdf extension is how something executable gets stored.
        assert pdf_ingest.is_pdf(b"MZ\x90\x00 this is a windows binary") is False
        assert pdf_ingest.is_pdf(b"") is False


class TestImageExtractionSuite:
    def test_images_are_extracted_from_every_page(self):
        images = pdf_ingest.extract_images(_brochure_pdf())
        assert len(images) == 2
        assert {i["page_number"] for i in images} == {1, 2}

    def test_a_modestly_sized_illustration_is_kept(self):
        # Regression: an 8 KB byte-size floor rejected every image in this
        # brochure. Flat-colour artwork compresses small but is still content,
        # so the filter keys on pixel dimensions instead.
        images = pdf_ingest.extract_images(_brochure_pdf())
        assert images, "a 900x520 image must not be filtered out"
        assert all(len(i["data"]) < 8000 for i in images)

    def test_content_type_comes_from_magic_bytes(self):
        for img in pdf_ingest.extract_images(_brochure_pdf()):
            assert pdf_ingest.sniff_image(img["data"]) == ("png", "image/png")

    def test_duplicate_images_are_stored_once(self):
        import fitz
        same = _car_png()
        doc = fitz.open()
        for _ in range(3):
            page = doc.new_page()
            page.insert_image(fitz.Rect(60, 60, 500, 320), stream=same)
        data = doc.tobytes()
        doc.close()
        # A brochure repeats its hero shot on many pages; storing it three
        # times would triple the storage bill for no benefit.
        assert len(pdf_ingest.extract_images(data)) == 1

    def test_corrupt_pdf_raises_a_clear_error(self):
        with pytest.raises(pdf_ingest.PdfIngestError):
            pdf_ingest.extract_images(b"%PDF-1.4 truncated nonsense")


class TestPriceCoercionSuite:
    """Brochures write prices four different ways; all must land in rupees."""

    @pytest.mark.parametrize("raw,expected", [
        ("9,29,000", 929_000),
        ("₹7,79,000", 779_000),
        ("6.49 Lakh", 649_000),
        ("6.49 lac", 649_000),
        (649000, 649_000),
        (6.49, 649_000),      # model echoed the lakh figure without expanding
        (None, None),
        ("not a price", None),
    ])
    def test_price_forms(self, raw, expected):
        assert pdf_ingest._coerce_price(raw) == expected


class TestExtractionParsingSuite:
    def test_json_wrapped_in_prose_is_recovered(self):
        raw = 'Here you go:\n```json\n[{"make":"Tata","model":"Nexon"}]\n```\nHope that helps!'
        assert pdf_ingest._parse_vehicles(raw) == [{"make": "Tata", "model": "Nexon"}]

    def test_object_wrapper_is_unwrapped(self):
        raw = '{"vehicles":[{"make":"Kia","model":"Seltos"}]}'
        assert pdf_ingest._parse_vehicles(raw)[0]["model"] == "Seltos"

    def test_unparseable_response_yields_nothing(self):
        assert pdf_ingest._parse_vehicles("the model refused") == []

    def test_rows_without_make_or_model_are_dropped(self):
        # A row naming no vehicle only clutters the admin review queue.
        cleaned = pdf_ingest._clean([{"price_inr": 500000}, {"make": "Honda"}])
        assert len(cleaned) == 1
        assert cleaned[0]["make"] == "Honda"

    def test_confidence_is_clamped(self):
        cleaned = pdf_ingest._clean([{"make": "X", "confidence": 7.4}])
        assert cleaned[0]["confidence"] == 1.0


class TestStorageKeySuite:
    def test_keys_are_grouped_by_job(self):
        job = uuid.uuid4()
        key = pdf_ingest.build_key(job, 3, "png")
        assert key == f"brochures/{job}/003.png"

    def test_extension_is_sanitised(self):
        # The extension reaches a filesystem path, so it must not carry
        # traversal characters out of a malformed PDF.
        key = pdf_ingest.build_key(uuid.uuid4(), 0, "../../etc/passwd")
        assert ".." not in key and "/etc" not in key


class TestVisionFallbackSuite:
    """
    A brochure with no text layer must still be readable.

    A real Dzire brochure yielded exactly zero characters: manufacturers lay
    these out as artwork, with the model name, variant grid and prices printed
    into the page images. Text extraction cannot succeed on such a file however
    the model is configured, so the pages are rendered and shown to Gemini as
    pictures instead.
    """

    @staticmethod
    def _textless_pdf() -> bytes:
        """A page that is entirely one image — no extractable text at all."""
        import io

        import fitz
        from PIL import Image, ImageDraw

        img = Image.new("RGB", (1240, 1754), (250, 250, 252))
        draw = ImageDraw.Draw(img)
        draw.text((80, 90), "DZIRE", fill=(180, 20, 40))
        draw.text((80, 200), "VXi   Rs 7,49,000   Petrol   Manual", fill=(20, 20, 20))
        buf = io.BytesIO()
        img.save(buf, "PNG")

        doc = fitz.open()
        page = doc.new_page(width=595, height=842)
        page.insert_image(fitz.Rect(0, 0, 595, 842), stream=buf.getvalue())
        data = doc.tobytes()
        doc.close()
        return data

    def test_the_fixture_really_has_no_text(self):
        # If this ever gains a text layer the tests below stop testing anything.
        assert pdf_ingest.extract_text(self._textless_pdf()).strip() == ""

    def test_render_pages_produces_pngs(self):
        pages = pdf_ingest.render_pages(self._textless_pdf())

        assert len(pages) == 1
        assert pages[0].startswith(b"\x89PNG")

    def test_render_pages_is_bounded(self, monkeypatch):
        import fitz

        doc = fitz.open()
        for _ in range(12):
            doc.new_page(width=595, height=842)
        many = doc.tobytes()
        doc.close()

        # Sending an entire catalogue would be slow and expensive for little
        # extra information.
        assert len(pdf_ingest.render_pages(many, max_pages=3)) == 3

    @pytest.mark.asyncio
    async def test_a_textless_pdf_is_read_as_images(self, monkeypatch):
        sent = {}

        async def fake_gemini(prompt, images=None):
            sent["images"] = images or []
            sent["prompt"] = prompt
            return json.dumps([{
                "make": "Maruti Suzuki", "model": "Dzire", "variant": "VXi",
                "price_inr": 749000, "confidence": 0.9,
            }])

        monkeypatch.setattr(pdf_ingest, "_call_gemini", fake_gemini)
        monkeypatch.setattr(settings, "gemini_api_key", "test-key")

        vehicles, engine = await pdf_ingest.extract_vehicles("", source=self._textless_pdf())

        assert engine == "gemini-vision"
        assert vehicles[0]["model"] == "Dzire"
        assert vehicles[0]["price_inr"] == 749000
        assert sent["images"] and sent["images"][0].startswith(b"\x89PNG")

    @pytest.mark.asyncio
    async def test_text_pdfs_still_take_the_text_path(self, monkeypatch):
        """Rendering pages costs tokens and time; text is used when present."""
        calls = {"images": None}

        async def fake_gemini(prompt, images=None):
            calls["images"] = images
            return json.dumps([{"make": "Maruti Suzuki", "model": "Swift", "confidence": 0.8}])

        monkeypatch.setattr(pdf_ingest, "_call_gemini", fake_gemini)
        monkeypatch.setattr(settings, "gemini_api_key", "test-key")

        _, engine = await pdf_ingest.extract_vehicles("Swift VXi Rs 6,49,000 " * 20)

        assert engine == "gemini"
        assert calls["images"] is None, "images must not be sent when text exists"

    @pytest.mark.asyncio
    async def test_no_key_means_no_vision_attempt(self, monkeypatch):
        monkeypatch.setattr(settings, "gemini_api_key", "")

        vehicles, engine = await pdf_ingest.extract_vehicles("", source=self._textless_pdf())

        assert (vehicles, engine) == ([], "none")

    @pytest.mark.asyncio
    async def test_a_failing_vision_call_does_not_lose_the_images(self, monkeypatch):
        """
        Image extraction has already succeeded by this point. A model error must
        return empty, never raise, or the whole job fails and the photographs
        are discarded with it.
        """
        async def boom(prompt, images=None):
            raise RuntimeError("429 quota exceeded")

        monkeypatch.setattr(pdf_ingest, "_call_gemini", boom)
        monkeypatch.setattr(settings, "gemini_api_key", "test-key")

        # Must return, not raise: the photographs are already extracted and a
        # quota error must not discard them. The engine value names the cause.
        vehicles, engine = await pdf_ingest.extract_vehicles("", source=self._textless_pdf())

        assert vehicles == []
        assert engine == "vision-call-failed"


class TestVisionFailureModesSuite:
    """
    Each way the vision path can fail reports itself distinctly, so the review
    screen can say what actually happened instead of guessing.
    """

    def _textless(self) -> bytes:
        return TestVisionFallbackSuite._textless_pdf()

    @pytest.mark.asyncio
    async def test_a_failing_call_is_named(self, monkeypatch):
        async def boom(prompt, images=None):
            raise RuntimeError("429 quota exceeded")

        monkeypatch.setattr(pdf_ingest, "_call_gemini", boom)
        monkeypatch.setattr(settings, "gemini_api_key", "test-key")

        assert await pdf_ingest.extract_vehicles("", source=self._textless()) == ([], "vision-call-failed")

    @pytest.mark.asyncio
    async def test_an_unparseable_reply_is_named(self, monkeypatch):
        async def prose(prompt, images=None):
            return "I'm afraid I can't read that brochure."

        monkeypatch.setattr(pdf_ingest, "_call_gemini", prose)
        monkeypatch.setattr(settings, "gemini_api_key", "test-key")

        vehicles, engine = await pdf_ingest.extract_vehicles("", source=self._textless())
        assert vehicles == []
        assert engine in ("vision-parse-failed", "gemini-vision")

    @pytest.mark.asyncio
    async def test_a_render_failure_is_named(self, monkeypatch):
        def no_pages(source, max_pages=8, dpi=120):
            return []

        monkeypatch.setattr(pdf_ingest, "render_pages", no_pages)
        monkeypatch.setattr(settings, "gemini_api_key", "test-key")

        assert await pdf_ingest.extract_vehicles("", source=self._textless()) == ([], "vision-render-failed")

    @pytest.mark.asyncio
    async def test_no_key_is_still_plain_none(self, monkeypatch):
        # Distinct from every vision outcome: nothing was attempted.
        monkeypatch.setattr(settings, "gemini_api_key", "")

        assert await pdf_ingest.extract_vehicles("", source=self._textless()) == ([], "none")
