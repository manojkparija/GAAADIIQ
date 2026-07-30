"""AI extraction: chunk parsed document text → Ollama LLM → structured VehicleRecord list."""

from __future__ import annotations
import json
import logging
import re
from typing import Any
import httpx

from pdf_parser import ParsedDocument
from models import ExtractedVehicle, ExtractedSpec

logger = logging.getLogger(__name__)

OLLAMA_URL   = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "mistral:7b-instruct"
CHUNK_SIZE   = 2000   # tokens (approx chars / 4)
CHUNK_OVERLAP = 200

SYSTEM_PROMPT = """\
You are an automobile data extraction AI. Extract vehicle information from the text below
and return ONLY a valid JSON array. Each element is one vehicle variant with these fields:

{
  "make": string | null,
  "model": string | null,
  "variant": string | null,
  "year": integer | null,
  "body_type": "Hatchback"|"Sedan"|"SUV"|"MUV"|"Coupe"|"Pickup"|"Van"|"Other"|null,
  "fuel_type": "Petrol"|"Diesel"|"CNG"|"Electric"|"Hybrid"|"Other"|null,
  "transmission": "Manual"|"Automatic"|"AMT"|"CVT"|"DCT"|null,
  "price_inr": number | null,
  "engine_cc": number | null,
  "power_bhp": number | null,
  "torque_nm": number | null,
  "mileage_kmpl": number | null,
  "seating": integer | null,
  "colours": string[],
  "specs": [{"label": string, "value": string}],
  "confidence": {"make": 0.0-1.0, "model": 0.0-1.0, "price_inr": 0.0-1.0, ...}
}

Rules:
- Set null for any field not found — never guess.
- price_inr must be in rupees (convert lakhs: multiply by 100000).
- Return [] if no vehicle data found.
- Return ONLY the JSON array, no prose.
"""


def _chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split text into overlapping chunks (by approximate char count, not tokens)."""
    char_size = size * 4
    char_over = overlap * 4
    chunks, start = [], 0
    while start < len(text):
        end = start + char_size
        chunks.append(text[start:end])
        start += char_size - char_over
    return chunks


def _call_ollama(prompt: str) -> str:
    """Call Ollama generate endpoint, return raw text response."""
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.1, "num_predict": 2048},
    }
    resp = httpx.post(OLLAMA_URL, json=payload, timeout=120)
    resp.raise_for_status()
    return resp.json().get("response", "")


def _parse_response(raw: str) -> list[dict[str, Any]]:
    """Extract the JSON array from Ollama's response string."""
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            # Model sometimes wraps in {"vehicles": [...]}
            for v in data.values():
                if isinstance(v, list):
                    return v
    except json.JSONDecodeError:
        pass

    # Fallback: find first [...] block
    match = re.search(r"\[.*\]", raw, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    logger.warning("Could not parse JSON from Ollama response")
    return []


def _merge_vehicles(base: list[dict], extra: list[dict]) -> list[dict]:
    """
    Merge extra chunk results into base.
    Match by (make, model, variant). Later chunks fill None fields,
    never overwrite fields that already have a confident value.
    """
    for ev in extra:
        key = (
            (ev.get("make") or "").lower().strip(),
            (ev.get("model") or "").lower().strip(),
            (ev.get("variant") or "").lower().strip(),
        )
        matched = next(
            (b for b in base if (
                (b.get("make") or "").lower().strip() == key[0] and
                (b.get("model") or "").lower().strip() == key[1]
            )), None
        )
        if matched is None:
            base.append(ev)
        else:
            # Fill missing fields
            for k, v in ev.items():
                if k == "specs":
                    existing_labels = {s["label"] for s in matched.get("specs", [])}
                    for spec in v:
                        if spec["label"] not in existing_labels:
                            matched.setdefault("specs", []).append(spec)
                elif k == "colours":
                    matched.setdefault("colours", [])
                    matched["colours"] = list(set(matched["colours"] + v))
                elif k == "confidence":
                    matched.setdefault("confidence", {}).update(v)
                elif matched.get(k) is None and v is not None:
                    matched[k] = v
    return base


def _compute_quality(vehicle: dict) -> float:
    """Weighted quality score: field completeness (40%) + avg confidence (40%) + extras (20%)."""
    required = ["make", "model", "variant", "year", "price_inr", "fuel_type",
                "transmission", "engine_cc", "power_bhp", "mileage_kmpl", "seating"]
    filled = sum(1 for f in required if vehicle.get(f) is not None)
    completeness = (filled / len(required)) * 40

    confs = list(vehicle.get("confidence", {}).values())
    avg_conf = (sum(confs) / len(confs) * 40) if confs else 0

    bonus = 0
    if vehicle.get("colours"): bonus += 8
    if vehicle.get("specs"):   bonus += 12
    return round(min(100, completeness + avg_conf + bonus), 1)


def _status_from_score(score: float) -> str:
    if score >= 75: return "READY"
    if score >= 40: return "NEEDS_REVIEW"
    return "INCOMPLETE"


def extract_vehicles(doc: ParsedDocument, job_id: str) -> list[ExtractedVehicle]:
    """
    Main extraction entry point.
    1. Chunk the full document text.
    2. Call Ollama on each chunk.
    3. Merge results.
    4. Convert to ExtractedVehicle models.
    """
    full_text = doc.full_text
    # Also flatten table cells into text for better coverage
    for page in doc.pages:
        for table in page.tables:
            for row in table:
                full_text += "\n" + " | ".join(row)

    chunks = _chunk_text(full_text)
    logger.info(f"Extracting from {len(chunks)} chunks using {OLLAMA_MODEL}")

    raw_vehicles: list[dict] = []
    for i, chunk in enumerate(chunks):
        try:
            prompt = f"{SYSTEM_PROMPT}\n\nText chunk ({i+1}/{len(chunks)}):\n{chunk}"
            response = _call_ollama(prompt)
            chunk_results = _parse_response(response)
            raw_vehicles = _merge_vehicles(raw_vehicles, chunk_results)
            logger.debug(f"Chunk {i+1}: found {len(chunk_results)} records, total {len(raw_vehicles)}")
        except Exception as e:
            logger.error(f"Chunk {i+1} extraction failed: {e}")
            continue

    # Convert to Pydantic models
    vehicles: list[ExtractedVehicle] = []
    for rv in raw_vehicles:
        score = _compute_quality(rv)
        specs = [ExtractedSpec(label=s["label"], value=str(s["value"]))
                 for s in rv.get("specs", []) if isinstance(s, dict)]
        try:
            v = ExtractedVehicle(
                job_id=job_id,
                make=rv.get("make"),
                model=rv.get("model"),
                variant=rv.get("variant"),
                year=rv.get("year"),
                body_type=rv.get("body_type"),
                fuel_type=rv.get("fuel_type"),
                transmission=rv.get("transmission"),
                price_inr=rv.get("price_inr"),
                engine_cc=rv.get("engine_cc"),
                power_bhp=rv.get("power_bhp"),
                torque_nm=rv.get("torque_nm"),
                mileage_kmpl=rv.get("mileage_kmpl"),
                seating=rv.get("seating"),
                colours=rv.get("colours", []),
                specs=specs,
                confidence=rv.get("confidence", {}),
                quality_score=score,
                status=_status_from_score(score),
            )
            vehicles.append(v)
        except Exception as e:
            logger.warning(f"Skipping invalid vehicle record: {e} — {rv}")

    logger.info(f"Extracted {len(vehicles)} vehicles from {doc.filename}")
    return vehicles
