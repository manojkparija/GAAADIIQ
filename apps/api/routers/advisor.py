"""
POST /advisor/brief — one sentence in, a shortlist with real numbers out.

The existing /recommend endpoint scores *listings*: specific used cars a
seller has advertised. This answers the other question — "I have twelve lakh,
family of five, which car should I buy?" — which is about the catalogue, not
about one seller's advert, and which needs a trim recommendation because
"buy a Nexon" is not an answer a buyer can act on. A Nexon spans several lakh
across its trims.

Three deliberate constraints:

  Nothing is invented. Cars come from the catalogue, trims from published
  variants, and every cost line carries its provenance from
  services.ownership_cost. Where a figure cannot be worked out the response
  says so instead of substituting a plausible one.

  Nothing is defaulted. A requirement the buyer did not state is returned in
  `missing` for the caller to ask about. Assuming a family of four and
  recommending on it produces a confident answer to a question nobody asked.

  Draft trims never appear. A price nobody has vouched for must not reach a
  buyer who is about to budget against it — the same rule the variants admin
  screen enforces.

No `from __future__ import annotations` here: it breaks FastAPI's signature
introspection and body params start being read as query params.
"""

import uuid

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.limiter import limiter
from db.session import get_db
from models.car import Car
from models.car_variant import CarVariant, VariantStatus
from services import ownership_cost, resale_forecast
from services.buyer_brief import BuyerNeed, parse_query

router = APIRouter(prefix="/advisor", tags=["advisor"])

# Three, because the request asked for three and because a shortlist a person
# can hold in their head is the point of the feature. More is a search result.
SHORTLIST_SIZE = 3

# How far over a stated ceiling a car may sit and still be shown, flagged. A
# buyer who says twelve lakh will look at a twelve-six car; they will not
# thank you for a sixteen.
_BUDGET_TOLERANCE = 0.08


# ── Schemas ───────────────────────────────────────────────────────────────────


class BriefRequest(BaseModel):
    query: str = Field(..., max_length=500, description="What the buyer typed, in their words")
    #: Set when the caller has already asked the buyer for a missing field.
    km_per_month: int | None = Field(None, ge=1, le=20_000)
    seats: int | None = Field(None, ge=1, le=10)


class CostLine(BaseModel):
    label: str
    amount: int | None
    basis: str
    note: str


class VariantPick(BaseModel):
    id: str
    name: str
    ex_showroom_price: int | None
    fuel_type: str | None
    transmission: str | None
    seating_capacity: int | None
    mileage: str | None
    #: Why this trim rather than the one above or below it.
    reason: str
    #: Trims of the same model that the budget does not reach.
    priced_out: list[str] = []


class Recommendation(BaseModel):
    car_id: str
    make: str
    model: str
    year: int
    body_type: str | None
    match_score: int
    reasons: list[str]
    concerns: list[str]
    variant: VariantPick | None
    monthly_emi: CostLine
    five_year: list[CostLine]
    five_year_total: int
    five_year_excludes: list[str]
    cost_per_km: float | None
    resale_five_year: int | None
    resale_source: str


class BriefResponse(BaseModel):
    request_id: str
    #: Plain-language echo of what was read, so a buyer can correct it.
    understood: list[str]
    #: Requirements the sentence did not state.
    missing: list[str]
    items: list[Recommendation]
    total_considered: int
    assumptions: dict
    #: Set when nothing usable could be read, or nothing matched.
    message: str | None = None


# ── Trim selection ────────────────────────────────────────────────────────────


def _price_of(variant: CarVariant) -> int | None:
    return int(variant.ex_showroom_price) if variant.ex_showroom_price is not None else None


def _pick_variant(variants: list[CarVariant], need: BuyerNeed) -> tuple[CarVariant | None, str, list[str]]:
    """
    The best trim the budget reaches, and what it ruled out.

    "Best" is the most expensive affordable trim, because trims are ordered by
    equipment and a buyer with headroom wants the equipment. Where no ceiling
    was stated there is nothing to rank against, so the base trim is returned
    as the entry price — the honest reading of "what does this cost".
    """
    priced = [(v, p) for v in variants if (p := _price_of(v)) is not None]
    if not priced:
        return None, "", []

    ceiling = need.budget_max
    if ceiling is None:
        cheapest = min(priced, key=lambda item: item[1])
        return (
            cheapest[0],
            "Entry trim — you did not state a ceiling, so this is where the model starts.",
            [],
        )

    limit = ceiling * (1 + _BUDGET_TOLERANCE)
    affordable = [(v, p) for v, p in priced if p <= limit]
    if not affordable:
        return None, "", [v.name for v, _ in priced]

    best, best_price = max(affordable, key=lambda item: item[1])
    out_of_reach = [v.name for v, p in priced if p > limit]

    if len(affordable) == len(priced):
        reason = "Top trim, and your budget covers it."
    elif best_price > ceiling:
        reason = (
            f"Best-equipped trim within reach, ₹{best_price - ceiling:,} over your "
            "stated budget."
        )
    else:
        reason = (
            f"Best-equipped trim inside your budget, with ₹{ceiling - best_price:,} "
            "left over."
        )

    return best, reason, out_of_reach


