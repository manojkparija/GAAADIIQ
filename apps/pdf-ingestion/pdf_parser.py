"""
Document parsing pipeline.

Primary: Docling (layout-aware, handles complex brochure layouts, scanned pages).
Fallback: PyMuPDF + pdfplumber (reliable, zero extra deps beyond what's installed).

Image extraction strategy (both paths):
  1. Embedded images via PyMuPDF — high fidelity for digitally-created PDFs.
  2. Full-page renders at 300 DPI — captures images that are part of the page
     canvas (common in automobile brochures that use full-bleed photography).
  3. pHash dedup — removes exact/near-duplicate images within the document.
  4. Minimum dimensions filter (100×100 px) instead of byte size to avoid
     discarding small-but-valid images stored with high compression.
"""

from __future__ import annotations
import hashlib
import io
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ── Data classes (unchanged interface) ───────────────────────────────────────

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
    tables: list[list[list[str]]]
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


# ── Helpers ───────────────────────────────────────────────────────────────────

def _phash_bytes(data: bytes) -> str:
    """8×8 greyscale perceptual hash — fast near-duplicate detection."""
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(data)).convert("L").resize((8, 8), Image.LANCZOS)
        avg = sum(img.getdata()) / 64
        bits = "".join("1" if p >= avg else "0" for p in img.getdata())
        return f"{int(bits, 2):016x}"
    except Exception:
        return hashlib.md5(data[:512]).hexdigest()


def _hamming(h1: str, h2: str) -> int:
    try:
        return bin(int(h1, 16) ^ int(h2, 16)).count("1")
    except Exception:
        return 64


def _dedup(images: list[PageImage], max_hamming: int = 6) -> list[PageImage]:
    """Remove near-duplicate images (Hamming distance ≤ max_hamming on pHash)."""
    kept: list[PageImage] = []
    kept_hashes: list[str] = []
    for img in images:
        ph = _phash_bytes(img.data)
        if any(_hamming(ph, h) <= max_hamming for h in kept_hashes):
            logger.debug(f"pHash dedup — skipping duplicate on page {img.page_num}")
            continue
        kept.append(img)
        kept_hashes.append(ph)
    return kept


def _pixel_dims(data: bytes) -> tuple[int, int]:
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(data))
        return img.width, img.height
    except Exception:
        return 0, 0


MIN_PX = 100   # minimum width AND height in pixels


# ── Main parser ───────────────────────────────────────────────────────────────

