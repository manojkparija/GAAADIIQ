"""Image–variant matcher: assigns each extracted PDF image to the correct vehicle variant."""

from __future__ import annotations
import hashlib
import io
import logging
import os
import re
from pathlib import Path
from typing import Optional

import os

import httpx

from models import ExtractedVehicle, ExtractedImage
from pdf_parser import PageImage

logger = logging.getLogger(__name__)

# Base URL used to build absolute image URLs returned to the frontend.
# Set BACKEND_URL env var when running behind a reverse proxy or on a remote server.
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8001")

OLLAMA_URL = "http://localhost:11434/api/generate"
# Vision models tried in preference order; first available wins at runtime
VISION_MODELS = ["qwen2.5-vl", "qwen2-vl", "llava-llama3", "llava"]
IMAGES_DIR   = Path("/tmp/gaadiiq-pdf-images")
IMAGES_DIR.mkdir(parents=True, exist_ok=True)

COLOUR_KEYWORDS = [
    "red", "blue", "white", "black", "grey", "gray", "silver", "orange", "green",
    "brown", "yellow", "gold", "maroon", "purple", "pearl", "metallic", "magnetic",
    "arctic", "titanium", "magma", "midnight", "blazing", "earthen", "cave",
]


def _dominant_colour_name(img_bytes: bytes) -> Optional[str]:
    """Very lightweight: check if any known colour word appears in nearby text."""
    return None  # used as fallback; real detection is via text proximity


def _text_colour_hint(text: str) -> Optional[str]:
    lower = text.lower()
    for c in COLOUR_KEYWORDS:
        if c in lower:
            words = lower.split()
            idx = words.index(c) if c in words else -1
            if idx >= 0:
                start = max(0, idx - 1)
                end = min(len(words), idx + 3)
                return " ".join(words[start:end]).title()
    return None


def _phash(img_bytes: bytes) -> str:
    """Simple perceptual hash via MD5 of resized 8×8 greyscale thumbnail."""
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(img_bytes)).convert("L").resize((8, 8))
        avg = sum(img.getdata()) / 64
        bits = "".join("1" if p >= avg else "0" for p in img.getdata())
        return hex(int(bits, 2))[2:]
    except Exception:
        return hashlib.md5(img_bytes[:512]).hexdigest()


def _save_image(img: PageImage, job_id: str) -> str:
    """Save image bytes to temp dir, return absolute URL loadable by the frontend."""
    job_dir = IMAGES_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    fname = f"page{img.page_num}_{_phash(img.data)}.{img.ext}"
    fpath = job_dir / fname
    fpath.write_bytes(img.data)
    return f"{BACKEND_URL}/tmp-images/{job_id}/{fname}"


def _nearby_text(page_images: list[PageImage], img: PageImage, pages_text: dict[int, str]) -> str:
    """Extract text within ±500 chars of image position on its page."""
    text = pages_text.get(img.page_num, "")
    # Heuristic: take text around midpoint of image's vertical position
    if not text:
        return ""
    total = len(text)
    mid = int((img.y / max(img.height, 1)) * total)
    start = max(0, mid - 500)
    end = min(total, mid + 500)
    return text[start:end]


def _available_vision_model() -> Optional[str]:
    """Return first Ollama vision model that is available locally."""
    try:
        resp = httpx.get("http://localhost:11434/api/tags", timeout=5)
        if resp.status_code != 200:
            return None
        installed = {m["name"].split(":")[0] for m in resp.json().get("models", [])}
        for m in VISION_MODELS:
            if m in installed:
                return m
    except Exception:
        pass
    return None


def _ask_llm_which_variant(img_bytes: bytes, nearby_text: str, variants: list[str]) -> tuple[Optional[str], float]:
    """Ask Ollama vision model: which vehicle variant does this image show?"""
    import base64

    model = _available_vision_model()
    if not model:
        logger.debug("No Ollama vision model available — skipping LLM matching")
        return None, 0.0

    try:
        img_b64 = base64.b64encode(img_bytes).decode()
        variant_list = "\n".join(f"- {v}" for v in variants)
        prompt = (
            "You are an automotive image classifier. Examine this car photograph from a "
            "product brochure or spec sheet, along with surrounding text context.\n\n"
            f"Available vehicle variants:\n{variant_list}\n\n"
            f"Surrounding text (for context):\n{nearby_text[:600]}\n\n"
            "Which variant does this image show? Reply with ONLY the exact variant name "
            "from the list above, or reply 'unknown' if you cannot determine it confidently."
        )
        payload = {
            "model": model,
            "prompt": prompt,
            "images": [img_b64],
            "stream": False,
            "options": {"temperature": 0.0, "num_predict": 50},
        }
        resp = httpx.post(OLLAMA_URL, json=payload, timeout=90)
        resp.raise_for_status()
        answer = resp.json().get("response", "").strip()

        # Exact match first
        for v in variants:
            if v.lower() == answer.lower():
                return v, 0.92
        # Partial match
        for v in variants:
            if v.lower() in answer.lower():
                return v, 0.82
        return None, 0.0
    except Exception as e:
        logger.warning(f"LLM image matching failed ({model}): {e}")
        return None, 0.0


def match_images(
    raw_images: list[PageImage],
    vehicles: list[ExtractedVehicle],
    pages_text: dict[int, str],
    job_id: str,
) -> list[ExtractedVehicle]:
    """
    For each extracted image:
    1. Deduplicate via pHash.
    2. Find nearby text; extract variant name + colour hints.
    3. If text match is clear → assign directly.
    4. Else → ask llava vision model.
    5. Confidence < 0.6 → leave unmatched for admin.
    """
    if not raw_images:
        return vehicles

    variants = [
        f"{v.make} {v.model} {v.variant}".strip()
        for v in vehicles
    ]
    variant_map = {f"{v.make} {v.model} {v.variant}".strip(): v for v in vehicles}

    seen_hashes: set[str] = set()

    for raw_img in raw_images:
        ph = _phash(raw_img.data)
        if ph in seen_hashes:
            logger.debug(f"Skipping duplicate image (pHash={ph})")
            continue
        seen_hashes.add(ph)

        local_url = _save_image(raw_img, job_id)
        nearby    = _nearby_text([], raw_img, pages_text)

        # 1. Try text-proximity match
        matched_variant: Optional[str] = None
        confidence = 0.0

        for variant in variants:
            model_name = variant.split()[-1] if variant.split() else ""
            if model_name and model_name.lower() in nearby.lower():
                matched_variant = variant
                confidence = 0.75
                break

        # 2. Colour hint
        colour = _text_colour_hint(nearby)

        # 3. Fallback to llava if no text match
        if not matched_variant and len(variants) <= 10:
            matched_variant, confidence = _ask_llm_which_variant(
                raw_img.data, nearby, variants
            )

        img = ExtractedImage(
            url=local_url,
            colour=colour,
            match_confidence=confidence,
            matched_variant=matched_variant,
            page_num=raw_img.page_num,
        )

        # Attach to vehicle
        if matched_variant and confidence >= 0.6:
            target = variant_map.get(matched_variant)
            if target:
                target.images.append(img)
                logger.debug(f"Image page {raw_img.page_num} → {matched_variant} (conf {confidence:.2f})")
        else:
            # Attach to first vehicle as unmatched so admin can reassign
            if vehicles:
                img.matched_variant = None
                vehicles[0].images.append(img)
            logger.debug(f"Image page {raw_img.page_num} unmatched (conf {confidence:.2f})")

    return vehicles
