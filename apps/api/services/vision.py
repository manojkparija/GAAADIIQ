"""
Vision model analysis via Ollama (LLaVA / Qwen2.5-VL).
Called from the diagnosis pipeline when image_urls are present.
"""
from __future__ import annotations

import base64
import json
import logging

import httpx

from core.config import settings

logger = logging.getLogger("gaadiiq.vision")

TIMEOUT = 120.0


async def analyse_image_url(image_url: str, context: str = "") -> dict:
    """
    Fetch image, send to vision model, return structured assessment.
    Returns a safe fallback dict if the model is offline.
    """
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.get(image_url)
            r.raise_for_status()
            img_b64 = base64.b64encode(r.content).decode()
    except Exception as exc:
        logger.warning("Could not fetch image %s: %s", image_url, exc)
        return _unavailable()

    prompt = f"""You are an automotive damage assessment AI for Indian vehicles.
{f"Context: {context}" if context else ""}
Analyse this vehicle image and respond with ONLY valid JSON:
{{
  "findings": "2-3 sentence description of visible damage or wear",
  "damage_areas": ["area1", "area2"],
  "severity": "None|Minor|Moderate|Severe|Critical",
  "estimated_repair_cost_inr": {{"min": 0, "max": 0}},
  "safe_to_drive": true,
  "confidence": 70,
  "recommendations": ["rec1", "rec2"]
}}
severity None = no damage; Minor = cosmetic; Moderate = functional; Severe = significant; Critical = unsafe.
Costs in Indian Rupees."""

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
        "damage_areas": [],
        "severity": "Unknown",
        "estimated_repair_cost_inr": {"min": 0, "max": 0},
        "safe_to_drive": None,
        "confidence": 0,
        "recommendations": ["Describe visible damage in the text field."],
        "vision_model_used": False,
        "model": None,
    }
