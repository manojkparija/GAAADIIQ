"""
Vision model analysis via Ollama (LLaVA / Qwen2.5-VL).
Called from the diagnosis pipeline when image_urls are present.
"""
from __future__ import annotations

import base64
import ipaddress
import json
import logging
import urllib.parse

import httpx

from core.config import settings

logger = logging.getLogger("gaadiiq.vision")

TIMEOUT = 120.0

# Schemes and internal IP ranges blocked to prevent SSRF
_ALLOWED_SCHEMES = {"https", "http"}
_BLOCKED_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}
_INTERNAL_RANGES = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),  # AWS IMDS
    ipaddress.ip_network("100.64.0.0/10"),   # Carrier-grade NAT
]

# Only allow images from our own CDN and common safe hosts in production
_ALLOWED_URL_PREFIXES = (
    "https://media.gaadiiq.com/",
    "https://pub-",       # Cloudflare R2 public buckets
)


def _validate_image_url(url: str) -> None:
    """Raise ValueError for any URL that could cause SSRF."""
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        raise ValueError("Malformed image URL")

    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise ValueError(f"Disallowed URL scheme: {parsed.scheme!r}")

    host = parsed.hostname or ""
    if not host:
        raise ValueError("Missing host in image URL")

    if host.lower() in _BLOCKED_HOSTS:
        raise ValueError(f"Blocked host: {host!r}")

    # Block numeric IPs that resolve to internal ranges
    try:
        addr = ipaddress.ip_address(host)
        if addr.is_loopback or addr.is_link_local or addr.is_private or addr.is_reserved:
            raise ValueError(f"Blocked internal IP: {host!r}")
        for net in _INTERNAL_RANGES:
            if addr in net:
                raise ValueError(f"Blocked internal IP range: {host!r}")
    except ValueError as exc:
        if "Blocked" in str(exc) or "internal" in str(exc).lower():
            raise
        # Not a raw IP address — hostname lookup happens at request time;
        # for production, enforce CDN prefix allowlist

    if settings.is_production:
        if not any(url.startswith(prefix) for prefix in _ALLOWED_URL_PREFIXES):
            raise ValueError("Image URL must be from an allowed CDN host")


async def analyse_image_url(image_url: str, context: str = "") -> dict:
    """
    Fetch image, send to vision model, return structured assessment.
    Returns a safe fallback dict if the model is offline.
    """
    try:
        _validate_image_url(image_url)
    except ValueError as exc:
        logger.warning("Blocked SSRF attempt for image URL %r: %s", image_url, exc)
        return _unavailable()

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=False) as http:
            r = await http.get(image_url)
            r.raise_for_status()
            # Validate content type from response headers too
            content_type = r.headers.get("content-type", "")
            if not content_type.startswith("image/"):
                logger.warning("Non-image content-type from URL %r: %s", image_url, content_type)
                return _unavailable()
            img_b64 = base64.b64encode(r.content).decode()
    except Exception as exc:
        logger.warning("Could not fetch image %s: %s", image_url, exc)
        return _unavailable()

    # The image is as often a dashboard warning light as it is body damage.
    # Asking only about "visible damage" made a photo of a lit battery/ABS
    # telltale come back as "no damage found", which is worse than useless.
    prompt = f"""You are an automotive diagnostic AI for Indian vehicles.
{f"Context: {context}" if context else ""}
The image may show EITHER a dashboard warning light / instrument cluster, OR
physical damage or wear to a vehicle. Work out which, then analyse it.

If it is a dashboard warning light, name the exact telltale (for example:
battery/charging system, check engine (MIL), oil pressure, coolant temperature,
ABS, airbag/SRS, brake, TPMS, power steering, DPF, glow plug) and say what it
indicates. A red light means stop driving; amber means service soon.

Respond with ONLY valid JSON:
{{
  "image_type": "warning_light|damage|other",
  "warning_lights_visible": ["exact name of each telltale lit, empty if none"],
  "findings": "2-3 sentences: what the image shows and what it means",
  "damage_areas": ["area1", "area2"],
  "severity": "None|Minor|Moderate|Severe|Critical",
  "estimated_repair_cost_inr": {{"min": 0, "max": 0}},
  "safe_to_drive": true,
  "confidence": 70,
  "recommendations": ["rec1", "rec2"]
}}
severity None = nothing wrong; Minor = cosmetic; Moderate = functional;
Severe = significant; Critical = unsafe to drive. A lit red warning light is
at least Severe. Costs in Indian Rupees."""

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as http:
            resp = await http.post(
                f"{settings.ollama_base_url}/api/generate",
                json={
                    "model": settings.ollama_vision_model,
                    "prompt": prompt,
                    "images": [img_b64],
                    "stream": False,
                    "format": "json",
                },
            )
            resp.raise_for_status()
            result = json.loads(resp.json().get("response", "{}"))
            result["vision_model_used"] = True
            result["model"] = settings.ollama_vision_model
            return result
    except Exception as exc:
        logger.warning("Vision model failed: %s", exc)
        return _unavailable()


def _unavailable() -> dict:
    return {
        "findings": "Image analysis unavailable — vision model offline.",
        "image_type": "other",
        "warning_lights_visible": [],
        "damage_areas": [],
        "severity": "Unknown",
        "estimated_repair_cost_inr": {"min": 0, "max": 0},
        "safe_to_drive": None,
        "confidence": 0,
        "recommendations": ["Describe visible damage in the text field."],
        "vision_model_used": False,
        "model": None,
    }
