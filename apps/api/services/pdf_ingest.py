"""
Read a car brochure PDF: pull out the images, and extract the vehicle data.

Two halves, kept separate because they fail independently:

  extract_images()   — PyMuPDF, deterministic, no network. Works offline.
  extract_vehicles() — an LLM reading the brochure. Needs a model. Reads the
                       text layer when there is one, and falls back to showing
                       Gemini the rendered pages when there is not — which is
                       the common case for manufacturer brochures, whose words
                       are printed into the artwork.

If the LLM is unavailable the images are still extracted and stored. That
matters: images are the expensive, hard-to-replace part of a brochure, and
losing them because a model was offline would be the wrong trade.

Model choice follows the same tiering as diagnosis — Gemini Flash when a key is
configured (much better at reading messy brochure tables), otherwise the
self-hosted Ollama model. Both are optional.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import logging
import os
import re
import uuid
from collections.abc import Iterator

import httpx

from core.config import settings

logger = logging.getLogger("gaadiiq.pdf_ingest")

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_INGEST_MODEL", "llama3")
INGEST_TIMEOUT = float(os.getenv("PDF_INGEST_TIMEOUT", "60"))

# Reading pages as images costs more tokens and more time than reading text, so
# it is bounded: the first few pages of a brochure carry the model, variant and
# price tables, and sending forty pages of lifestyle photography would spend a
# lot to learn nothing. Raise VISION_MAX_PAGES for a full catalogue.
VISION_MAX_PAGES = int(os.getenv("PDF_VISION_MAX_PAGES", "8"))
VISION_DPI = int(os.getenv("PDF_VISION_DPI", "120"))
VISION_TIMEOUT = float(os.getenv("PDF_VISION_TIMEOUT", "180"))

# Brochures are image-heavy, and we want the photographs rather than the
# bullets, rules and logo fragments.
#
# Filtering is by PIXEL DIMENSIONS, not file size. Byte size is a bad proxy:
# a flat-colour illustration or a colour swatch compresses to a few kilobytes
# while still being real content, and an 8 KB threshold silently dropped every
# image from a real two-page brochure during testing. The byte floor that
# remains is only there to skip 1×1 spacers and tiny icons.
MIN_IMAGE_BYTES = 1_200
MIN_IMAGE_EDGE = 100
MIN_IMAGE_PIXELS = 20_000  # ~140x140; below this it is an icon, not a photo

# Guards against a hostile or malformed upload exhausting memory or disk.
#
# Tunable because a full manufacturer catalogue is a different animal from a
# single-model brochure: 266 MB and several hundred pages is normal for one,
# and the defaults below would silently ingest a fraction of it. Exceeding
# either cap is logged rather than passed over in silence — a job reporting
# fewer images than the brochure contains, with no explanation, is the kind of
# quiet truncation that gets mistaken for a parser that simply found nothing.
MAX_PAGES = int(os.getenv("PDF_MAX_PAGES", "600"))
MAX_IMAGES = int(os.getenv("PDF_MAX_IMAGES", "1000"))
MAX_TEXT_CHARS = 60_000


class PdfIngestError(RuntimeError):
    """The PDF could not be read at all."""


PdfSource = "bytes | str | os.PathLike"


def _open_pdf(source):
    """
    Open a PDF held either in memory or on disk.

    A path is strongly preferred for uploads: fitz.open(stream=...) keeps its
    own copy of the bytes, so passing a 40 MB brochure through memory costs 40
    MB for the caller's copy plus 40 MB inside PyMuPDF. Opening by path lets it
    read from the file instead, which is the difference between fitting in a
    small instance and being OOM-killed.
    """
    try:
        import fitz  # PyMuPDF
    except ImportError as exc:  # pragma: no cover - deployment dependent
        raise PdfIngestError("PyMuPDF is required to read PDFs") from exc

    try:
        if isinstance(source, bytes | bytearray):
            return fitz.open(stream=bytes(source), filetype="pdf")
        return fitz.open(str(source))
    except Exception as exc:
        raise PdfIngestError(f"Could not open PDF: {exc}") from exc


def extract_images(pdf_bytes: bytes) -> list[dict]:
    """
    Every embedded raster image, materialised as a list.

    MEMORY WARNING: this holds every image at once. At MAX_IMAGES that is
    hundreds of megabytes — measured at ~1.6 MB per photo on a real brochure,
    so ~492 MB at the cap, which exceeds a small instance's entire allowance
    and gets the process OOM-killed mid-request. The kill leaves no traceback,
    so it surfaces as an unexplained restart.

    Prefer iter_images() in request handlers, which yields one image at a time
    and lets each be stored and freed. This wrapper remains for tests and for
    callers working with small, known-size PDFs.
    """
    return list(iter_images(pdf_bytes))


def iter_images(pdf_bytes: bytes) -> Iterator[dict]:
    """
    Pull every embedded raster image out of the PDF, one at a time.

    Yields dicts with the raw bytes plus enough metadata to store them:
    page number, dimensions, content type, and a perceptual-ish hash used to
    drop duplicates (brochures repeat the same hero shot on many pages).

    Streaming rather than returning a list keeps peak memory at roughly one
    image regardless of how many the brochure contains — the caller writes each
    to storage and drops it before the next arrives.
    """
    doc = _open_pdf(pdf_bytes)

    yielded = 0
    seen: set[str] = set()

    if doc.page_count > MAX_PAGES:
        logger.warning(
            "PDF has %d pages; only the first %d will be read. Raise "
            "PDF_MAX_PAGES to ingest the rest.",
            doc.page_count,
            MAX_PAGES,
        )

    try:
        for page_index in range(min(doc.page_count, MAX_PAGES)):
            if yielded >= MAX_IMAGES:
                logger.warning("Image cap %d reached; ignoring the rest", MAX_IMAGES)
                break
            page = doc[page_index]
            for info in page.get_images(full=True):
                xref = info[0]
                try:
                    raw = doc.extract_image(xref)
                except Exception:
                    continue  # a single unreadable image must not fail the job

                data = raw.get("image") or b""
                width, height = raw.get("width", 0) or 0, raw.get("height", 0) or 0
                if len(data) < MIN_IMAGE_BYTES:
                    continue
                if min(width, height) < MIN_IMAGE_EDGE:
                    continue
                if width * height < MIN_IMAGE_PIXELS:
                    continue

                # Exact-duplicate suppression. A content hash catches the same
                # embedded object reused across pages, which is the common case.
                digest = hashlib.sha256(data).hexdigest()
                if digest in seen:
                    continue
                seen.add(digest)

                yield {
                    "data": data,
                    "ext": (raw.get("ext") or "png").lower(),
                    "content_type": f"image/{(raw.get('ext') or 'png').lower()}",
                    "width": raw.get("width"),
                    "height": raw.get("height"),
                    "page_number": page_index + 1,
                    "phash": digest[:32],
                }
                yielded += 1
                if yielded >= MAX_IMAGES:
                    logger.warning("Image cap %d reached; ignoring the rest", MAX_IMAGES)
                    break
    finally:
        doc.close()


def extract_text(pdf_bytes: bytes) -> str:
    """Concatenated page text, truncated so a huge catalogue cannot blow the prompt."""
    doc = _open_pdf(pdf_bytes)

    parts: list[str] = []
    try:
        for i in range(min(doc.page_count, MAX_PAGES)):
            parts.append(doc[i].get_text())
            if sum(len(p) for p in parts) > MAX_TEXT_CHARS:
                break
    finally:
        doc.close()

    return "\n".join(parts)[:MAX_TEXT_CHARS]


def page_count(pdf_bytes: bytes) -> int:
    try:
        doc = _open_pdf(pdf_bytes)
        try:
            return doc.page_count
        finally:
            doc.close()
    except Exception:
        return 0


_PROMPT = """You are reading an Indian car manufacturer's brochure.