# ── Scoring ───────────────────────────────────────────────────────────────────

_USAGE_BODY_FIT: dict[str, set[str]] = {
    "city": {"hatchback", "sedan"},
    "highway": {"sedan", "suv"},
    "mixed": {"sedan", "suv", "hatchback"},
}


def _score(car: Car, variant: CarVariant, need: BuyerNeed) -> tuple[int, list[str], list[str]]:
    """
    Score this model-and-trim against what the buyer said.

    Only stated requirements score. A field the buyer left blank contributes
    nothing either way rather than a neutral half-mark, so a shortlist built
    from one sentence is not silently ranked on invented preferences.
    """
    score = 0
    possible = 0
    reasons: list[str] = []
    concerns: list[str] = []

    price = _price_of(variant)

    if need.budget_max is not None and price is not None:
        possible += 40
        if price <= need.budget_max:
            score += 40
            reasons.append(f"₹{price:,} — inside your budget")
        else:
            score += 22
            concerns.append(f"₹{price - need.budget_max:,} over your stated budget")
    if need.budget_min is not None and price is not None:
        possible += 10
        if price >= need.budget_min:
            score += 10
        else:
            concerns.append("Below the range you asked for")

    if need.seats is not None:
        possible += 25
        seats = variant.seating_capacity or car.seating_capacity
        if seats is None:
            concerns.append("Seating capacity not recorded for this trim")
        elif seats >= need.seats:
            score += 25
            reasons.append(f"Seats {seats} — enough for {need.seats}")
        else:
            concerns.append(f"Only {seats} seats for {need.seats} people")

    if need.fuel is not None:
        possible += 15
        fuel = (variant.fuel_type or (car.fuel_type.value if car.fuel_type else "") or "").lower()
        if need.fuel in fuel:
            score += 15
            reasons.append(f"{variant.fuel_type or need.fuel} as you asked")
        else:
            concerns.append(f"{variant.fuel_type or 'This'} rather than {need.fuel}")

    if need.body is not None:
        possible += 15
        body = car.body_type.value if car.body_type else ""
        # muv and mpv name the same thing; buyers use both.
        wanted = {"muv", "mpv"} if need.body in ("muv", "mpv") else {need.body}
        if body in wanted:
            score += 15
            reasons.append(f"{body.upper() if body in ('suv', 'muv') else body.capitalize()} body")

    if need.usage is not None:
        possible += 10
        body = car.body_type.value if car.body_type else ""
        if body and body in _USAGE_BODY_FIT.get(need.usage, set()):
            score += 10
            reasons.append(f"Suits {need.usage} driving")

    if need.transmission is not None:
        possible += 10
        trans = (variant.transmission or "").lower()
        automatic = any(tag in trans for tag in ("auto", "amt", "cvt", "dct", "dsg"))
        if (need.transmission == "automatic") == automatic and trans:
            score += 10
            reasons.append(f"{variant.transmission} gearbox")

    # Normalised against what was actually asked, so a buyer who stated two
    # requirements and matched both scores 100 rather than 30. An absolute
    # score would make every short sentence look like a poor match.
    percent = int(round(score / possible * 100)) if possible else 0
    return percent, reasons, concerns


# ── Endpoint ──────────────────────────────────────────────────────────────────


def _cost_line(component) -> CostLine:
    return CostLine(
        label=component.label,
        amount=component.amount,
        basis=component.basis,
        note=component.note,
    )


