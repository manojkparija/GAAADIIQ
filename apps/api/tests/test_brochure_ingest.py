"""
Brochure ingestion: PDF in, images and vehicle data out.

The PDFs here are built in-test rather than committed as binary fixtures, so
the inputs are reviewable and the suite carries no opaque blobs.
"""
import base64
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
    async def test_no_gemini_key_still_reads_the_pages_with_a_free_provider(self, monkeypatch):
        """
        Absence of a Gemini key is the exact case the free fallback exists for,
        so it must not skip vision. Gating the whole vision path on the Gemini
        key meant removing the key reported "none" and no free provider was ever
        reached.
        """
        async def fake_groq(prompt, images):
            return json.dumps([{"make": "Maruti Suzuki", "model": "Dzire", "confidence": 0.7}])

        monkeypatch.setattr(settings, "gemini_api_key", "")
        monkeypatch.setattr(settings, "groq_api_key", "test-groq-key")
        monkeypatch.setattr(pdf_ingest, "_call_groq_vision", fake_groq)

        vehicles, engine = await pdf_ingest.extract_vehicles("", source=self._textless_pdf())

        assert engine == "groq-vision"
        assert [v["model"] for v in vehicles] == ["Dzire"]

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
    async def test_no_source_to_render_is_still_plain_none(self, monkeypatch):
        # "none" now means strictly "there was nothing to attempt" — no text to
        # read and no pages to render. Distinct from every vision outcome, which
        # all imply a provider was tried.
        monkeypatch.setattr(settings, "gemini_api_key", "")
        monkeypatch.setattr(settings, "groq_api_key", "")

        assert await pdf_ingest.extract_vehicles("", source=None) == ([], "none")


class TestOllamaVisionFallbackSuite:
    """
    When Gemini quota is exhausted, fallback to Ollama's free local model.

    Ollama is self-hosted and has no quota or API costs, only the tradeoff of
    speed and accuracy vs. Gemini. This is the free AI API fallback for vision
    extraction.
    """

    def _textless(self) -> bytes:
        return TestVisionFallbackSuite._textless_pdf()

    @pytest.mark.asyncio
    async def test_ollama_vision_is_fallback_when_gemini_key_is_set(self, monkeypatch):
        """Ollama vision is only attempted if Gemini key is set (enables vision)."""
        gemini_called = False

        async def fake_gemini(prompt, images=None):
            nonlocal gemini_called
            gemini_called = True
            raise RuntimeError("429 quota exceeded")

        async def fake_ollama_vision(prompt, images=None):
            assert images and len(images) > 0
            return json.dumps([{
                "make": "Maruti Suzuki", "model": "Dzire", "variant": "VXi",
                "price_inr": 749000, "confidence": 0.85,
            }])

        monkeypatch.setattr(pdf_ingest, "_call_gemini", fake_gemini)
        monkeypatch.setattr(pdf_ingest, "_call_ollama_vision", fake_ollama_vision)
        monkeypatch.setattr(settings, "gemini_api_key", "test-key")

        vehicles, engine = await pdf_ingest.extract_vehicles("", source=self._textless())

        assert gemini_called, "Gemini should be tried first when key is set"
        assert engine == "ollama-vision"
        assert vehicles[0]["model"] == "Dzire"

    @pytest.mark.asyncio
    async def test_ollama_vision_is_fallback_when_gemini_fails(self, monkeypatch):
        """When Gemini vision fails, Ollama vision is tried as fallback."""
        calls = {"gemini": 0, "ollama": 0}

        async def fake_gemini(prompt, images=None):
            calls["gemini"] += 1
            raise RuntimeError("429 quota exceeded")

        async def fake_ollama_vision(prompt, images=None):
            calls["ollama"] += 1
            assert images and len(images) > 0
            return json.dumps([{
                "make": "Tata", "model": "Nexon", "variant": "EV",
                "price_inr": 1500000, "confidence": 0.8,
            }])

        monkeypatch.setattr(pdf_ingest, "_call_gemini", fake_gemini)
        monkeypatch.setattr(pdf_ingest, "_call_ollama_vision", fake_ollama_vision)
        monkeypatch.setattr(settings, "gemini_api_key", "test-key")

        vehicles, engine = await pdf_ingest.extract_vehicles("", source=self._textless())

        assert calls["gemini"] == 1, "Gemini should be tried first"
        assert calls["ollama"] == 1, "Ollama should be tried after Gemini fails"
        assert engine == "ollama-vision"
        assert vehicles[0]["model"] == "Nexon"

    @pytest.mark.asyncio
    async def test_both_vision_models_fail_returns_vision_call_failed(self, monkeypatch):
        """When both Gemini and Ollama vision fail, return vision-call-failed."""
        async def boom_gemini(prompt, images=None):
            raise RuntimeError("429 quota exceeded")

        async def boom_ollama(prompt, images=None):
            raise RuntimeError("Ollama unreachable")

        monkeypatch.setattr(pdf_ingest, "_call_gemini", boom_gemini)
        monkeypatch.setattr(pdf_ingest, "_call_ollama_vision", boom_ollama)
        monkeypatch.setattr(settings, "gemini_api_key", "test-key")

        vehicles, engine = await pdf_ingest.extract_vehicles("", source=self._textless())

        assert vehicles == []
        assert engine == "vision-call-failed"

    @pytest.mark.asyncio
    async def test_ollama_vision_returns_nothing_when_found_no_vehicles(self, monkeypatch):
        """Ollama vision can read images but find no vehicles when Gemini fails."""
        async def gemini_fails(prompt, images=None):
            raise RuntimeError("quota")

        async def fake_ollama_vision(prompt, images=None):
            return json.dumps([])

        monkeypatch.setattr(pdf_ingest, "_call_gemini", gemini_fails)
        monkeypatch.setattr(pdf_ingest, "_call_ollama_vision", fake_ollama_vision)
        monkeypatch.setattr(settings, "gemini_api_key", "test-key")

        vehicles, engine = await pdf_ingest.extract_vehicles("", source=self._textless())

        assert vehicles == []
        assert engine == "ollama-vision"

    @pytest.mark.asyncio
    async def test_ollama_vision_with_unparseable_response(self, monkeypatch):
        """When Ollama vision returns unparseable JSON after Gemini fails."""
        async def gemini_fails(prompt, images=None):
            raise RuntimeError("quota")

        async def unparseable(prompt, images=None):
            return "I'm not JSON"

        monkeypatch.setattr(pdf_ingest, "_call_gemini", gemini_fails)
        monkeypatch.setattr(pdf_ingest, "_call_ollama_vision", unparseable)
        monkeypatch.setattr(settings, "gemini_api_key", "test-key")

        vehicles, engine = await pdf_ingest.extract_vehicles("", source=self._textless())

        assert vehicles == []
        # Unparseable responses are treated like "found nothing", consistent with Gemini
        assert engine == "ollama-vision"


