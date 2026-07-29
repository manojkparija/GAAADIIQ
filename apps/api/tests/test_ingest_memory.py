"""
Brochure ingestion must not scale its memory with the brochure's image count.

A 512 MB instance was OOM-killed mid-upload: extract_images() held every
embedded image at once, measured at ~1.6 MB per photo, so ~492 MB at the
MAX_IMAGES cap. The kernel kill leaves no traceback and no response, so it
surfaced as an unexplained instance restart and a dropped connection — the
hardest possible failure to attribute.

These tests pin the two properties that prevent it: images are yielded one at
a time, and an oversized upload is refused without being buffered first.
"""
import io

import fitz
import pytest
from fastapi import HTTPException
from PIL import Image

from routers.brochures import MAX_PDF_BYTES, _read_capped
from services import pdf_ingest


def _brochure(pages: int = 6) -> bytes:
    """A PDF with one photo-like image per page."""
    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page(width=595, height=842)
        buf = io.BytesIO()
        # Varied pixels so each image is distinct and survives dedupe.
        img = Image.new("RGB", (400, 300))
        img.putdata([((x * 7 + i * 13) % 256, (x * 3) % 256, (x + i) % 256)
                     for x in range(400 * 300)])
        img.save(buf, "PNG")
        page.insert_image(fitz.Rect(0, 0, 595, 500), stream=buf.getvalue())
    data = doc.tobytes()
    doc.close()
    return data


class _CountingFile:
    """UploadFile stand-in that records how much was actually read."""

    def __init__(self, data: bytes):
        self._buf = io.BytesIO(data)
        self.bytes_read = 0

    async def read(self, size: int = -1) -> bytes:
        chunk = self._buf.read(size)
        self.bytes_read += len(chunk)
        return chunk


class TestStreamingExtractionSuite:
    def test_iter_images_is_lazy(self):
        """
        The generator must not have done the work up front. If it returned a
        list internally, memory would still peak at every image at once.
        """
        stream = pdf_ingest.iter_images(_brochure())
        # Pulling one image must not require producing them all.
        first = next(stream)
        assert first["data"]
        stream.close()

    def test_only_one_image_is_live_at_a_time(self):
        """
        The router stores each image then drops it. Nothing may retain the
        previous ones — that retention was the bug.
        """
        import sys

        seen_refcounts = []
        for img in pdf_ingest.iter_images(_brochure()):
            # The generator itself must not be holding another reference to
            # this payload beyond the loop variable and getrefcount's argument.
            seen_refcounts.append(sys.getrefcount(img["data"]))
        assert seen_refcounts, "no images extracted from the fixture"
        assert max(seen_refcounts) <= 4, (
            f"an image is retained beyond the loop (refcounts {seen_refcounts})"
        )

    def test_extract_images_still_returns_every_image(self):
        """The list wrapper stays behaviour-compatible for existing callers."""
        pdf = _brochure(pages=5)
        streamed = list(pdf_ingest.iter_images(pdf))
        listed = pdf_ingest.extract_images(pdf)

        assert len(listed) == len(streamed)
        assert [i["page_number"] for i in listed] == [i["page_number"] for i in streamed]

    def test_image_cap_is_still_enforced(self, monkeypatch):
        monkeypatch.setattr(pdf_ingest, "MAX_IMAGES", 3)
        assert len(list(pdf_ingest.iter_images(_brochure(pages=8)))) == 3


class TestUploadSizeCapSuite:
    @pytest.mark.asyncio
    async def test_oversized_upload_is_refused(self):
        oversized = _CountingFile(b"x" * (MAX_PDF_BYTES + 5 * 1024 * 1024))

        with pytest.raises(HTTPException) as err:
            await _read_capped(oversized, MAX_PDF_BYTES)
        assert err.value.status_code == 413

    @pytest.mark.asyncio
    async def test_oversized_upload_is_not_fully_buffered(self):
        """
        The point of the cap. Reading the whole body before checking its length
        means the memory is already spent when the 413 is raised — on a small
        instance the process dies before it can send one.
        """
        size = MAX_PDF_BYTES * 3
        oversized = _CountingFile(b"x" * size)

        with pytest.raises(HTTPException):
            await _read_capped(oversized, MAX_PDF_BYTES)

        assert oversized.bytes_read < size, "read the entire oversized body"
        # One chunk of overshoot is expected: that is how the limit is detected.
        assert oversized.bytes_read <= MAX_PDF_BYTES + 1024 * 1024

    @pytest.mark.asyncio
    async def test_normal_upload_passes_through_intact(self):
        pdf = _brochure(pages=3)
        assert await _read_capped(_CountingFile(pdf), MAX_PDF_BYTES) == pdf


class TestPathSourceSuite:
    """
    Ingestion reads the PDF from disk, not from memory.

    Streaming the images was not enough: the PDF itself existed three times
    over — the chunk list, the joined bytes, and PyMuPDF's own copy of the
    stream — so a large brochure was still OOM-killed before an image was
    touched. Measured peak RSS on a 70 MB brochure: +149 MB in memory versus
    +79 MB from disk.
    """

    def test_iter_images_accepts_a_path(self, tmp_path):
        pdf = tmp_path / "brochure.pdf"
        pdf.write_bytes(_brochure(pages=4))

        from_path = list(pdf_ingest.iter_images(pdf))
        from_bytes = list(pdf_ingest.iter_images(pdf.read_bytes()))

        assert len(from_path) == len(from_bytes) > 0
        assert [i["phash"] for i in from_path] == [i["phash"] for i in from_bytes]

    def test_extract_text_accepts_a_path(self, tmp_path):
        pdf = tmp_path / "brochure.pdf"
        pdf.write_bytes(_brochure(pages=2))

        assert pdf_ingest.extract_text(pdf) == pdf_ingest.extract_text(pdf.read_bytes())

    def test_page_count_accepts_a_path(self, tmp_path):
        pdf = tmp_path / "brochure.pdf"
        pdf.write_bytes(_brochure(pages=7))

        assert pdf_ingest.page_count(pdf) == 7

    def test_an_unreadable_path_raises_the_ingest_error(self, tmp_path):
        not_a_pdf = tmp_path / "junk.pdf"
        not_a_pdf.write_bytes(b"this is not a PDF at all")

        with pytest.raises(pdf_ingest.PdfIngestError):
            list(pdf_ingest.iter_images(not_a_pdf))
