"""
Read a car brochure PDF: pull out the images, and extract the vehicle data.

Two halves, kept separate because they fail independently:

  extract_images()   — PyMuPDF, deterministic, no network. Works offline.
  extract_vehicles() — an LLM reading the brochure. Needs a model. Reads the
                       text layer when there is one, and falls back to showing
                       a vision model the rendered pages when there is not —
                       which is the common case for manufacturer brochures,
                       whose words are printed into the artwork.

If the LLM is unavailable the images are still extracted and stored. That
matters: images are the expensive, hard-to-replace part of a brochure, and
losing them because a model was offline would be the wrong trade.

Providers are tried in order, best accuracy first, and each hop is skipped when
unconfigured:

  Gemini Flash — best at messy brochure variant tables. Paid.
  Groq         — free hosted tier, Llama 4 vision, OpenAI-compatible.
  Ollama       — free but self-hosted, so it only answers where a host is
                 actually reachable, typically local development.

Groq sits ahead of Ollama deliberately. Ollama was previously the only free
fallback, which made the free path unreachable in the deployed API: there is no
Ollama alongside it, so "fall back to Ollama" meant "fail". The chain is also
not gated on a Gemini key — gating it there meant that removing the key, the
exact case the fallback exists for, skipped the free providers entirely.
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

# Thumbnails are what galleries, cards and search results load, so they are
# sized for the largest of those rather than for a single layout.
THUMBNAIL_MAX_EDGE = int(os.getenv("MEDIA_THUMBNAIL_MAX_EDGE", "400"))
THUMBNAIL_QUALITY = int(os.getenv("MEDIA_THUMBNAIL_QUALITY", "82"))

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

                # And a perceptual hash for the case an exact one cannot see:
                # the same photograph re-encoded or resized in another
                # brochure. Those bytes differ, so exact hashing alone stores
                # the picture twice.
                yield {
                    "data": data,
                    "ext": (raw.get("ext") or "png").lower(),
                    "content_type": f"image/{(raw.get('ext') or 'png').lower()}",
                    "width": raw.get("width"),
                    "height": raw.get("height"),
                    "page_number": page_index + 1,
                    "content_hash": digest,
                    "phash": perceptual_hash(data),
                }
                yielded += 1
                if yielded >= MAX_IMAGES:
                    logger.warning("Image cap %d reached; ignoring the rest", MAX_IMAGES)
                    break
    finally:
        doc.close()


def perceptual_hash(data: bytes) -> str | None:
    """
    64-bit difference hash, hex-encoded, or None if the image cannot be read.

    dHash rather than an exact digest because the duplicate that matters here is
    the same photograph re-encoded: a manufacturer reuses one press shot across
    a brochure, a facelift brochure and a dealer pack, each time at a different
    size or JPEG quality. Those files share no bytes, so sha256 sees three
    distinct images and stores all three.

    dHash compares each pixel with its right-hand neighbour on a 9x8 greyscale
    reduction, so it encodes the direction of brightness change rather than
    brightness itself. That survives rescaling and re-compression, and two
    hashes can be compared by Hamming distance to find near-matches.
    """
    try:
        from PIL import Image

        with Image.open(io.BytesIO(data)) as im:
            # 9 wide so eight horizontal comparisons fit per row: 8 rows x 8
            # comparisons is the 64 bits.
            small = im.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
            # tobytes() rather than getdata(): in mode "L" it is one byte per
            # pixel in row order, which is exactly what this needs, and it is
            # stable API — getdata() is deprecated for removal in Pillow 14.
            pixels = small.tobytes()

        bits = 0
        for row in range(8):
            base = row * 9
            for col in range(8):
                bits <<= 1
                if pixels[base + col] > pixels[base + col + 1]:
                    bits |= 1

        # A flat image — a colour swatch, a plain background — has no gradient
        # anywhere, so every comparison comes out the same and the hash is all
        # zeros or all ones. Every such image would then match every other one,
        # and a brochure's red, blue and white swatches would collapse into a
        # single stored picture. There is no perceptual signature to offer, so
        # say so and let exact hashing decide.
        if bits in (0, (1 << 64) - 1):
            return None

        return f"{bits:016x}"
    except Exception as exc:
        # A hash is an optimisation, never a reason to lose the image.
        logger.debug("Could not compute perceptual hash: %s", exc)
        return None


def hamming_distance(a: str | None, b: str | None) -> int | None:
    """
    Bit difference between two perceptual hashes, or None if either is missing.

    Distances up to about 10 of 64 bits are the same picture in practice; beyond
    that they diverge quickly. Exposed so callers decide their own threshold
    rather than having one baked in here.
    """
    if not a or not b:
        return None
    try:
        return bin(int(a, 16) ^ int(b, 16)).count("1")
    except ValueError:
        return None


def make_thumbnail(data: bytes, max_edge: int = THUMBNAIL_MAX_EDGE) -> tuple[bytes, str] | None:
    """
    Downscale to a WebP thumbnail, returning (bytes, content_type).

    WebP because every gallery and card in the product loads these rather than
    the originals, and it is markedly smaller than JPEG at the same quality.
    Aspect ratio is preserved and images already smaller than max_edge are not
    upscaled — a colour swatch enlarged to 400px is just a blurry swatch.

    Returns None rather than raising: a thumbnail is derived data, and failing
    to build one must not cost us the original.
    """
    try:
        from PIL import Image

        with Image.open(io.BytesIO(data)) as im:
            # Flatten transparency and exotic modes onto white — WebP can carry
            # alpha, but a PNG logo with a transparent background renders as a
            # black box in most galleries.
            if im.mode not in ("RGB", "L"):
                background = Image.new("RGB", im.size, (255, 255, 255))
                converted = im.convert("RGBA")
                background.paste(converted, mask=converted.split()[-1])
                im = background

            im.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)

            buf = io.BytesIO()
            im.save(buf, format="WEBP", quality=THUMBNAIL_QUALITY, method=4)
            return buf.getvalue(), "image/webp"
    except Exception as exc:
        logger.warning("Could not build thumbnail: %s", exc)
        return None


def thumbnail_key(key: str) -> str:
    """
    Storage key for a thumbnail, derived from the original's key.

    Derived rather than stored separately so the pair cannot drift apart, and
    suffixed before the extension so the two sort next to each other when
    someone is looking through a bucket by hand.
    """
    stem, _, ext = key.rpartition(".")
    return f"{stem or key}_thumb.webp" if stem else f"{key}_thumb.webp"


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


class RateLimited(Exception):
    """
    A provider throttled us rather than failing.

    Worth its own type because it needs a different response from every other
    error: an invalid key or an unreachable host will not fix itself, but a rate
    limit clears on its own. Reporting the two alike sends an operator to
    recheck a key that was correct all along.
    """


# Both providers meter free usage, and a brochure is a heavy request: eight page
# images in one call. Gemini's free tier throttles this in practice — a Dzire
# upload produced 429 TooManyRequests against Google's free tier while the key
# and model were both fine. A couple of short waits absorb a burst; anything
# longer belongs to the caller, not to a held-open request.
_RETRY_ATTEMPTS = 3
_MAX_RETRY_WAIT = 20.0


async def _post_retrying_429(provider: str, do_post, timeout: float):
    """
    Run `do_post(client)` and retry a 429, honouring Retry-After where present.

    Raises RateLimited once the attempts are spent, so callers can report
    "throttled" rather than folding it in with unreachable hosts and bad keys.
    Shared by both providers: whichever one is metering us, the operator needs
    the same distinction.
    """
    last_retry_after = 0.0

    for attempt in range(1, _RETRY_ATTEMPTS + 1):
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await do_post(client)

            if resp.status_code != 429:
                resp.raise_for_status()
                return resp

            try:
                last_retry_after = float(resp.headers.get("retry-after", "") or 0)
            except ValueError:
                last_retry_after = 0.0
            wait = min(last_retry_after or 2.0 ** attempt, _MAX_RETRY_WAIT)

        if attempt == _RETRY_ATTEMPTS:
            break

        logger.info(
            "%s rate-limited (attempt %d/%d), waiting %.1fs",
            provider, attempt, _RETRY_ATTEMPTS, wait,
        )
        await asyncio.sleep(wait)

    raise RateLimited(
        f"{provider} rate limit not cleared after {_RETRY_ATTEMPTS} attempts"
        + (f" (last Retry-After: {last_retry_after:.0f}s)" if last_retry_after else "")
    )


async def _call_gemini(prompt: str, images: list[bytes] | None = None) -> str:
    """
    Ask Gemini Flash, optionally showing it page images as well as text.

    The image path exists because manufacturer brochures are frequently laid
    out as artwork with no text layer at all — a real Dzire brochure yielded
    zero characters — so a text-only request has nothing to work with however
    well the model is configured.

    Model and endpoint come from settings, matching services/diagnosis.py. They
    were previously hardcoded here, so GEMINI_MODEL changed the diagnosis path
    and silently did nothing to brochures — and the pinned value outlived the
    model it named.
    """
    url = (
        f"{settings.gemini_api_url.rstrip('/')}/models/"
        f"{settings.gemini_model}:generateContent?key={settings.gemini_api_key}"
    )
    parts: list[dict] = [{"text": prompt}]
    for png in images or []:
        parts.append({
            "inline_data": {
                "mime_type": "image/png",
                "data": base64.b64encode(png).decode("ascii"),
            }
        })

    timeout = VISION_TIMEOUT if images else INGEST_TIMEOUT
    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 8192},
    }

    async def post(client):
        return await client.post(url, json=payload)

    data = (await _post_retrying_429("Gemini", post, timeout)).json()
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


async def _groq_chat(content: list[dict], timeout: float) -> str:
    """POST one OpenAI-compatible chat completion to Groq and return the text."""
    async def post(client):
        return await client.post(
            f"{settings.groq_api_url}/chat/completions",
            headers={"Authorization": f"Bearer {settings.groq_api_key}"},
            json={
                "model": settings.groq_vision_model,
                "messages": [{"role": "user", "content": content}],
                "temperature": 0.1,
                "max_tokens": 8192,
            },
        )

    resp = await _post_retrying_429("Groq", post, timeout)
    return resp.json()["choices"][0]["message"]["content"]


async def _call_groq(prompt: str) -> str:
    """Ask Groq to read a brochure's text layer — the free hosted text fallback."""
    return await _groq_chat([{"type": "text", "text": prompt}], INGEST_TIMEOUT)