class TestGroqVisionFallbackSuite:
    """
    Groq is the free fallback that works in the deployed API.

    Ollama, the previous free fallback, has to be self-hosted — the deployed
    backend has no Ollama to reach, so that hop can only ever succeed on a
    developer machine. These cover the provider that actually answers in
    production.
    """

    def _textless(self) -> bytes:
        return TestVisionFallbackSuite._textless_pdf()

    @pytest.mark.asyncio
    async def test_groq_takes_over_when_gemini_fails(self, monkeypatch):
        async def boom(prompt, images=None):
            raise RuntimeError("429 quota exceeded")

        async def fake_groq(prompt, images):
            return json.dumps([{"make": "Maruti Suzuki", "model": "Dzire", "confidence": 0.8}])

        monkeypatch.setattr(settings, "gemini_api_key", "test-key")
        monkeypatch.setattr(settings, "groq_api_key", "test-groq-key")
        monkeypatch.setattr(pdf_ingest, "_call_gemini", boom)
        monkeypatch.setattr(pdf_ingest, "_call_groq_vision", fake_groq)

        vehicles, engine = await pdf_ingest.extract_vehicles("", source=self._textless())

        assert engine == "groq-vision"
        assert [v["model"] for v in vehicles] == ["Dzire"]

    @pytest.mark.asyncio
    async def test_groq_is_skipped_without_a_key(self, monkeypatch):
        """An unconfigured provider must not be attempted at all."""
        called = {"groq": False}

        async def fake_groq(prompt, images):
            called["groq"] = True
            return "[]"

        monkeypatch.setattr(settings, "gemini_api_key", "")
        monkeypatch.setattr(settings, "groq_api_key", "")
        monkeypatch.setattr(pdf_ingest, "_call_groq_vision", fake_groq)

        await pdf_ingest.extract_vehicles("", source=self._textless())

        assert called["groq"] is False

    @pytest.mark.asyncio
    async def test_pages_are_batched_to_groqs_five_image_limit(self, monkeypatch):
        """
        Groq rejects more than 5 images per request but PDF_VISION_MAX_PAGES is 8.
        Batching rather than truncating: the variant grid is as likely to be on
        page 6 as page 1, so dropping the overflow would lose the table this
        reads the pages to find.
        """
        batches: list[int] = []

        async def fake_chat(content, timeout):
            batches.append(sum(1 for part in content if part["type"] == "image_url"))
            return json.dumps([{"make": "Maruti Suzuki", "model": f"V{len(batches)}", "confidence": 0.6}])

        monkeypatch.setattr(settings, "groq_api_key", "test-groq-key")
        monkeypatch.setattr(settings, "groq_max_images_per_request", 5)
        monkeypatch.setattr(pdf_ingest, "_groq_chat", fake_chat)

        raw = await pdf_ingest._call_groq_vision("prompt", [b"png"] * 8)

        assert batches == [5, 3], "8 pages must go as a 5-image batch then a 3-image batch"
        # Every batch's findings are kept, not just the last request's.
        assert [v["model"] for v in json.loads(raw)] == ["V1", "V2"]

    @pytest.mark.asyncio
    async def test_a_failed_batch_keeps_the_pages_that_read(self, monkeypatch):
        """One bad batch must not discard the variants the other batches found."""
        calls = {"n": 0}

        async def flaky_chat(content, timeout):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("503 upstream")
            return json.dumps([{"make": "Maruti Suzuki", "model": "Dzire", "confidence": 0.6}])

        monkeypatch.setattr(settings, "groq_api_key", "test-groq-key")
        monkeypatch.setattr(settings, "groq_max_images_per_request", 5)
        monkeypatch.setattr(pdf_ingest, "_groq_chat", flaky_chat)

        raw = await pdf_ingest._call_groq_vision("prompt", [b"png"] * 8)

        assert [v["model"] for v in json.loads(raw)] == ["Dzire"]

    @pytest.mark.asyncio
    async def test_every_batch_failing_raises_so_the_next_provider_runs(self, monkeypatch):
        async def always_fails(content, timeout):
            raise RuntimeError("503 upstream")

        monkeypatch.setattr(settings, "groq_api_key", "test-groq-key")
        monkeypatch.setattr(pdf_ingest, "_groq_chat", always_fails)

        with pytest.raises(Exception):
            await pdf_ingest._call_groq_vision("prompt", [b"png"] * 8)


