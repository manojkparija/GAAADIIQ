"""
AI Valuation Service — estimates fair market price for a car listing.

Primary:  LangChain + Ollama (llama3) — structured prompt → JSON price estimate.
Fallback: Rule-based heuristic when Ollama is unavailable (dev / cold start).
"""
import asyncio
import json
import logging
import re
import time
from datetime import datetime

import httpx
from langchain_community.llms.ollama import Ollama
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate

from core.config import settings
from models.listing import Listing

logger = logging.getLogger(__name__)


def _metrics():
    # Lazy import to avoid circular dependency with main.py
    from main import AI_FALLBACK_TOTAL, AI_VALUATION_LATENCY  # noqa: PLC0415
    return AI_VALUATION_LATENCY, AI_FALLBACK_TOTAL

# Simple circuit breaker: track consecutive Ollama failures
_cb_failures = 0
_cb_open_until: float = 0.0
_CB_THRESHOLD = 3       # open after N consecutive failures
_CB_COOLDOWN = 60.0     # seconds before retrying after open

_VALUATION_PROMPT = PromptTemplate.from_template(
    """You are an Indian automotive pricing expert. Estimate the fair market value of the following car listing.

Car details:
- Make & Model: {make} {model} {variant}
- Year: {year}
- Fuel type: {fuel_type}
- Transmission: {transmission}
- Body type: {body_type}
- Engine: {engine_cc} cc
- KM driven: {km_driven}
- Number of owners: {owners_count}
- Condition: {condition}
- Registration state: {registration_state}
- City: {city}
- Listing type: {listing_type}
- Asking price: ₹{asking_price}

Based on current Indian market conditions (depreciation, demand, city, fuel type):
Respond ONLY with a JSON object in this exact format, no explanation:
{{"fair_value": <integer in INR>, "confidence": "<low|medium|high>", "reasoning": "<one sentence>"}}"""
)


def _heuristic_valuation(listing: Listing) -> tuple[float, str, str, str]:
    """
    Rule-based fallback when Ollama is unavailable.
    Applies standard Indian car depreciation model.
    Returns (fair_value, method, confidence, reasoning).
    """
    car = listing.car
    age = datetime.now().year - car.year

    base = float(listing.price)

    if age <= 0:
        depreciation = 0.0
    elif age == 1:
        depreciation = 0.15
    else:
        depreciation = 0.15 + (min(age - 1, 9) * 0.10)

    depreciation = min(depreciation, 0.70)

    if listing.km_driven and age > 0:
        expected_km = age * 15000
        excess_km = max(0, listing.km_driven - expected_km)
        mileage_penalty = (excess_km // 10000) * 0.02
    else:
        mileage_penalty = 0.0

    fuel_factor = {
        "electric": 1.05,
        "hybrid": 1.02,
        "petrol": 1.00,
        "cng": 0.97,
        "diesel": 0.98,
    }.get(car.fuel_type.value if car.fuel_type else "petrol", 1.00)

    owner_penalty = (listing.owners_count or 1) * 0.03 if listing.listing_type.value == "used" else 0.0

    fair_value = base * (1 - depreciation - mileage_penalty - owner_penalty) * fuel_factor
    fair_value = max(fair_value, base * 0.25)
    fair_value = round(fair_value / 1000) * 1000

    reasoning = (
        f"Heuristic: {age}yr depreciation ({depreciation:.0%})"
        + (f", mileage penalty ({mileage_penalty:.0%})" if mileage_penalty else "")
        + (f", owner penalty ({owner_penalty:.0%})" if owner_penalty else "")
        + f", fuel factor {fuel_factor:.2f}."
    )

    return fair_value, "heuristic-depreciation-model", "low", reasoning


async def _try_ollama(listing: Listing) -> tuple[float, str, str, str]:
    """Single attempt to get valuation from Ollama. Raises on any failure."""
    car = listing.car
    async with httpx.AsyncClient(timeout=3.0) as client:
        await client.get(f"{settings.ollama_base_url}/api/tags")

    llm = Ollama(
        base_url=settings.ollama_base_url,
        model=settings.valuation_model,
        temperature=0.1,
        timeout=settings.valuation_timeout_seconds,
    )

    chain = _VALUATION_PROMPT | llm | StrOutputParser()
    raw = await chain.ainvoke({
        "make": car.make,
        "model": car.model,
        "variant": car.variant or "base",
        "year": car.year,
        "fuel_type": car.fuel_type.value if car.fuel_type else "unknown",
        "transmission": car.transmission.value if car.transmission else "unknown",
        "body_type": car.body_type.value if car.body_type else "unknown",
        "engine_cc": car.engine_cc or "unknown",
        "km_driven": listing.km_driven or 0,
        "owners_count": listing.owners_count or 1,
        "condition": listing.condition.value if listing.condition else "unknown",
        "registration_state": listing.registration_state or "unknown",
        "city": listing.city or "unknown",
        "listing_type": listing.listing_type.value,
        "asking_price": int(listing.price),
    })

    json_match = re.search(r"\{.*?\}", raw, re.DOTALL)
    if not json_match:
        raise ValueError("No JSON in LLM response")

    data = json.loads(json_match.group())
    fair_value = round(float(data["fair_value"]) / 1000) * 1000
    confidence = data.get("confidence", "medium")
    reasoning = data.get("reasoning", "LLM-based market analysis.")
    return fair_value, f"llama3:{settings.valuation_model}", confidence, reasoning


async def estimate_valuation(listing: Listing) -> tuple[float, str, str, str]:
    """
    Returns (fair_value_inr, method, confidence, reasoning).
    Tries Ollama with up to 2 retries (exponential backoff); circuit breaker
    opens after 3 consecutive failures and stays open for 60 s.
    Falls back to heuristic depreciation model on any Ollama error.
    """
    global _cb_failures, _cb_open_until

    latency_hist, fallback_counter = _metrics()

    if time.monotonic() < _cb_open_until:
        logger.info("Ollama circuit breaker open, using heuristic fallback")
        fallback_counter.inc()
        t0 = time.monotonic()
        result = _heuristic_valuation(listing)
        latency_hist.labels(method="heuristic").observe(time.monotonic() - t0)
        return result

    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            t0 = time.monotonic()
            result = await _try_ollama(listing)
            latency_hist.labels(method="ollama").observe(time.monotonic() - t0)
            _cb_failures = 0
            return result
        except Exception as exc:
            last_exc = exc
            if attempt < 2:
                await asyncio.sleep(2 ** attempt)

    _cb_failures += 1
    if _cb_failures >= _CB_THRESHOLD:
        _cb_open_until = time.monotonic() + _CB_COOLDOWN
        logger.warning("Ollama circuit breaker opened for %.0fs (failures=%d)", _CB_COOLDOWN, _cb_failures)

    logger.warning("Ollama failed after retries (%s), using heuristic fallback", last_exc)
    fallback_counter.inc()
    t0 = time.monotonic()
    result = _heuristic_valuation(listing)
    latency_hist.labels(method="heuristic").observe(time.monotonic() - t0)
    return result
