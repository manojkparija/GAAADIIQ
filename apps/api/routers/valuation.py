"""Used-car valuation for a vehicle the seller describes, before it is listed.

WHY THIS EXISTS

The `list-car` page used to call a Supabase Edge Function directly from the
browser — `supabase.client.functions.invoke('ai-valuation')` — and that function
called Anthropic with its own `ANTHROPIC_API_KEY`. Three consequences, none of
them visible from the page:

  * It bypassed `services/gemini_gateway.py`, and with it the single place a
    timeout, a 429 retry, a model choice and a record that a call happened can
    be enforced.
  * It was a second model provider and a second API key, in a second place,
    monitored by nothing in this repository's CI.
  * It appeared in no architecture document, so nobody reviewing the diagram
    would know a second AI path existed.

This endpoint does the same job through the route everything else uses:
UI → API → gateway → model.

WHAT IT DOES NOT DO

It does not invent a number when the model is unavailable. `GeminiUnavailable`
comes back as a 503 and the client falls back to its own shared heuristic
(`utils/valuation-engine.ts`), which is deterministic and labelled as an
estimate. A fabricated price presented as a model's valuation is
indistinguishable from a real one at the point a seller reads it.
"""

import json
import logging
import re
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from core.dependencies import get_optional_user
from core.limiter import limiter
from models.user import User
from services import gemini_gateway

logger = logging.getLogger("gaadiiq.valuation")

router = APIRouter(prefix="/valuation", tags=["valuation"])

OptionalUser = Annotated[User | None, Depends(get_optional_user)]

_FUELS = "Petrol|Diesel|CNG|Electric|Hybrid|LPG"
_CONDITIONS = "Excellent|Good|Fair|Poor"


class ValuationRequest(BaseModel):
    make: str = Field(..., min_length=1, max_length=60)
    model: str = Field(..., min_length=1, max_length=60)
    variant: str | None = Field(None, max_length=80)
    year: int = Field(..., ge=1990, le=2030)
    km: int = Field(..., ge=0, le=2_000_000)
    fuel: str = Field(..., pattern=f"^({_FUELS})$")
    transmission: str | None = Field(None, max_length=30)
    owners: int = Field(1, ge=1, le=10)
    condition: str = Field("Good", pattern=f"^({_CONDITIONS})$")


class ValuationResponse(BaseModel):
    low: int
    mid: int
    high: int
    confidence: int
    depreciation: int
    marketTrend: str
    tips: list[str]
    method: str


def _build_prompt(body: ValuationRequest) -> str:
    """The valuation prompt.

    Fields are interpolated from a validated model, not from raw request text —
    every one of them is constrained by the schema above, so there is no free
    prose reaching the prompt from the client.
    """
    age = datetime.now(timezone.utc).year - body.year
    notes = []
    if body.fuel == "Electric":
        notes.append(
            "EVs have strong demand but battery health uncertainty — factor both in."
        )
    if body.fuel == "Diesel":
        notes.append(
            "Diesel demand is softening in metros because of BS6 and EV adoption."
        )

    return f"""You are a used-car valuation specialist for the Indian market.

Vehicle:
- Make: {body.make}
- Model: {body.model}
- Variant: {body.variant or "Unknown"}
- Year: {body.year} ({age} years old)
- Odometer: {body.km:,} km
- Fuel: {body.fuel}
- Transmission: {body.transmission or "Unknown"}
- Owners: {body.owners}
- Condition: {body.condition}

Return ONLY valid JSON with exactly this shape, no markdown fences:
{{
  "low": <lowest fair market price in INR, integer>,
  "mid": <fair market price in INR, integer>,
  "high": <optimistic price in INR, integer>,
  "confidence": <90 if the variant is known, 82 if only the model is, else 75>,
  "depreciation": <total depreciation percentage, integer>,
  "marketTrend": "<one short observation about this model and fuel in India>",
  "tips": ["<tip>", "<tip>", "<tip>"]
}}

Rules:
- Base the valuation on actual Indian used-car market prices.
- Account for state RTO depreciation schedules.
- `low` about 10-15% below `mid`; `high` about 10-15% above.
- Tips must be specific and actionable for an Indian seller.
{chr(10).join("- " + n for n in notes)}"""


def _parse(raw: str) -> dict:
    """Read the model's JSON, tolerating fences it was told not to emit."""
    text = re.sub(r"^```(?:json)?\s*", "", raw.strip())
    text = re.sub(r"\s*```$", "", text).strip()
    return json.loads(text)


@router.post("/estimate", response_model=ValuationResponse)
@limiter.limit("10/minute;60/hour")
async def estimate(request: Request, body: ValuationRequest, user: OptionalUser):
    """Value a vehicle from its description.

    Open to signed-out sellers — the page that uses it is the first thing
    somebody sees when listing a car, and requiring an account to find out what
    the car is worth is the wrong order.
    """
    if not gemini_gateway.is_available():
        # Not an error to hide: the client has a deterministic heuristic and
        # will use it. Saying so plainly is better than returning a number this
        # service did not compute.
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Valuation model is not configured.",
        )

    try:
        raw = await gemini_gateway.generate_text(
            _build_prompt(body),
            caller="valuation",
            temperature=0.2,
            json_response=True,
            max_output_tokens=1024,
        )
        data = _parse(raw)
    except gemini_gateway.RateLimited as exc:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Valuation is busy — try again shortly."
        ) from exc
    except gemini_gateway.GeminiError as exc:
        logger.warning("Valuation model failed: %s", exc)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Valuation is unavailable."
        ) from exc
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("Valuation returned unparseable JSON: %s", exc)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Valuation is unavailable."
        ) from exc

    try:
        return ValuationResponse(
            low=int(data["low"]),
            mid=int(data["mid"]),
            high=int(data["high"]),
            confidence=int(data.get("confidence", 75)),
            depreciation=int(data.get("depreciation", 0)),
            marketTrend=str(data.get("marketTrend", ""))[:200],
            tips=[str(t)[:300] for t in (data.get("tips") or [])][:5],
            method="gemini",
        )
    except (KeyError, TypeError, ValueError) as exc:
        # A response missing `mid` is not a valuation. Falling through to the
        # client's heuristic is the honest outcome.
        logger.warning("Valuation response was the wrong shape: %s", exc)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Valuation is unavailable."
        ) from exc