class TestOllamaVisionPayloadSuite:
    """
    Ollama takes images as a top-level `images` field of base64 strings.

    An earlier version encoded them into the prompt text instead, which showed
    the model a wall of base64 and no picture — so the fallback could never have
    read a brochure however well it was configured.
    """

    @pytest.mark.asyncio
    async def test_images_go_in_the_images_field_not_the_prompt(self, monkeypatch):
        captured: dict = {}

        class FakeResponse:
            def raise_for_status(self):
                return None

            def json(self):
                return {"response": "[]"}

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def post(self, url, json=None, **kwargs):
                captured.update(json or {})
                return FakeResponse()

        monkeypatch.setattr(pdf_ingest.httpx, "AsyncClient", lambda **kw: FakeClient())

        await pdf_ingest._call_ollama_vision("read this", images=[b"\x89PNG-one", b"\x89PNG-two"])

        assert captured["images"] == [
            base64.b64encode(b"\x89PNG-one").decode("ascii"),
            base64.b64encode(b"\x89PNG-two").decode("ascii"),
        ]
        # The prompt must stay the prompt — no base64 smuggled into it.
        assert captured["prompt"] == "read this"
        assert "IMAGE_DATA" not in captured["prompt"]


class TestGroqRateLimitSuite:
    """
    A throttle is not a failure and must not be reported as one.

    Groq's free tier is bounded per minute and per day, and the budget is shared
    across the organisation rather than per key, so a burst of uploads can
    throttle even when one brochure would not. An invalid key never fixes
    itself; a rate limit always does. Collapsing the two sends an operator to
    recheck a key that was correct.
    """

    def _textless(self) -> bytes:
        return TestVisionFallbackSuite._textless_pdf()

    @staticmethod
    def _client(statuses, captured=None):
        """httpx.AsyncClient stub returning the given status codes in order."""
        seq = list(statuses)

        class FakeResponse:
            def __init__(self, status, headers):
                self.status_code = status
                self.headers = headers

            def raise_for_status(self):
                if self.status_code >= 400:
                    raise RuntimeError(f"HTTP {self.status_code}")

            def json(self):
                return {"choices": [{"message": {"content": "[]"}}]}

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def post(self, url, **kwargs):
                status, headers = seq.pop(0)
                if captured is not None:
                    captured.append(status)
                return FakeResponse(status, headers)

        return lambda **kw: FakeClient()

    @pytest.mark.asyncio
    async def test_a_429_is_retried_and_then_succeeds(self, monkeypatch):
        seen: list[int] = []
        monkeypatch.setattr(settings, "groq_api_key", "k")
        monkeypatch.setattr(
            pdf_ingest.httpx, "AsyncClient",
            self._client([(429, {"retry-after": "0"}), (200, {})], seen),
        )

        assert await pdf_ingest._groq_chat([{"type": "text", "text": "x"}], 5.0) == "[]"
        assert seen == [429, 200], "must retry rather than surface the first 429"

    @pytest.mark.asyncio
    async def test_sustained_429_raises_rate_limited_not_a_generic_error(self, monkeypatch):
        monkeypatch.setattr(settings, "groq_api_key", "k")
        monkeypatch.setattr(
            pdf_ingest.httpx, "AsyncClient",
            self._client([(429, {"retry-after": "0"})] * pdf_ingest._GROQ_RETRY_ATTEMPTS),
        )

        with pytest.raises(pdf_ingest.RateLimited):
            await pdf_ingest._groq_chat([{"type": "text", "text": "x"}], 5.0)

    @pytest.mark.asyncio
    async def test_retry_wait_is_capped(self, monkeypatch):
        """A daily quota window must not hold a worker open."""
        waits: list[float] = []

        async def fake_sleep(seconds):
            waits.append(seconds)

        monkeypatch.setattr(settings, "groq_api_key", "k")
        monkeypatch.setattr(pdf_ingest.asyncio, "sleep", fake_sleep)
        monkeypatch.setattr(
            pdf_ingest.httpx, "AsyncClient",
            self._client([(429, {"retry-after": "86400"})] * pdf_ingest._GROQ_RETRY_ATTEMPTS),
        )

        with pytest.raises(pdf_ingest.RateLimited):
            await pdf_ingest._groq_chat([{"type": "text", "text": "x"}], 5.0)

        assert waits, "a retry must have waited"
        assert max(waits) <= pdf_ingest._GROQ_MAX_RETRY_WAIT

    @pytest.mark.asyncio
    async def test_throttling_is_reported_distinctly_from_a_failed_call(self, monkeypatch):
        async def throttled(prompt, images):
            raise pdf_ingest.RateLimited("429")

        monkeypatch.setattr(settings, "gemini_api_key", "")
        monkeypatch.setattr(settings, "groq_api_key", "k")
        monkeypatch.setattr(pdf_ingest, "_call_groq_vision", throttled)

        vehicles, engine = await pdf_ingest.extract_vehicles("", source=self._textless())

        assert vehicles == []
        # Not "vision-call-failed": that would send an operator to check a key
        # that was never the problem.
        assert engine == "vision-rate-limited"

    @pytest.mark.asyncio
    async def test_a_throttled_batch_keeps_what_earlier_batches_read(self, monkeypatch):
        """Half a variant grid beats an empty review queue."""
        calls = {"n": 0}

        async def chat(content, timeout):
            calls["n"] += 1
            if calls["n"] == 1:
                return json.dumps([{"make": "Maruti Suzuki", "model": "Dzire", "confidence": 0.6}])
            raise pdf_ingest.RateLimited("429")

        monkeypatch.setattr(settings, "groq_api_key", "k")
        monkeypatch.setattr(settings, "groq_max_images_per_request", 5)
        monkeypatch.setattr(pdf_ingest, "_groq_chat", chat)

        raw = await pdf_ingest._call_groq_vision("prompt", [b"png"] * 8)

        assert [v["model"] for v in json.loads(raw)] == ["Dzire"]
        assert calls["n"] == 2, "must stop at the throttle, not grind through later batches"
