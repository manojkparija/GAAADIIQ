"""
AI Valuation Service — estimates fair market price for a car listing.

Primary:  LangChain + Ollama (llama3) — structured prompt → JSON price estimate.
Fallback: Rule-based heuristic when Ollama is unavailable (dev / cold start).
"""
import json
import logging
import re
from datetime import datetime

import httpx
from langchain_community.llms.ollama import Ollama
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate

from core.config import settings
from models.listing import Listing

logger = logging.getLogger(__name__)

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


def _heuristic_valuation(listing: Listing) -> tuple[float, str]:
    """
    Rule-based fallback when Ollama is unavailable.
    Applies standard Indian car depreciation model.
    """
    car = listing.car
    age = datetime.now().year - car.year

    # Base: asking price adjusted by age depreciation
    base = float(listing.price)

    # Standard depreciation: ~15% first year, ~10% subsequent years
    if age <= 0:
        depreciation = 0.0
    elif age == 1:
        depreciation = 0.15
    else:
        depreciation = 0.15 + (min(age - 1, 9) * 0.10)

    depreciation = min(depreciation, 0.70)  # cap at 70% total depreciation

    # Mileage penalty: >15K km/year adds extra 2% per 10K excess
    if listing.km_driven and age > 0:
        expected_km = age * 15000
        excess_km = max(0, listing.km_driven - expected_km)
        mileage_penalty = (excess_km // 10000) * 0.02
    else:
        mileage_penalty = 0.0

    # Fuel premium: EVs and hybrids hold value better
    fuel_factor = {
        "electric": 1.05,
        "hybrid": 1.02,
        "petrol": 1.00,
        "cng": 0.97,
        "diesel": 0.98,
    }.get(car.fuel_type.value if car.fuel_type else "petrol", 1.00)

    # Owners penalty
    owner_penalty = (listing.owners_count or 1) * 0.03 if listing.listing_type.value == "used" else 0.0

    fair_value = base * (1 - depreciation - mileage_penalty - owner_penalty) * fuel_factor
    fair_value = max(fair_value, base * 0.25)  # floor: 25% of asking price
    fair_value = round(fair_value / 1000) * 1000  # round to nearest ₹1000

    return fair_value, "heuristic-depreciation-model"


async def estimate_valuation(listing: Listing) -> tuple[float, str]:
    """
    Returns (fair_value_inr, method_used).
    Tries Ollama first; falls back to heuristic on any error.
    """
    car = listing.car

    try:
        # Quick reachability check before spinning up LangChain
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

        # Extract JSON from the response (model may add extra text)
        json_match = re.search(r"\{.*?\}", raw, re.DOTALL)
        if not json_match:
            raise ValueError("No JSON in LLM response")

        data = json.loads(json_match.group())
        fair_value = float(data["fair_value"])
        confidence = data.get("confidence", "medium")
        return round(fair_value / 1000) * 1000, f"llama3-{confidence}"

    except Exception as exc:
        logger.warning("Ollama unavailable (%s), using heuristic fallback", exc)
        return _heuristic_valuation(listing)
