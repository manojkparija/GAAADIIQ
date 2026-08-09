"""
Year-by-year resale forecast — what a car is worth each year you keep it.

The Cost of Ownership tab already showed a single depreciation figure, which
answers "what does this cost me a year" but not the question buyers actually
ask: *if I sell after three years, what do I get back?* This produces the whole
curve instead of one number.

Two sources, in order:

  Gemini — knows model-specific resale behaviour that no rate table captures:
    a Creta holds value, a diesel hatchback in a metro does not, an EV's curve
    bends around battery-warranty expiry. This is the part worth asking a model
    about.

  Heuristic — a tiered depreciation curve (steep first year, flat middle,
    steeper again past year 7) adjusted for fuel type. Always available, always
    instant, and the answer when Gemini has no key, times out, or replies with
    something unusable.

Every forecast says which source produced it, because a projection presented
without that is a claim the site cannot stand behind. The frontend labels the
AI-sourced curve differently for the same reason.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

import httpx

from core.config import settings

logger = logging.getLogger("gaadiiq.resale_forecast")

# Beyond this the projection is fiction — cars this old are priced by condition
# and service history, not by a curve.
MAX_YEARS = 10
DEFAULT_YEARS = 5

# Marginal depreciation applied to the *remaining* value in each year of
# ownership. Year 1 is the cliff (drive-off loss), years 2-5 settle, and the
# curve steepens again as the car approaches the age where buyers start
# discounting for major service items.
_BASE_CURVE = [0.15, 0.11, 0.10, 0.09, 0.09, 0.08, 0.08, 0.09, 0.10, 0.10]

# Fuel-type multiplier on the yearly rate. Diesel resale has softened in metros
# under NCR-style age limits; EVs depreciate faster while the tech moves and
# battery warranties dominate buyer confidence; CNG sits mid-pack.
_FUEL_FACTOR: dict[str, float] = {
    "Petrol": 1.00,
    "Diesel": 1.06,
    "CNG": 1.10,
    "Electric": 1.28,
    "Hybrid": 0.94,
}

# A car is never worth nothing while it runs. Without a floor the compounding
# curve trends to zero and the ten-year figure becomes absurd.
_FLOOR_FRACTION = 0.10


def gemini_available() -> bool:
    """True when a Gemini key is configured."""
    return bool(settings.gemini_api_key)


def heuristic_forecast(
    price: int,
    fuel: str,
    years: int = DEFAULT_YEARS,
    age: int = 0,
) -> list[dict]:
    """
    The fallback curve: compounding marginal depreciation, floored.

    `price` is what the car is worth TODAY — the ex-showroom price of a new car,
    or the asking price of a used one. The projection always starts from there.

    `age` only decides where on the curve to start, because depreciation slows
    as a car gets older: a 5-year-old car loses roughly 9% of its value in the
    next year, where a new one loses 15% driving out of the showroom. It must
    not also discount the price — for a used listing the asking price has
    already absorbed those years, and applying them again would forecast a car
    that lost half its value before the projection began.
    """
    years = max(1, min(years, MAX_YEARS))
    factor = _FUEL_FACTOR.get(fuel, 1.00)
    floor = price * _FLOOR_FRACTION

    value = float(price)
    out: list[dict] = []
    for n in range(1, years + 1):
        idx = min(age + n - 1, len(_BASE_CURVE) - 1)
        rate = _BASE_CURVE[idx] * factor
        value = max(value * (1 - rate), floor)
        out.append(
            {
                "year": n,
                "value": int(round(value)),
                "retained_pct": round(value / price * 100, 1) if price else 0.0,
            }
        )
    return out


_PROMPT = """You are an Indian used-car pricing analyst. Project the resale \
value of this car for each of the next {years} years, as it would actually \
trade in the Indian used-car market.

Car:
- Make and model: {make} {model}
- Variant: {variant}
- Manufacturing year: {year} (so it is {age} years old today)
- Fuel: {fuel}
- Transmission: {transmission}
- Price when new (ex-showroom): Rs {price}

Account for how THIS model behaves, not just generic depreciation: brand \
resale reputation, demand for this body style, fuel-type trends (diesel age \
limits in NCR-type markets, EV battery-warranty effects), and any known \
generation change that would date this model.

Rules:
- value is the expected private-sale price in rupees, as a plain integer. No \
commas, no "lakh", no ranges.
- Values must decrease every year.
- Year 1 means one year from today, not one year from manufacture.
- note is at most 8 words, and only where something model-specific drives that \
year's number. Otherwise use an empty string.
- If you do not know this model, return {{"forecast": []}}. Do not substitute a \
similar car.

Respond ONLY with JSON in exactly this shape:
{{"forecast": [{{"year": 1, "value": 0, "note": ""}}], "summary": "<one \
sentence on this model's resale character>"}}"""


def _clean(raw: dict, price: int, years: int) -> tuple[list[dict], str]:
    """
    Keep only a forecast that is internally consistent.

    A model that returns rising values, values above the car's new price, or
    junk in place of an integer has not answered the question, and a plausible
    looking wrong curve is worse here than an honest heuristic — someone may
    price a real sale off it.
    """
    rows = raw.get("forecast")
    if not isinstance(rows, list) or not rows:
        return [], ""

    cleaned: list[dict] = []
    previous = float(price)
    for n, row in enumerate(rows[:years], start=1):
        if not isinstance(row, dict):
            return [], ""
        try:
            value = int(float(row.get("value")))
        except (TypeError, ValueError):
            return [], ""
        # Monotonic and bounded, or the whole curve is discarded.
        if value <= 0 or value > previous:
            return [], ""
        note = row.get("note")
        cleaned.append(
            {
                "year": n,
                "value": value,
                "retained_pct": round(value / price * 100, 1) if price else 0.0,
                "note": (note or "").strip()[:60] if isinstance(note, str) else "",
            }
        )
        previous = value

    if len(cleaned) < years:
        # A short answer is a partial answer; the caller asked for a full curve.
        return [], ""

    summary = raw.get("summary")
    return cleaned, (summary or "").strip()[:200] if isinstance(summary, str) else ""


async def ai_forecast(
    make: str,
    model: str,
    variant: str,
    year: int,
    fuel: str,
    transmission: str,
    price: int,
    years: int = DEFAULT_YEARS,
) -> tuple[list[dict], str]:
    """
    Gemini's projection, or ([], "") if unavailable or unusable.

    Never raises: the caller always has the heuristic to fall back to, and a
    resale estimate is not worth failing a page render over.
    """
    if not gemini_available():
        return [], ""

    age = max(0, datetime.now().year - int(year or 0))
    prompt = _PROMPT.format(
        years=years,
        make=make,
        model=model,
        variant=variant or "base",
        year=year,
        age=age,
        fuel=fuel or "Petrol",
        transmission=transmission or "Manual",
        price=price,
    )

    url = (
        f"{settings.gemini_api_url.rstrip('/')}/models/"
        f"{settings.gemini_model}:generateContent"
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.0,
            "responseMimeType": "application/json",
        },
    }

    try:
        async with httpx.AsyncClient(timeout=settings.gemini_timeout_seconds) as client:
            resp = await client.post(url, params={"key": settings.gemini_api_key}, json=payload)
            resp.raise_for_status()
            body = resp.json()
        text = (
            body.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
        )
        if not text:
            logger.warning("Resale forecast returned no text for %s %s", make, model)
            return [], ""
        return _clean(json.loads(text), price, years)
    except Exception as exc:
        logger.warning("Resale forecast failed for %s %s: %s", make, model, exc)
        return [], ""
