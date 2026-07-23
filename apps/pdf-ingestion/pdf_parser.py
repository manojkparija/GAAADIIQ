"""PDF parsing: text extraction (digital + OCR) and image extraction."""

from __future__ import annotations
import io
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class PageImage:
    data: bytes
    ext: str          # "png" | "jpeg"
    page_num: int
    x: float = 0.0
    y: float = 0.0
    width: float = 0.0
    height: float = 0.0


@dataclass
class ParsedPage:
    page_num: int
    text: str
    tables: list[list[list[str]]]   # [table[row[cell]]]
    images: list[PageImage]
    is_scanned: bool = False


@dataclass
class ParsedDocument:
    filename: str
    pages: list[ParsedPage] = field(default_factory=list)

    @property
    def full_text(self) -> str:
        return "\n\n".join(p.text for p in self.pages)

    @property
    def all_images(self) -> list[PageImage]:
        return [img for page in self.pages for img in page.images]


class PdfParser:
    """
    Handles both digital and scanned PDFs.

    - Digital pages: pdfplumber for text + table extraction
    - Scanned pages: PyMuPDF renders at 300 DPI → Tesseract OCR
    - Images: PyMuPDF extracts all embedded images
    - Page type auto-detected: if extracted text < 50 chars → treat as scanned
    """

    SCANNED_THRESHOLD = 50  # chars of text below which page is treated as scanned
    OCR_DPI = 300

    def parse(self, pdf_path: Path) -> ParsedDocument:
        doc = ParsedDocument(filename=pdf_path.name)
        try:
            import pdfplumber
            import fitz  # PyMuPDF
        except ImportError as e:
            raise RuntimeError(f"Missing PDF library: {e}. Run: pip install pdfplumber PyMuPDF") from e

        fitz_doc = fitz.open(str(pdf_path))

        with pdfplumber.open(str(pdf_path)) as plumber_doc:
            for page_num, (plumber_page, fitz_page) in enumerate(
                zip(plumber_doc.pages, fitz_doc), start=1
            ):
                text   = self._extract_text(plumber_page)
                tables = self._extract_tables(plumber_page)
                images = self._extract_images(fitz_page, page_num)
                is_scanned = len(text.strip()) < self.SCANNED_THRESHOLD

                if is_scanned:
                    text = self._ocr_page(fitz_page)

                doc.pages.append(ParsedPage(
                    page_num=page_num,
                    text=text,
                    tables=tables,
                    images=images,
                    is_scanned=is_scanned,
                ))
                logger.debug(f"Page {page_num}: {'scanned' if is_scanned else 'digital'}, "
                             f"{len(text)} chars, {len(images)} images")

        fitz_doc.close()
        return doc

    def _extract_text(self, page) -> str:
        try:
            return page.extract_text() or ""
        except Exception as e:
            logger.warning(f"Text extraction failed: {e}")
            return ""

    def _extract_tables(self, page) -> list[list[list[str]]]:
        try:
            raw = page.extract_tables() or []
            return [
                [[cell or "" for cell in row] for row in table]
                for table in raw
            ]
        except Exception as e:
            logger.warning(f"Table extraction failed: {e}")
            return []

    def _extract_images(self, fitz_page, page_num: int) -> list[PageImage]:
        images: list[PageImage] = []
        try:
            import fitz
            doc = fitz_page.parent
            for img_info in fitz_page.get_images(full=True):
                xref = img_info[0]
                img_dict = doc.extract_image(xref)
                if not img_dict:
                    continue
                data = img_dict["image"]
                ext  = img_dict.get("ext", "png")

                # Skip tiny icons/logos (< 8 KB)
                if len(data) < 8_000:
                    continue

                # Get position on page
                rect = fitz.Rect(0, 0, 0, 0)
                for item in fitz_page.get_image_rects(xref):
                    rect = item
                    break

                images.append(PageImage(
                    data=data, ext=ext, page_num=page_num,
                    x=rect.x0, y=rect.y0,
                    width=rect.width, height=rect.height,
                ))
        except Exception as e:
            logger.warning(f"Image extraction page {page_num}: {e}")
        return images

    def _ocr_page(self, fitz_page) -> str:
        """Render page to image, run Tesseract OCR."""
        try:
            import fitz
            mat  = fitz.Matrix(self.OCR_DPI / 72, self.OCR_DPI / 72)
            pix  = fitz_page.get_pixmap(matrix=mat)
            img_bytes = pix.tobytes("png")

            try:
                import pytesseract
                from PIL import Image
                img = Image.open(io.BytesIO(img_bytes))
                return pytesseract.image_to_string(img, lang="eng")
            except ImportError:
                # Fallback: EasyOCR
                import easyocr
                import numpy as np
                from PIL import Image
                img = Image.open(io.BytesIO(img_bytes))
                reader = easyocr.Reader(["en"], gpu=False, verbose=False)
                results = reader.readtext(np.array(img))
                return " ".join(r[1] for r in results)
        except Exception as e:
            logger.error(f"OCR failed: {e}")
            return ""
