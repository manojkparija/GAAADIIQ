"""
Vehicle Preliminary Diagnosis & Repair Advisor
RAG pipeline: keyword retrieval from knowledge base → Ollama LLM analysis.
"""
from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path

import httpx

from services.vision import analyse_image_url

logger = logging.getLogger("gaadiiq.diagnosis")

# ── Prompt injection fence ────────────────────────────────────────────────────
_INJECTION_PATTERN = re.compile(
    r"(ignore\s+(previous|all|prior)|forget\s+(your|all)|you\s+are\s+now|"
    r"system\s*prompt|<\s*/?system\s*>|<\s*/?instruction|"
    r"\[/?INST\]|###\s*instruction|act\s+as\s+(a\s+)?new)",
    re.IGNORECASE,
)

def _sanitise(text: str, max_len: int = 2000) -> str:
    """Strip prompt-injection attempts and truncate to max_len."""
    text = text[:max_len]
    text = _INJECTION_PATTERN.sub("[REDACTED]", text)
    return text

_KNOWLEDGE_BASE: list[dict] = []
_KB_PATH = Path(__file__).parent.parent / "data" / "repair_knowledge.json"

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_DIAGNOSIS_MODEL", "llama3")
OLLAMA_TIMEOUT = 120.0

_DISCLAIMER = (
    "⚠️ IMPORTANT DISCLAIMER: This is a preliminary AI-assisted assessment only. "
    "It is NOT a professional diagnosis. Results may be inaccurate or incomplete. "
    "A certified automotive mechanic must physically inspect the vehicle to confirm any diagnosis. "
    "For safety-critical issues (brakes, steering, engine warning lights), do NOT drive the vehicle "
    "until it has been professionally inspected. Never attempt repairs beyond your skill level."
)


def _load_knowledge_base() -> list[dict]:
    global _KNOWLEDGE_BASE
    if not _KNOWLEDGE_BASE:
        try:
            _KNOWLEDGE_BASE = json.loads(_KB_PATH.read_text())
        except Exception as exc:
            logger.warning("Could not load repair knowledge base: %s", exc)
            _KNOWLEDGE_BASE = []
    return _KNOWLEDGE_BASE


def _retrieve_relevant_cases(
    description: str,
    warning_lights: list[str],
    when_occurs: list[str],
    fuel_type: str,
    top_k: int = 4,
) -> list[dict]:
    """Keyword-based retrieval from local knowledge base."""
    kb = _load_knowledge_base()
    if not kb:
        return []

    query_terms = set(
        re.sub(r"[^\w\s]", " ", (description + " " + " ".join(warning_lights or []) + " " + " ".join(when_occurs or []))).lower().split()
    )

    scored: list[tuple[int, dict]] = []
    for case in kb:
        # Fuel type filter (broad match)
        if fuel_type and not any(f.lower() in fuel_type.lower() or fuel_type.lower() in f.lower() for f in case.get("fuel_types", [])):
            if fuel_type not in ("", "Any"):
                pass  # still include but with lower score

        symptom_terms = set(
            " ".join(case.get("symptoms", []) + [case.get("title", "")]).lower().split()
        )
        score = len(query_terms & symptom_terms)
        if score > 0:
            scored.append((score, case))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [c for _, c in scored[:top_k]]


