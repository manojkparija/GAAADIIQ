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
from dataclasses import dataclass

from services import gemini_gateway

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
    return gemini_gateway.is_available()


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


def _feature_text(item: object) -> str:
    """
    One feature as a short phrase, whatever shape the model returned it in.

    The prompt asks for a list of strings and usually gets one. Sometimes it
    returns a list of objects instead — [{"feature": "Head-Up Display"}] — and
    str() on that yields the literal "{\'feature\': \'Head-Up Display\'}",
    which is what buyers were shown on the Features tab. Reported from UAT as
    "it looks not good", which undersells it: the page was displaying a Python
    dict repr as a selling point.

    A dict is unwrapped rather than rejected: the phrase inside it is the
    answer, and throwing away a whole trim's features because the model chose
    objects over strings loses real information to a formatting difference.
    """
    if isinstance(item, str):
        return item.strip()

    if isinstance(item, dict):
        # The usual keys, then any single value, before giving up. Ordered so a
        # deliberate key wins over a lucky one.
        for key in ("feature", "name", "label", "title", "value", "text"):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        values = [v for v in item.values() if isinstance(v, str) and v.strip()]
        if len(values) == 1:
            return values[0].strip()
        return ""

    # A number or a bool is not a feature, and its str() would read as one.
    if isinstance(item, (int, float, bool)) or item is None:
        return ""

    return str(item).strip()


def _clean_features(value: object, limit: int = 6) -> list[str]:
    if not isinstance(value, list):
        return []
    cleaned = (_feature_text(f)[:80] for f in value[:limit])
    return [f for f in cleaned if f]


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


@dataclass(frozen=True)
class ResearchOutcome:
    """
    What happened, not just what came back.

    Three states used to arrive as the same empty list, and the admin screen
    reported all of them as "Nothing new found. Trims already recorded are
    left alone." — which is true of exactly one of them:

      - no API key: the model was never asked
      - the call failed: quota, a revoked key, a network error
      - the model answered and had nothing to add

    Reported as "nothing found", the first two look like a settled fact about
    the car rather than a broken shortcut, and an admin waits for a feature
    that is never coming.
    """

    drafts: list[dict]
    #: Set when research could not be attempted at all — no key configured.
    unavailable: bool = False
    #: Set when it was attempted and failed. Carries the provider's own words.
    error: str | None = None

    @property
    def ok(self) -> bool:
        return not self.unavailable and self.error is None


async def research_variants_detailed(make: str, model: str, year: int) -> ResearchOutcome:
    """
    Draft trims for a model, saying which of the three outcomes occurred.

    Still never raises. The caller decides what to tell the reader; a shortcut
    that fails must leave the manual form working rather than replace it with
    an error page.
    """
    if not available():
        logger.info("Variant research skipped: no Gemini API key configured")
        return ResearchOutcome(drafts=[], unavailable=True)

    prompt = PROMPT.format(make=make, model=model, year=year, limit=MAX_VARIANTS)

    try:
        text = await gemini_gateway.generate_text(
            prompt,
            caller="variant research",
            # These are facts with right answers, so sampling is not wanted.
            temperature=0.0,
        )
        return ResearchOutcome(drafts=_clean(json.loads(text)))
    except Exception as exc:
        logger.warning("Variant research failed for %s %s %s: %s", make, model, year, exc)
        # The provider's message, not a summary of it: "API key not valid" and
        # "quota exceeded" need different actions from whoever reads this.
        return ResearchOutcome(drafts=[], error=f"{type(exc).__name__}: {exc}")


async def research_variants(make: str, model: str, year: int) -> list[dict]:
    """
    Drafts alone, for callers that have nothing useful to say about failure.

    Kept so the three existing call sites are unchanged. Anything that shows a
    human the result should use research_variants_detailed instead.
    """
    return (await research_variants_detailed(make, model, year)).drafts


MODEL_PROMPT = """\
Give the specification and feature list for the {year} {make} {model} sold new \
in India.

Return JSON only, matching exactly:

{{"specs": [{{"label": "Engine", "value": "1.0L K10C"}},
           {{"label": "Power", "value": "67 PS"}}],
  "features": ["6 Airbags", "Touchscreen infotainment"]}}

Rules:
- specs: at most {spec_limit} label/value pairs, covering engine, power, torque,
  mileage, transmission, boot space, fuel and safety rating where known.
- Both label and value are short strings. Omit any pair you are not confident
  about rather than guessing — a person will read these as fact.
- features: at most {feature_limit} short phrases, the ones a buyer would
  compare across models.
- If you do not know this model, return {{"specs": [], "features": []}}. Do not
  substitute a similar car.
"""

MAX_SPECS = 12
MAX_FEATURES = 16


def _clean_specs(raw: object) -> list[dict]:
    """Label/value pairs, both non-empty strings, bounded in number."""
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw[:MAX_SPECS]:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()
        value = str(item.get("value") or "").strip()
        if label and value:
            out.append({"label": label[:60], "value": value[:80]})
    return out


async def research_model_details(make: str, model: str, year: int) -> dict:
    """
    A model's specification and features, or empty lists.

    Same bargain as research_variants: this drafts, a person checks. Never
    raises — an admin pressing a research button on a screen that also has a
    manual path should get the manual path back, not an error.
    """
    if not available():
        return {"specs": [], "features": []}

    prompt = MODEL_PROMPT.format(
        make=make, model=model, year=year,
        spec_limit=MAX_SPECS, feature_limit=MAX_FEATURES,
    )
    try:
        text = await gemini_gateway.generate_text(
            prompt,
            caller="variant specs",
            temperature=0.0,
        )
        raw = json.loads(text)
        if not isinstance(raw, dict):
            return {"specs": [], "features": []}
        return {
            "specs": _clean_specs(raw.get("specs")),
            # Same unwrapping as the per-trim path: this one had its own copy
            # of the str() call and so its own copy of the bug.
            "features": _clean_features(raw.get("features"), limit=MAX_FEATURES),
        }
    except Exception as exc:
        logger.warning("Model detail research failed for %s %s: %s", make, model, exc)
        return {"specs": [], "features": []}
