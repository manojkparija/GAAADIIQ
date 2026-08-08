"""
Ask a language model what trims a car is sold in.

Typing out every variant of every model by hand is the reason the catalogue had
seven models' worth and nothing else. A model that has read the manufacturer's
site, a dozen review sites and a hundred brochures can draft the list in
seconds.

It can also state a price that is confidently, specifically wrong. So nothing
here publishes: every trim it returns is a draft, and an admin reads it before
a buyer does. That is the same bargain the brochure pipeline already makes —
the machine proposes, a person disposes — and it is the only honest one when
the output is a number somebody budgets against.

Returns [] rather than raising when Gemini is unconfigured or unreachable. A
research feature that is unavailable must leave the admin exactly where they
were, with an empty draft list and a manual form, not an error page.
"""
import json
import logging

import httpx

from core.config import settings

logger = logging.getLogger("gaadiiq.variant_research")

# Enough to cover a range with many trims and fuel options without inviting a
# model to pad the list to fill a quota.
MAX_VARIANTS = 25

PROMPT = """\
List the factory trim levels (variants) of the {year} {make} {model} sold new \
in India.

Return JSON only, matching exactly:

{{"variants": [
  {{"name": "VXi",
    "ex_showroom_price": 549000,
    "fuel_type": "Petrol",
    "transmission": "Manual",
    "engine_cc": 998,
    "seating_capacity": 5,
    "mileage": "24.76 km/l",
    "features": ["Touchscreen", "6 Airbags"]}}
]}}

Rules:
- ex_showroom_price is the manufacturer's published Indian ex-showroom price in
  rupees, as a plain number: 549000, not "5.49 Lakh" and not a range.
- Use null for any field you are not confident about. A null is useful; an
  invented figure is worse than nothing, because a person will read it as fact.
- name is the trim as the manufacturer writes it, without the make or model in
  it: "ZXi+ AMT", not "Maruti Suzuki Swift ZXi+ AMT".
- List trims in the manufacturer's own order, base first.
- features: at most six per trim, the ones that distinguish it from the trim
  below it.
- If you do not know this model, return {{"variants": []}}. Do not substitute a
  similar car.
- At most {limit} trims.
"""


def available() -> bool:
    """Whether research can be attempted at all."""
    return bool(settings.gemini_api_key)


def _clean_price(value: object) -> float | None:
    """
    A price the model may have written as a string, a range, or a lakh figure.

    Rejecting rather than guessing on anything unexpected: a trim with no price
    is an obvious gap an admin will fill, while a mis-parsed one looks correct.
    """
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        price = float(value)
    elif isinstance(value, str):
        digits = "".join(c for c in value if c.isdigit() or c == ".")
        if not digits or digits.count(".") > 1:
            return None
        price = float(digits)
    else:
        return None

    # A new car in India between one lakh and five crore. Outside that the
    # model has answered in lakhs, in another currency, or from imagination.
    return price if 100_000 <= price <= 50_000_000 else None


def _clean_features(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(f).strip() for f in value[:6] if str(f).strip()]


def _clean_int(value: object, ceiling: int) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = int(value)
    return number if 0 < number <= ceiling else None


def _clean(raw: object) -> list[dict]:
    """Keep only what has a usable name; everything else is per-field."""
    if not isinstance(raw, dict):
        return []
    variants = raw.get("variants")
    if not isinstance(variants, list):
        return []

    cleaned: list[dict] = []
    seen: set[str] = set()
    for item in variants[:MAX_VARIANTS]:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        # The unique index is on the lower-cased name, so a duplicate here would
        # fail the insert for the whole batch rather than for itself.
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())

        cleaned.append({
            "name": name[:160],
            "ex_showroom_price": _clean_price(item.get("ex_showroom_price")),
            "fuel_type": (str(item["fuel_type"])[:40] if item.get("fuel_type") else None),
            "transmission": (str(item["transmission"])[:40] if item.get("transmission") else None),
            "engine_cc": _clean_int(item.get("engine_cc"), 10_000),
            "seating_capacity": _clean_int(item.get("seating_capacity"), 20),
            "mileage": (str(item["mileage"])[:40] if item.get("mileage") else None),
            "features": _clean_features(item.get("features")),
        })
    return cleaned


async def research_variants(make: str, model: str, year: int) -> list[dict]:
    """
    Draft trims for a model, or [] if research is unavailable or fruitless.

    Never raises: the caller is an admin screen offering a shortcut, and a
    shortcut that fails should leave the manual form working rather than
    replace it with an error.
    """
    if not available():
        logger.info("Variant research skipped: no Gemini API key configured")
        return []

    prompt = PROMPT.format(make=make, model=model, year=year, limit=MAX_VARIANTS)
    url = (
        f"{settings.gemini_api_url.rstrip('/')}/models/"
        f"{settings.gemini_model}:generateContent"
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            # These are facts with right answers, so sampling is not wanted.
            "temperature": 0.0,
            "responseMimeType": "application/json",
        },
    }

    try:
        async with httpx.AsyncClient(timeout=settings.gemini_timeout_seconds) as client:
            resp = await client.post(
                url, params={"key": settings.gemini_api_key}, json=payload
            )
            resp.raise_for_status()
            body = resp.json()

        candidates = body.get("candidates") or []
        parts = (candidates[0].get("content") or {}).get("parts") or [] if candidates else []
        text = "".join(p.get("text", "") for p in parts).strip()
        if not text:
            logger.warning("Variant research returned no text for %s %s", make, model)
            return []

        return _clean(json.loads(text))
    except Exception as exc:
        logger.warning("Variant research failed for %s %s %s: %s", make, model, year, exc)
        return []