@router.post("/brief", response_model=BriefResponse)
@limiter.limit("20/minute")
async def brief(
    request: Request,
    payload: BriefRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Read the buyer's sentence, shortlist three cars, and cost them out.
    """
    need = parse_query(payload.query)

    # Answers the caller collected after a previous round of `missing`.
    if payload.km_per_month is not None:
        need.km_per_month = payload.km_per_month
        need.missing = [m for m in need.missing if m != "km_per_month"]
    if payload.seats is not None:
        need.seats = payload.seats
        need.missing = [m for m in need.missing if m != "seats"]

    if need.is_empty:
        return BriefResponse(
            request_id=str(uuid.uuid4()),
            understood=[],
            missing=need.missing,
            items=[],
            total_considered=0,
            assumptions={},
            message=(
                "I could not read a budget or requirement from that. Try something "
                "like: 12 lakh budget, family of 5, city driving, 1000 km a month."
            ),
        )

    # Only models that have at least one published trim: an unpriced model
    # cannot be costed, and a draft price has not been checked by anyone.
    q = (
        select(Car)
        .options(selectinload(Car.variants))
        .join(CarVariant, CarVariant.car_id == Car.id)
        .where(CarVariant.status == VariantStatus.published)
        .where(CarVariant.ex_showroom_price.is_not(None))
        .distinct()
        .limit(400)
    )
    cars = (await db.execute(q)).scalars().unique().all()

    scored: list[tuple[int, Car, CarVariant, list[str], list[str], str, list[str]]] = []
    for car in cars:
        published = [
            v for v in car.variants
            if v.status == VariantStatus.published and v.ex_showroom_price is not None
        ]
        if not published:
            continue

        variant, why, priced_out = _pick_variant(published, need)
        if variant is None:
            # Every trim is beyond the budget — correctly excluded, not a
            # near miss worth showing.
            continue

        # A seat shortfall disqualifies rather than deducts. Scored as a
        # penalty, a five-seater still surfaced third for a family of seven —
        # it cannot carry them, so it is not a worse answer, it is not an
        # answer. Only a *known* shortfall excludes: where the capacity is
        # unrecorded the car stays in and _score raises it as a concern,
        # because "we do not know" and "too small" are different facts.
        if need.seats is not None:
            seats = variant.seating_capacity or car.seating_capacity
            if seats is not None and seats < need.seats:
                continue

        score, reasons, concerns = _score(car, variant, need)
        scored.append((score, car, variant, reasons, concerns, why, priced_out))

    scored.sort(key=lambda row: row[0], reverse=True)

    items: list[Recommendation] = []
    assumptions: dict = {}

    for score, car, variant, reasons, concerns, why, priced_out in scored[:SHORTLIST_SIZE]:
        price = _price_of(variant) or 0
        fuel = (variant.fuel_type or (car.fuel_type.value if car.fuel_type else "") or "petrol").lower()
        # First word only: variants carry "Petrol + CNG", which is two fuels
        # and a price table, not a key into one.
        fuel_key = fuel.split()[0].strip("+,") if fuel else "petrol"

        curve = resale_forecast.heuristic_forecast(
            price, fuel.capitalize(), years=ownership_cost.OWNERSHIP_YEARS
        )
        resale_value = curve[-1]["value"] if curve else None

        breakdown = ownership_cost.build_breakdown(
            price=price,
            fuel=fuel_key,
            mileage_raw=variant.mileage,
            km_per_month=need.km_per_month,
            resale_value=resale_value,
            # heuristic_forecast is the generic curve, not model-specific
            # knowledge, and depreciation_cost labels it accordingly.
            resale_source="heuristic",
        )
        assumptions = breakdown.assumptions

        fuel_line = next((c for c in breakdown.components if c.label == "Fuel"), None)
        cost_per_km = None
        if fuel_line and fuel_line.amount and need.km_per_month:
            total_km = need.km_per_month * 12 * ownership_cost.OWNERSHIP_YEARS
            cost_per_km = round(fuel_line.amount / total_km, 2)

        items.append(
            Recommendation(
                car_id=str(car.id),
                make=car.make,
                model=car.model,
                year=car.year,
                body_type=car.body_type.value if car.body_type else None,
                match_score=score,
                reasons=reasons,
                concerns=concerns,
                variant=VariantPick(
                    id=str(variant.id),
                    name=variant.name,
                    ex_showroom_price=price or None,
                    fuel_type=variant.fuel_type,
                    transmission=variant.transmission,
                    seating_capacity=variant.seating_capacity,
                    mileage=variant.mileage,
                    reason=why,
                    priced_out=priced_out,
                ),
                monthly_emi=_cost_line(ownership_cost.monthly_emi(price)),
                five_year=[_cost_line(c) for c in breakdown.components],
                five_year_total=breakdown.total,
                five_year_excludes=breakdown.excludes,
                cost_per_km=cost_per_km,
                resale_five_year=resale_value,
                resale_source="heuristic",
            )
        )

    message = None
    if not items:
        message = (
            "Nothing in the catalogue matches that yet. The advisor only shows "
            "models with a published, priced trim."
        )

    return BriefResponse(
        request_id=str(uuid.uuid4()),
        understood=need.understood,
        missing=need.missing,
        items=items,
        total_considered=len(scored),
        assumptions=assumptions,
        message=message,
    )