Extract every distinct vehicle variant described in the text below. Return ONLY
a JSON array — no prose, no markdown fences — where each element is:

{{
  "make": "manufacturer name or null",
  "model": "model name or null",
  "variant": "trim/variant name or null",
  "model_year": 2025 or null,
  "price_inr": ex-showroom price as an integer number of rupees, or null,
  "fuel_type": "Petrol|Diesel|CNG|Electric|Hybrid or null",
  "transmission": "Manual|Automatic|AMT|CVT|DCT or null",
  "body_type": "Hatchback|Sedan|SUV|MUV or null",
  "colours": ["colour name", ...],
  "features": ["feature", ...],
  "specs": {{"Mileage": "24.8 kmpl", "Power": "81 bhp"}},
  "confidence": 0.0 to 1.0
}}

Rules:
- Prices in the text may be written as "6.49 Lakh" or "₹6,49,000" — convert
  both to a plain integer of rupees (649000).
- Never invent a value. Use null when the brochure does not state it.
- confidence reflects how clearly the brochure stated that variant.

BROCHURE TEXT:
{text}
"""


# Same schema, but the brochure arrives as page images. Kept separate from
# _PROMPT rather than parameterised: the instructions differ in kind — colours
# have to be read off swatches, and specification tables have to be read as
# tables rather than as a run of words — and merging them would make both
# vaguer.
_VISION_PROMPT = """You are reading the attached pages of an Indian car
manufacturer's brochure. The pages are images; read the text printed in them.