def _build_prompt(
    manufacturer: str,
    model: str,
    variant: str | None,
    model_year: int,
    fuel_type: str,
    transmission: str,
    odometer_km: int | None,
    problem_description: str,
    warning_lights: list[str],
    when_occurs: list[str],
    severity: str,
    retrieved_cases: list[dict],
) -> str:
    # Sanitise all user-supplied text to prevent prompt injection (MOB-008)
    manufacturer = _sanitise(manufacturer, 100)
    model        = _sanitise(model, 100)
    variant      = _sanitise(variant, 100) if variant else variant
    problem_description = _sanitise(problem_description, 2000)
    warning_lights = [_sanitise(w, 80) for w in warning_lights]
    when_occurs    = [_sanitise(w, 80) for w in when_occurs]

    vehicle = f"{model_year} {manufacturer} {model}" + (f" {variant}" if variant else "")
    odo_str = f"{odometer_km:,} km" if odometer_km else "unknown"
    cases_text = ""
    for c in retrieved_cases:
        cases_text += (
            f"\n---\nTitle: {c['title']}\n"
            f"Possible causes: {', '.join(c.get('possible_causes', []))}\n"
            f"Complexity: {c.get('complexity')} | Cost range: ₹{c.get('cost_min')}–₹{c.get('cost_max')}\n"
            f"Repair time: {c.get('repair_time')} | Safe to drive: {c.get('safe_to_drive')}\n"
            f"Risk: {c.get('risk')} | Source: {c.get('source')}\n"
            f"DIY checks: {'; '.join(c.get('diy', []))}\n"
        )

    intro = "You are an expert automotive diagnostic AI advisor for Indian vehicles."
    intro += " Analyze the following vehicle problem and provide a structured preliminary diagnosis."
    return f"""{intro}

VEHICLE:
- {vehicle}
- Fuel: {fuel_type} | Transmission: {transmission} | Odometer: {odo_str}

REPORTED PROBLEM:
{problem_description}

Warning lights on dashboard: {', '.join(warning_lights) if warning_lights else 'None reported'}
Issue occurs during: {', '.join(when_occurs) if when_occurs else 'Not specified'}
User-reported severity: {severity}

RETRIEVED KNOWLEDGE BASE CASES (use these as primary evidence):
{cases_text if cases_text else "No closely matching cases found — use your automotive knowledge."}

Based on the vehicle details and retrieved cases above, provide a JSON response with EXACTLY this structure:
{{
  "preliminary_diagnosis": "A clear 2-3 sentence summary of the most likely diagnosis",
  "possible_causes": [
    {{"cause": "Most likely cause", "confidence": 85, "explanation": "Why this is likely"}},
    {{"cause": "Second possible cause", "confidence": 60, "explanation": "Why this might apply"}},
    {{"cause": "Third possible cause", "confidence": 35, "explanation": "Less likely but possible"}}
  ],
  "repair_complexity": "Simple|Moderate|Complex|Major",
  "cost_min_inr": 2000,
  "cost_max_inr": 15000,
  "repair_time_estimate": "2-4 hours",
  "safe_to_drive": false,
  "risk_level": "Low|Medium|High|Critical",
  "recommended_steps": ["Step 1", "Step 2", "Step 3"],
  "diy_fixes": ["Safe DIY check 1", "Safe DIY check 2"],
  "immediate_service_required": true,
  "preventive_maintenance": ["Tip 1", "Tip 2"],
  "analysis_confidence": 72
}}

Rules:
- Confidence scores must be between 10 and 95 (never claim 100% certainty)
- analysis_confidence is your overall confidence in the diagnosis (0-100)
- safe_to_drive: be conservative — default to false for any safety-critical system
- risk_level: Low (cosmetic/comfort), Medium (performance affected), High (safety risk), Critical (stop driving immediately)
- Only suggest DIY fixes that are genuinely safe for non-mechanics
- Cost estimates in Indian Rupees (INR) for Indian market labor and parts
- Respond with valid JSON only, no additional text"""


