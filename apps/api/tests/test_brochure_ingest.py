"""
Brochure ingestion: PDF in, images and vehicle data out.

The PDFs here are built in-test rather than committed as binary fixtures, so
the inputs are reviewable and the suite carries no opaque blobs.
"""
import io
import uuid

import pytest

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
