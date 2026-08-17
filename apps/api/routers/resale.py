"""
Resale forecast — projected resale value for each year of ownership.

POST /resale/forecast — year-by-year resale curve for a car

Public, because it sits on the car detail page and the whole point is that a
buyer can see it before deciding to sign up.
"""
# NOTE: deliberately NOT using `from __future__ import annotations` — PEP 563
# turns annotations into strings and slowapi's @limiter.limit wrapper then
# leaves FastAPI unable to resolve the Pydantic body, so every request 422s.
# Same reason as routers/diagnosis.py.

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from core.limiter import limiter
from services.resale_forecast import (
    DEFAULT_YEARS,
    MAX_YEARS,
    ai_forecast,
    heuristic_forecast,
)
from services.wholesale_forecast import wholesale_forecast

router = APIRouter(prefix="/resale", tags=["resale"])


class ForecastRequest(BaseModel):
    make: str = Field(default="", max_length=60)
    model: str = Field(default="", max_length=80)
    variant: str = Field(default="", max_length=80)
    year: int = Field(default=0, ge=1980, le=2100)
    fuel: str = Field(default="Petrol", max_length=20)
    transmission: str = Field(default="", max_length=20)
    price: int = Field(gt=0, le=100_000_000)
    years: int = Field(default=DEFAULT_YEARS, ge=1, le=MAX_YEARS)
    # Opt in to the model call. The instant heuristic covers page load; the AI
    # curve is requested only when the user asks for it, so a car detail view
    # never silently spends a Gemini call.
    use_ai: bool = False


class ForecastYear(BaseModel):
    year: int
    value: int
    retained_pct: float
    note: str = ""


class ForecastResponse(BaseModel):
    forecast: list[ForecastYear]
    summary: str = ""
    # "ai" | "heuristic" — the UI must be able to label the source, and a
    # projection shown without provenance is a claim we cannot support.
    source: str


@router.post("/forecast", response_model=ForecastResponse)
@limiter.limit("20/minute")
async def forecast(request: Request, body: ForecastRequest) -> ForecastResponse:
    """
    Project resale value for each of the next N years.

    Falls back to the heuristic curve whenever the AI path is not asked for,
    not configured, or returns something that fails validation — the response
    shape is identical either way, so the caller never has to handle an
    "unavailable" case.
    """
    age = 0
    if body.year:
        from datetime import datetime  # noqa: PLC0415 — local, keeps import list flat

        age = max(0, datetime.now().year - body.year)

    if body.use_ai:
        rows, summary = await ai_forecast(
            make=body.make,
            model=body.model,
            variant=body.variant,
            year=body.year,
            fuel=body.fuel,
            transmission=body.transmission,
            price=body.price,
            years=body.years,
        )
        if rows:
            return ForecastResponse(
                forecast=[ForecastYear(**r) for r in rows],
                summary=summary,
                source="ai",
            )

    rows = heuristic_forecast(
        price=body.price, fuel=body.fuel, years=body.years, age=age
    )
    return ForecastResponse(
        forecast=[ForecastYear(**r) for r in rows], summary="", source="heuristic"
    )


class WholesaleRequest(BaseModel):
    """What a dealer needs: today's retail value and how old the car is."""

    price: int = Field(gt=0, le=100_000_000, description="Retail value today")
    age_years: int = Field(default=0, ge=0, le=60)


@router.post("/wholesale")
@limiter.limit("30/minute")
async def wholesale(request: Request, body: WholesaleRequest) -> dict:
    """
    Trade value now and at 30, 60 and 90 days.

    Separate from the retail curve above for two reasons: a dealer selling into
    the trade gets less than a private buyer pays, and their horizon is the
    next quarter rather than the next three years.

    Every response carries its own basis. The trade discount is a market
    convention, not a figure measured from sales on this platform — there are
    none to measure — and the projection is depreciation only, with no view on
    seasonal demand or a coming facelift.
    """
    return wholesale_forecast(body.price, body.age_years)
