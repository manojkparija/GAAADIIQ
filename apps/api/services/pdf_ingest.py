"""
Read a car brochure PDF: pull out the images, and extract the vehicle data.

Two halves, kept separate because they fail independently:

  extract_images()   — PyMuPDF, deterministic, no network. Works offline.
  extract_vehicles() — an LLM reading the brochure text. Needs a model.

If the LLM is unavailable the images are still extracted and stored. That
matters: images are the expensive, hard-to-replace part of a brochure, and
losing them because a model was offline would be the wrong trade.

Model choice follows the same tiering as diagnosis — Gemini Flash when a key is
configured (much better at reading messy brochure tables), otherwise the
self-hosted Ollama model. Both are optional.
"""
from __future__ import annotations

import hashlib
import io
import json
import logging
import os
import re
import uuid

import httpx

from core.config import settings

logger = logging.getLogger("gaadiiq.pdf_ingest")

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_INGEST_MODEL", "llama3")
INGEST_TIMEOUT = float(os.getenv("PDF_INGEST_TIMEOUT", "60"))

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
MAX_PAGES = 200
MAX_IMAGES = 300
MAX_TEXT_CHARS = 60_000


class PdfIngestError(RuntimeError):
    """The PDF could not be read at all."""


def extract_images(pdf_bytes: bytes) -> list[dict]:
    """
    Pull every embedded raster image out of the PDF.

    Returns dicts with the raw bytes plus enough metadata to store them:
    page number, dimensions, content type, and a perceptual-ish hash used to
    drop duplicates (brochures repeat the same hero shot on many pages).
    """
    try:
        import fitz  # PyMuPDF
    except ImportError as exc:  # pragma: no cover - deployment dependent
        raise PdfIngestError("PyMuPDF is required to read PDFs") from exc

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        raise PdfIngestError(f"Could not open PDF: {exc}") from exc

    out: list[dict] = []
    seen: set[str] = set()

    try:
        for page_index in range(min(doc.page_count, MAX_PAGES)):
            if len(out) >= MAX_IMAGES:
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

                out.append({
                    "data": data,
                    "ext": (raw.get("ext") or "png").lower(),
                    "content_type": f"image/{(raw.get('ext') or 'png').lower()}",
                    "width": raw.get("width"),
                    "height": raw.get("height"),
                    "page_number": page_index + 1,
                    "phash": digest[:32],
                })
    finally:
        doc.close()

    return out


def extract_text(pdf_bytes: bytes) -> str:
    """Concatenated page text, truncated so a huge catalogue cannot blow the prompt."""
    try:
        import fitz
    except ImportError as exc:  # pragma: no cover
        raise PdfIngestError("PyMuPDF is required to read PDFs") from exc

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        raise PdfIngestError(f"Could not open PDF: {exc}") from exc

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
        import fitz
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
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


async def _call_gemini(prompt: str) -> str:
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.0-flash:generateContent?key={settings.gemini_api_key}"
    )
    async with httpx.AsyncClient(timeout=INGEST_TIMEOUT) as client:
        resp = await client.post(
            url,
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.1, "maxOutputTokens": 8192},
            },
        )
        resp.raise_for_status()
        data = resp.json()
    return data["candidates"][0]["content"]["parts"][0]["text"]


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


async def extract_vehicles(text: str) -> tuple[list[dict], str]:
    """
    Ask a model what vehicles the brochure describes.

    Returns (vehicles, engine_name). Never raises: image extraction has already
    succeeded by this point, and an offline model must not discard that work.
    engine is "none" when nothing could run.
    """
    if not text.strip():
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