class PdfParser:
    """
    Parses any document format (PDF, images, office files) for vehicle data extraction.
    Tries Docling first for layout intelligence; falls back to PyMuPDF + pdfplumber.
    """

    OCR_DPI = 300

    def parse(self, file_path: Path) -> ParsedDocument:
        suffix = file_path.suffix.lower()

        # Non-PDF image files: wrap as single-page image document
        if suffix in (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif"):
            return self._parse_image_file(file_path)

        # Try Docling for rich layout understanding
        try:
            return self._parse_with_docling(file_path)
        except ImportError:
            logger.info("Docling not installed — using PyMuPDF fallback")
        except Exception as e:
            logger.warning(f"Docling failed ({e}) — falling back to PyMuPDF")

        return self._parse_with_pymupdf(file_path)

    # ── Image file (single page) ─────────────────────────────────────────────

    def _parse_image_file(self, file_path: Path) -> ParsedDocument:
        data = file_path.read_bytes()
        ext = file_path.suffix.lstrip(".")
        w, h = _pixel_dims(data)
        text = self._ocr_bytes(data)
        doc = ParsedDocument(filename=file_path.name)
        doc.pages.append(ParsedPage(
            page_num=1, text=text, tables=[],
            images=[PageImage(data=data, ext=ext, page_num=1, width=w, height=h)],
            is_scanned=True,
        ))
        return doc

    # ── Docling path ─────────────────────────────────────────────────────────

    def _parse_with_docling(self, file_path: Path) -> ParsedDocument:
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.datamodel.base_models import InputFormat

        opts = PdfPipelineOptions()
        opts.do_ocr = True
        opts.do_table_structure = True
        opts.images_scale = 2.0                 # 2× resolution for pictures
        opts.generate_picture_images = True

        converter = DocumentConverter(
            format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)}
        )

        result = converter.convert(str(file_path))
        docling_doc = result.document

        # Collect text + tables per page from Docling
        page_texts: dict[int, list[str]] = {}
        page_tables: dict[int, list] = {}
        page_picture_images: dict[int, list[PageImage]] = {}

        for item, _ in docling_doc.iterate_items():
            page_no = (item.prov[0].page_no if item.prov else 1)

            # Text
            text_val = getattr(item, "text", None)
            if text_val:
                page_texts.setdefault(page_no, []).append(text_val)

            # Tables
            if type(item).__name__ == "TableItem":
                try:
                    df = item.export_to_dataframe()
                    rows = [df.columns.tolist()] + df.values.tolist()
                    page_tables.setdefault(page_no, []).append(rows)
                except Exception:
                    pass

            # Pictures (Docling-cropped high-res)
            if type(item).__name__ == "PictureItem":
                try:
                    pil_img = item.get_image(docling_doc)
                    if pil_img and pil_img.width >= MIN_PX and pil_img.height >= MIN_PX:
                        buf = io.BytesIO()
                        pil_img.save(buf, format="PNG")
                        page_picture_images.setdefault(page_no, []).append(PageImage(
                            data=buf.getvalue(), ext="png", page_num=page_no,
                            width=pil_img.width, height=pil_img.height,
                        ))
                except Exception as e:
                    logger.debug(f"Docling picture extract failed: {e}")

        # Supplement with PyMuPDF embedded images (higher fidelity for embedded)
        try:
            pymupdf_images = self._extract_all_images_pymupdf(file_path)
        except Exception as e:
            logger.warning(f"PyMuPDF image extraction failed: {e}")
            pymupdf_images = {}

        all_pages = sorted(
            set(list(page_texts.keys()) + list(page_picture_images.keys()) + list(pymupdf_images.keys()))
        )
        if not all_pages:
            all_pages = [1]

        doc = ParsedDocument(filename=file_path.name)
        for page_no in all_pages:
            text = "\n".join(page_texts.get(page_no, []))
            tables = page_tables.get(page_no, [])
            imgs = page_picture_images.get(page_no, []) + pymupdf_images.get(page_no, [])
            imgs = _dedup(imgs)
            doc.pages.append(ParsedPage(
                page_num=page_no, text=text, tables=tables, images=imgs,
                is_scanned=len(text.strip()) < 50,
            ))
            logger.info(f"Page {page_no}: {len(text)} chars text, {len(imgs)} images (Docling)")

        return doc

    # ── PyMuPDF path ─────────────────────────────────────────────────────────

    def _parse_with_pymupdf(self, file_path: Path) -> ParsedDocument:
        import fitz
        import pdfplumber

        doc = ParsedDocument(filename=file_path.name)
        fitz_doc = fitz.open(str(file_path))

        with pdfplumber.open(str(file_path)) as plumber:
            for page_num, (plumber_page, fitz_page) in enumerate(
                zip(plumber.pages, fitz_doc), start=1
            ):
                text = self._extract_text(plumber_page)
                tables = self._extract_tables(plumber_page)
                is_scanned = len(text.strip()) < 50

                if is_scanned:
                    text = self._ocr_fitz_page(fitz_page)

                images = self._extract_images_fitz(fitz_page, fitz_doc, page_num)

                # If page has very few embedded images but is clearly a brochure
                # page (image-heavy layout), render the full page as fallback
                if len(images) == 0 and not is_scanned:
                    rendered = self._render_page(fitz_page, page_num)
                    if rendered:
                        images = [rendered]

                images = _dedup(images)
                doc.pages.append(ParsedPage(
                    page_num=page_num, text=text, tables=tables,
                    images=images, is_scanned=is_scanned,
                ))
                logger.info(
                    f"Page {page_num}: {'scanned' if is_scanned else 'digital'}, "
                    f"{len(text)} chars, {len(images)} images"
                )

        fitz_doc.close()
        return doc

    # ── Shared helpers ────────────────────────────────────────────────────────

    def _extract_all_images_pymupdf(self, file_path: Path) -> dict[int, list[PageImage]]:
        """Return {page_num: [PageImage]} for all embedded images in the PDF."""
        import fitz
        result: dict[int, list[PageImage]] = {}
        fitz_doc = fitz.open(str(file_path))
        try:
            for fitz_page in fitz_doc:
                page_num = fitz_page.number + 1
                imgs = self._extract_images_fitz(fitz_page, fitz_doc, page_num)
                if imgs:
                    result[page_num] = imgs
        finally:
            fitz_doc.close()
        return result

    def _extract_images_fitz(self, fitz_page, fitz_doc, page_num: int) -> list[PageImage]:
        images: list[PageImage] = []
        try:
            import fitz
            for img_info in fitz_page.get_images(full=True):
                xref = img_info[0]
                img_dict = fitz_doc.extract_image(xref)
                if not img_dict:
                    continue
                data = img_dict["image"]
                ext = img_dict.get("ext", "png")

                # Filter by pixel dimensions instead of byte size
                w, h = _pixel_dims(data)
                if w < MIN_PX or h < MIN_PX:
                    continue

                rect = fitz.Rect(0, 0, 0, 0)
                for item in fitz_page.get_image_rects(xref):
                    rect = item
                    break

                images.append(PageImage(
                    data=data, ext=ext, page_num=page_num,
                    x=rect.x0, y=rect.y0,
                    width=w, height=h,
                ))
        except Exception as e:
            logger.warning(f"Embedded image extraction page {page_num}: {e}")
        return images

    def _render_page(self, fitz_page, page_num: int, dpi: int = 300) -> Optional[PageImage]:
        """Render full page to PNG — captures canvas-painted images."""
        try:
            import fitz
            mat = fitz.Matrix(dpi / 72, dpi / 72)
            pix = fitz_page.get_pixmap(matrix=mat, alpha=False)
            data = pix.tobytes("png")
            w, h = _pixel_dims(data)
            if w < MIN_PX or h < MIN_PX:
                return None
            return PageImage(data=data, ext="png", page_num=page_num, width=w, height=h)
        except Exception as e:
            logger.warning(f"Page render failed for page {page_num}: {e}")
            return None

    def _extract_text(self, plumber_page) -> str:
        try:
            return plumber_page.extract_text() or ""
        except Exception as e:
            logger.warning(f"Text extraction failed: {e}")
            return ""

    def _extract_tables(self, plumber_page) -> list[list[list[str]]]:
        try:
            raw = plumber_page.extract_tables() or []
            return [[[cell or "" for cell in row] for row in table] for table in raw]
        except Exception as e:
            logger.warning(f"Table extraction failed: {e}")
            return []

    def _ocr_fitz_page(self, fitz_page) -> str:
        try:
            import fitz
            mat = fitz.Matrix(self.OCR_DPI / 72, self.OCR_DPI / 72)
            pix = fitz_page.get_pixmap(matrix=mat)
            return self._ocr_bytes(pix.tobytes("png"))
        except Exception as e:
            logger.error(f"Page OCR failed: {e}")
            return ""

    def _ocr_bytes(self, img_bytes: bytes) -> str:
        """Run OCR on raw image bytes. Tries Tesseract first, then EasyOCR."""
        try:
            import pytesseract
            from PIL import Image
            return pytesseract.image_to_string(Image.open(io.BytesIO(img_bytes)), lang="eng")
        except ImportError:
            pass
        except Exception as e:
            logger.warning(f"Tesseract OCR failed: {e}")

        try:
            import easyocr
            import numpy as np
            from PIL import Image
            reader = easyocr.Reader(["en"], gpu=False, verbose=False)
            arr = np.array(Image.open(io.BytesIO(img_bytes)))
            results = reader.readtext(arr)
            return " ".join(r[1] for r in results)
        except Exception as e:
            logger.error(f"EasyOCR failed: {e}")
            return ""