async def _call_groq_vision(prompt: str, images: list[bytes]) -> str:
    """
    Ask Groq's Llama 4 vision model to read the rendered pages.

    This is the fallback that works in the deployed API: Groq is hosted and its
    developer tier is free, where Ollama would have to be self-hosted next to
    the backend. The API is OpenAI-compatible, so pages travel as `image_url`
    parts holding data: URIs rather than as a provider-specific images field.

    Groq caps a request at 5 images, below PDF_VISION_MAX_PAGES, so the pages go
    in batches and the variants found in each are concatenated. Batching rather
    than truncating: page 6 of a brochure is as likely to hold the variant grid
    as page 1, and silently dropping it would lose exactly the table this reads
    the pages to find.
    """
    batch_size = max(1, settings.groq_max_images_per_request)
    batches = [images[i:i + batch_size] for i in range(0, len(images), batch_size)]

    collected: list[dict] = []
    last_error: Exception | None = None
    throttled = False

    for index, batch in enumerate(batches):
        content: list[dict] = [{"type": "text", "text": prompt}]
        for png in batch:
            b64 = base64.b64encode(png).decode("ascii")
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{b64}"},
            })

        try:
            raw = await _groq_chat(content, VISION_TIMEOUT)
        except RateLimited as exc:
            # Later batches share the same exhausted budget, so continuing would
            # only spend more waiting to fail again. Stop and keep whatever the
            # earlier batches already read.
            logger.warning("Groq vision batch %d/%d throttled: %s", index + 1, len(batches), exc)
            last_error = exc
            throttled = True
            break
        except Exception as exc:
            # One bad batch must not lose the pages that did read, for the same
            # reason a bad page must not lose the rest of the render.
            logger.warning("Groq vision batch %d/%d failed: %s", index + 1, len(batches), exc)
            last_error = exc
            continue

        try:
            collected.extend(_parse_vehicles(raw))
        except Exception as exc:
            logger.warning("Could not parse Groq vision batch %d/%d: %s", index + 1, len(batches), exc)
            last_error = exc

    if not collected:
        raise last_error or RuntimeError("Groq vision returned no vehicles")

    # Partial results are still worth returning — half a variant grid beats an
    # empty review queue — but the caller is told it was throttled so the page
    # can say the reading was cut short rather than implying it was complete.
    if throttled:
        logger.warning(
            "Groq was throttled partway; returning %d vehicles from the batches that read",
            len(collected),
        )

    # Re-serialised so the caller keeps a single parse-then-clean path across
    # every provider, rather than one shape for Groq and another for the rest.
    return json.dumps(collected)