Extract every distinct vehicle variant shown. Return ONLY a JSON array — no
prose, no markdown fences — where each element is:

{
  "make": "manufacturer name or null",
  "model": "model name or null",
  "variant": "trim/variant name or null",
  "model_year": 2025 or null,
  "price_inr": ex-showroom price as an integer number of rupees, or null,
  "fuel_type": "Petrol|Diesel|CNG|Electric|Hybrid or null",
  "transmission": "Manual|Automatic|AMT|CVT|DCT or null",
  "body_type": "Hatchback|Sedan|SUV|MUV or null",
  "colours": ["colour name", ...],
  "features": ["feature", ...],
  "specs": {"Mileage": "24.8 kmpl", "Power": "81 bhp"},
  "confidence": 0.0 to 1.0
}

Rules:
- Read specification tables column by column: a variant grid lists one column
  per variant, and the values in a column all belong to that variant.
- Colour names are usually printed beneath colour swatches — list them under
  the model they belong to.
- Prices may be printed as "6.49 Lakh" or "Rs 6,49,000" — convert both to a
  plain integer of rupees (649000).
- Never invent a value. Use null when the pages do not show it.
- If the pages show one model in several trims, return one element per trim.
- confidence reflects how clearly the page stated that variant.
"""


async def _call_gemini(prompt: str, images: list[bytes] | None = None) -> str:
    """
    Ask Gemini Flash, optionally showing it page images as well as text.

    The image path exists because manufacturer brochures are frequently laid
    out as artwork with no text layer at all — a real Dzire brochure yielded
    zero characters — so a text-only request has nothing to work with however
    well the model is configured.
    """
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.0-flash:generateContent?key={settings.gemini_api_key}"
    )
    parts: list[dict] = [{"text": prompt}]
    for png in images or []:
        parts.append({
            "inline_data": {
                "mime_type": "image/png",
                "data": base64.b64encode(png).decode("ascii"),
            }
        })

    async with httpx.AsyncClient(timeout=VISION_TIMEOUT if images else INGEST_TIMEOUT) as client:
        resp = await client.post(
            url,
            json={
                "contents": [{"parts": parts}],
                "generationConfig": {"temperature": 0.1, "maxOutputTokens": 8192},
            },
        )
        resp.raise_for_status()
        data = resp.json()
    return data["candidates"][0]["content"]["parts"][0]["text"]


def render_pages(source, max_pages: int = VISION_MAX_PAGES, dpi: int = VISION_DPI) -> list[bytes]:
    """
    Render the first pages to PNGs, for a model to read as pictures.

    Rendered rather than reusing the embedded photographs: the words live in
    the page artwork, and an embedded image is only part of a page. The DPI is
    a compromise — high enough for a model to read specification tables, low
    enough that several pages fit in one request without exhausting memory on
    a small instance.
    """
    doc = _open_pdf(source)
    out: list[bytes] = []
    try:
        for index in range(min(doc.page_count, max_pages)):
            try:
                pix = doc[index].get_pixmap(dpi=dpi)
                out.append(pix.tobytes("png"))
                del pix
            except Exception as exc:  # one bad page must not lose the rest
                logger.warning("Could not render page %d: %s", index + 1, exc)
    finally:
        doc.close()
    return out


async def _call_ollama(prompt: str) -> str:
    async with httpx.AsyncClient(timeout=INGEST_TIMEOUT) as client:
        resp = await client.post(
            f"{OLLAMA_BASE_URL}/api/generate",
            json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False, "format": "json"},
        )
        resp.raise_for_status()
        return resp.json().get("response", "")


def _parse_vehicles(raw: str) -> list[dict]:
    """
    Pull the JSON array out of a model response.

    Models wrap JSON in prose or fences no matter how firmly they are asked not
    to, so the array is located rather than assumed to be the whole reply.
    """
    text = (raw or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text).strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\[.*\]", text, re.DOTALL)
        if not match:
            return []
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            return []

    # Some models answer with {"vehicles": [...]} despite the instruction.
    if isinstance(parsed, dict):
        for key in ("vehicles", "results", "data", "items"):
            if isinstance(parsed.get(key), list):
                parsed = parsed[key]
                break
        else:
            parsed = [parsed]

    return [v for v in parsed if isinstance(v, dict)] if isinstance(parsed, list) else []


_LAKH = re.compile(r"([\d.]+)\s*(lakh|lac)", re.I)


def _coerce_price(value) -> int | None:
    """
    Normalise a price to whole rupees.

    Brochures write "6.49 Lakh", "₹6,49,000" and "649000" interchangeably, and
    models echo whichever form they saw — so a bare 6.49 must not be stored as
    six rupees.
    """
    if value is None:
        return None
    if isinstance(value, (int, float)):
        n = float(value)
        # A "price" under a thousand is a lakh figure the model failed to expand.
        return int(n * 100_000) if n < 1000 else int(n)
    text = str(value)
    lakh = _LAKH.search(text)
    if lakh:
        try:
            return int(float(lakh.group(1)) * 100_000)
        except ValueError:
            return None
    digits = re.sub(r"[^\d]", "", text)
    if not digits:
        return None
    n = int(digits)
    return n * 100_000 if n < 1000 else n


def _clean(vehicles: list[dict]) -> list[dict]:
    out = []
    for v in vehicles:
        if not isinstance(v, dict):
            continue
        # A row with neither make nor model tells us nothing and would only
        # clutter the review queue.
        if not (v.get("make") or v.get("model")):
            continue
        try:
            confidence = float(v.get("confidence") or 0.0)
        except (TypeError, ValueError):
            confidence = 0.0
        out.append({
            "make": (v.get("make") or None),
            "model": (v.get("model") or None),
            "variant": (v.get("variant") or None),
            "model_year": v.get("model_year") if isinstance(v.get("model_year"), int) else None,
            "price_inr": _coerce_price(v.get("price_inr")),
            "fuel_type": (v.get("fuel_type") or None),
            "transmission": (v.get("transmission") or None),
            "body_type": (v.get("body_type") or None),
            "colours": v.get("colours") if isinstance(v.get("colours"), list) else [],
            "features": v.get("features") if isinstance(v.get("features"), list) else [],
            "specs": v.get("specs") if isinstance(v.get("specs"), dict) else {},
            "confidence": max(0.0, min(1.0, confidence)),
        })
    return out


async def extract_vehicles(text: str, source=None) -> tuple[list[dict], str]:
    """
    Ask a model what vehicles the brochure describes.

    Returns (vehicles, engine_name). Never raises: image extraction has already
    succeeded by this point, and an offline model must not discard that work.
    engine is "none" when nothing could run.

    When the PDF has no text layer, `source` (a path or bytes) lets the pages be
    rendered and shown to Gemini as pictures instead. Manufacturer brochures are
    routinely built this way — a real Dzire brochure yielded zero characters —
    so without this the whole feature returns nothing for exactly the documents
    it exists to read. Ollama is not offered the image path: the default model
    is text-only, and llava would have to be pulled first.
    """
    has_text = bool(text.strip())

    if not has_text and source is not None and settings.gemini_api_key:
        try:
            pages = await asyncio.to_thread(render_pages, source)
            if pages:
                logger.info("No text layer; reading %d rendered pages with Gemini", len(pages))
                raw = await _call_gemini(_VISION_PROMPT, images=pages)
                return _clean(_parse_vehicles(raw)), "gemini-vision"
        except Exception as exc:
            logger.warning("Gemini vision extraction failed: %s", exc)
            return [], "none"

    if not has_text:
        return [], "none"

    prompt = _PROMPT.format(text=text)

    if settings.gemini_api_key:
        try:
            return _clean(_parse_vehicles(await _call_gemini(prompt))), "gemini"
        except Exception as exc:
            logger.warning("Gemini extraction failed, trying Ollama: %s", exc)

    try:
        return _clean(_parse_vehicles(await _call_ollama(prompt))), "ollama"
    except Exception as exc:
        logger.warning("Ollama extraction failed: %s", exc)
        return [], "none"


def build_key(job_id: uuid.UUID, index: int, ext: str) -> str:
    """
    Storage key for one extracted image.

    Grouped by job so everything from one brochure can be found — or removed —
    together, and so a local folder stays browsable by a human.
    """
    safe_ext = re.sub(r"[^a-z0-9]", "", (ext or "png").lower()) or "png"
    return f"brochures/{job_id}/{index:03d}.{safe_ext}"


def sniff_image(data: bytes) -> tuple[str, str] | None:
    """
    Identify an image from its magic bytes.

    The extension a PDF reports is not trustworthy, and storing a mislabelled
    content type means browsers refuse to render the image.
    """
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png", "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg", "image/jpeg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif", "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", "image/webp"
    return None


def is_pdf(data: bytes) -> bool:
    """A real PDF starts with %PDF-. Trusting the filename is how you get shells."""
    return data[:5] == b"%PDF-"


def image_dimensions(data: bytes) -> tuple[int | None, int | None]:
    try:
        from PIL import Image
        with Image.open(io.BytesIO(data)) as img:
            return img.size
    except Exception:
        return None, None