async def run_diagnosis(
    manufacturer: str,
    model: str,
    variant: str | None,
    model_year: int,
    fuel_type: str,
    transmission: str,
    odometer_km: int | None,
    problem_description: str,
    warning_lights: list[str],
    when_occurs: list[str],
    severity: str,
    image_urls: list[str] = (),
) -> dict:
    """Run RAG retrieval + Ollama diagnosis. Returns structured result dict."""

    retrieved = _retrieve_relevant_cases(problem_description, warning_lights, when_occurs, fuel_type)
    retrieved_sources = [c.get("source", c.get("title", "")) for c in retrieved]

    prompt = _build_prompt(
        manufacturer, model, variant, model_year, fuel_type, transmission,
        odometer_km, problem_description, warning_lights, when_occurs, severity, retrieved,
    )

    ollama_used = False
    result: dict = {}

    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            resp = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False, "format": "json"},
            )
            resp.raise_for_status()
            raw = resp.json().get("response", "")
            result = json.loads(raw)
            ollama_used = True
    except Exception as exc:
        logger.warning("Ollama diagnosis failed, using heuristic fallback: %s", exc)
        result = _heuristic_fallback(retrieved, severity, fuel_type)

    result["retrieved_sources"] = retrieved_sources
    result["ollama_used"] = ollama_used
    result["disclaimer"] = _DISCLAIMER

    # Vision analysis — run on first image if provided
    if image_urls:
        vision_result = await analyse_image_url(image_urls[0], context=problem_description)
        result["vision_analysis"] = vision_result
        # Upgrade risk_level if vision detects severe/critical damage
        vision_severity = (vision_result.get("severity") or "").lower()
        if vision_severity in ("severe", "critical"):
            current_risk = (result.get("risk_level") or "").lower()
            if current_risk not in ("high", "critical"):
                result["risk_level"] = "High" if vision_severity == "severe" else "Critical"
    else:
        result["vision_analysis"] = None

    return result


def _heuristic_fallback(retrieved: list[dict], severity: str, fuel_type: str) -> dict:
    """Rule-based fallback when Ollama is unavailable."""
    if not retrieved:
        return {
            "preliminary_diagnosis": (
                "Unable to identify a specific issue from the symptoms provided. "
                "Please consult a certified mechanic for a proper diagnostic scan."
            ),
            "possible_causes": [
                {
                    "cause": "Unknown — requires professional OBD scan",
                    "confidence": 50,
                    "explanation": "Insufficient symptom data for automated diagnosis",
                },
            ],
            "repair_complexity": "Unknown",
            "cost_min_inr": 500,
            "cost_max_inr": 50000,
            "repair_time_estimate": "To be determined",
            "safe_to_drive": False,
            "risk_level": "Medium",
            "recommended_steps": [
                "Visit a certified service center",
                "Request an OBD-II diagnostic scan",
                "Do not ignore warning lights",
            ],
            "diy_fixes": ["Check all fluid levels", "Inspect for visible leaks"],
            "immediate_service_required": severity in ("high", "critical"),
            "preventive_maintenance": [
                "Follow manufacturer service schedule",
                "Check tyre pressure monthly",
            ],
            "analysis_confidence": 20,
        }

    best = retrieved[0]
    causes = [
        {
            "cause": c,
            "confidence": max(30, 75 - i * 15),
            "explanation": "Based on reported symptoms matching known cases",
        }
        for i, c in enumerate(best.get("possible_causes", [])[:3])
    ]
    return {
        "preliminary_diagnosis": (
            f"Based on reported symptoms, the most likely issue is related to: {best['title']}. "
            "A professional inspection is recommended to confirm."
        ),
        "possible_causes": causes,
        "repair_complexity": best.get("complexity", "Moderate"),
        "cost_min_inr": best.get("cost_min", 2000),
        "cost_max_inr": best.get("cost_max", 20000),
        "repair_time_estimate": best.get("repair_time", "2-4 hours"),
        "safe_to_drive": best.get("safe_to_drive", False),
        "risk_level": best.get("risk", "Medium"),
        "recommended_steps": [
            "Have the vehicle inspected by a certified mechanic",
            "Request an OBD-II diagnostic scan",
            "Do not defer safety-critical repairs",
        ],
        "diy_fixes": best.get("diy", []),
        "immediate_service_required": not best.get("safe_to_drive", True),
        "preventive_maintenance": ["Follow manufacturer service schedule", "Use manufacturer-recommended fluids and parts"],
        "analysis_confidence": 45,
    }