async def _call_ollama_vision(prompt: str, images: list[bytes] | None = None) -> str:
    """
    Ask Ollama's vision model (llava) with optional page images.

    Only useful where an Ollama host is actually reachable — typically local
    development. Kept as the last hop so a self-hosted deployment still has a
    free path once Gemini and Groq are out.
    """
    payload: dict = {
        "model": settings.ollama_vision_model,
        "prompt": prompt,
        "stream": False,
        "format": "json",
    }
    # Ollama takes images as a top-level field of base64 strings. Encoding them
    # into the prompt text instead shows the model a wall of base64 and no
    # picture, which is why this path previously returned nothing.
    if images:
        payload["images"] = [base64.b64encode(png).decode("ascii") for png in images]

    async with httpx.AsyncClient(timeout=VISION_TIMEOUT if images else INGEST_TIMEOUT) as client:
        resp = await client.post(f"{OLLAMA_BASE_URL}/api/generate", json=payload)
        resp.raise_for_status()
        return resp.json().get("response", "")


_CLASSIFY_PROMPT = """You are cataloguing photographs from an Indian car
brochure. {n} images follow, in order.

For EACH image, in the same order, return one JSON object:

{{
  "kind": "exterior|interior|colour_swatch|feature|logo|unknown",
  "view": "front|front_three_quarter|side|rear_three_quarter|rear|top|detail|unknown",
  "colour": "the car's body colour as a brochure would name it, or null"
}}

Return ONLY a JSON array of exactly {n} objects — no prose, no markdown fences.

Rules:
- kind: exterior = the outside of a car; interior = cabin, seats, dashboard;
  colour_swatch = a paint sample or colour chip, usually a plain block of
  colour; feature = a close-up of one component such as a headlamp or alloy;
  logo = a badge or wordmark alone.
- view applies to exterior shots. Use "detail" for a close crop of one part,
  and "unknown" for interiors, swatches and logos.
- colour: only when a car body is visible and its colour is unambiguous. Use
  null for interiors, logos and anything you are unsure of. Never guess.
- Return exactly one object per image, in the order the images were given.
"""


async def classify_images(images: list[bytes]) -> list[dict]:
    """
    Ask a vision model what each image depicts. Returns one dict per input.

    Uses the same provider chain and 429 semantics as extraction, so a throttled
    classification raises RateLimited and the caller can leave images
    unclassified rather than mistaking a rate limit for a bad key.

    Batched to the tightest per-request image cap of the configured providers,
    and the result list is always the same length as the input — a short or
    malformed reply is padded with empty dicts rather than silently shifting
    every later image's metadata onto the wrong row.
    """
    if not images:
        return []

    providers: list[tuple[str, object, int]] = []
    if settings.gemini_api_key:
        providers.append(("gemini", _call_gemini, len(images)))
    if settings.groq_api_key:
        providers.append(("groq", _call_groq_vision, max(1, settings.groq_max_images_per_request)))
    providers.append(("ollama", _call_ollama_vision, len(images)))

    rate_limited = False

    for name, call, batch_size in providers:
        out: list[dict] = []
        failed = False

        for start in range(0, len(images), batch_size):
            batch = images[start:start + batch_size]
            prompt = _CLASSIFY_PROMPT.format(n=len(batch))
            try:
                raw = await call(prompt, images=batch)
            except RateLimited as exc:
                logger.warning("%s image classification throttled: %s", name, exc)
                rate_limited = True
                failed = True
                break
            except Exception as exc:
                logger.warning("%s image classification failed: %s", name, exc)
                failed = True
                break

            parsed = _parse_vehicles(raw)  # same tolerant JSON-array reader
            # Pad or trim to the batch length so index i always describes image i.
            parsed = (parsed + [{}] * len(batch))[:len(batch)]
            out.extend(parsed)

        if not failed:
            logger.info("Classified %d images with %s", len(out), name)
            return (out + [{}] * len(images))[:len(images)]

    if rate_limited:
        raise RateLimited("Every provider was rate-limited while classifying images")
    return [{} for _ in images]


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
    rendered and shown to a vision model as pictures instead. Manufacturer brochures
    are routinely built this way — a real Dzire brochure yielded zero characters —
    so without this the whole feature returns nothing for exactly the documents
    it exists to read. Tries Gemini first (better accuracy), then falls back to
    Ollama's llava model for free extraction.
    """
    has_text = bool(text.strip())

    if not has_text and source is not None:
        # Ordered best-accuracy-first. Gemini reads brochure tables best; Groq is
        # the free hosted fallback; Ollama only answers where it is self-hosted.
        #
        # Deliberately not gated on a Gemini key any more. Gating the whole
        # vision path on Gemini meant that removing the key — the exact case a
        # fallback exists for — skipped vision entirely and reported "none",
        # so the free providers could never be reached.
        providers: list[tuple[str, object]] = []
        if settings.gemini_api_key:
            providers.append(("gemini-vision", _call_gemini))
        if settings.groq_api_key:
            providers.append(("groq-vision", _call_groq_vision))
        providers.append(("ollama-vision", _call_ollama_vision))

        try:
            pages = await asyncio.to_thread(render_pages, source)
        except Exception as exc:
            logger.warning("Could not render pages for vision extraction: %s", exc)
            return [], "vision-render-failed"

        if not pages:
            logger.warning("No pages could be rendered for vision extraction")
            return [], "vision-render-failed"

        # Distinguishes "every provider errored" from "a provider answered but
        # the answer was unreadable", because the two need different fixes: a
        # key or quota in the first case, a prompt or model in the second.
        parse_failed = False
        # A throttle is temporary and clears by itself, unlike a bad key or an
        # unreachable host. Collapsing it into "call failed" is what sends an
        # operator to recheck a key that was never the problem.
        rate_limited = False

        for engine, call in providers:
            logger.info("No text layer; reading %d rendered pages with %s", len(pages), engine)
            try:
                raw = await call(_VISION_PROMPT, images=pages)
            except RateLimited as exc:
                logger.warning("%s was rate-limited: %s", engine, exc)
                rate_limited = True
                continue
            except Exception as exc:
                logger.warning("%s extraction failed: %s", engine, exc)
                continue

            try:
                vehicles = _clean(_parse_vehicles(raw))
            except Exception as exc:
                logger.warning("Could not parse the %s response: %s", engine, exc)
                parse_failed = True
                continue

            # A provider that answers with an empty list has read the pages and
            # found no variants; trying the next one will not change that, and
            # the engine name records who read them.
            return vehicles, engine

        # Parse failure ranks above throttling: a provider that replied with
        # something unreadable tells us more than one that never got a turn.
        if parse_failed:
            return [], "vision-parse-failed"
        return [], "vision-rate-limited" if rate_limited else "vision-call-failed"

    if not has_text:
        return [], "none"

    prompt = _PROMPT.format(text=text)

    # Same order and same reasoning as the vision chain above: a brochure that
    # does have a text layer hits the identical dead end when Gemini is out and
    # the only remaining provider is an Ollama host that is not deployed.
    text_providers: list[tuple[str, object]] = []
    if settings.gemini_api_key:
        text_providers.append(("gemini", _call_gemini))
    if settings.groq_api_key:
        text_providers.append(("groq", _call_groq))
    text_providers.append(("ollama", _call_ollama))

    for engine, call in text_providers:
        try:
            return _clean(_parse_vehicles(await call(prompt))), engine
        except Exception as exc:
            logger.warning("%s extraction failed: %s", engine, exc)

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
    # TIFF: II* (little-endian) or MM\0* (big-endian). Common in supplied
    # press photography, which is why the catalogue accepts it even though a
    # browser will not render it — it is converted on the way in.
    if data[:4] in (b"II\x2a\x00", b"MM\x00\x2a"):
        return "tiff", "image/tiff"
    # HEIC/HEIF: 'ftyp' box at offset 4, brand in the next four bytes. The
    # default format of every recent iPhone, so it arrives whether or not
    # anyone planned for it.
    if len(data) >= 12 and data[4:8] == b"ftyp":
        brand = data[8:12]
        if brand in (b"heic", b"heix", b"hevc", b"heim", b"heis", b"mif1", b"msf1"):
            return "heic", "image/heic"
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
