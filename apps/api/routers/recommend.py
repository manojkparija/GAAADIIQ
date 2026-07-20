"""
POST /recommend — rule-based car recommendation engine.

Scores active listings against user preferences (budget, fuel, body type, usage)
and returns the top matches with a match_score (0-100) and human-readable reasons.
No LLM is used here; results are grounded in actual DB listings.
"""
import uuid

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.limiter import limiter
from db.session import get_db
from models.listing import Listing
from schemas.listing import ListingOut


def _recommend_counter():
    from main import RECOMMEND_REQUESTS_TOTAL  # noqa: PLC0415
    return RECOMMEND_REQUESTS_TOTAL

router = APIRouter(prefix="/recommend", tags=["recommend"])

# ── Request / Response schemas ─────────────────────────────────────────────────

class RecommendRequest(BaseModel):
    budget: str | None = Field(None, description="under_5l | 5l_10l | 10l_20l | 20l_50l | above_50l")
    fuel: str | None = Field(None, description="petrol | diesel | electric | hybrid | cng | any")
    body: str | None = Field(None, description="hatchback | sedan | suv | mpv | any")
    usage: str | None = Field(None, description="city | highway | family | first | luxury")
    page_size: int = Field(6, ge=1, le=20)


class RecommendedListing(BaseModel):
    listing: ListingOut
    match_score: int = Field(..., ge=0, le=100)
    reasons: list[str]

    model_config = {"from_attributes": True}


class RecommendResponse(BaseModel):
    items: list[RecommendedListing]
    total_scored: int
    request_id: str


# ── Budget bands ───────────────────────────────────────────────────────────────

_BUDGET_BANDS: dict[str, dict] = {
    "under_5l":  {"min": 0,       "max": 500_000},
    "5l_10l":    {"min": 500_000, "max": 1_000_000},
    "10l_20l":   {"min": 1_000_000, "max": 2_000_000},
    "20l_50l":   {"min": 2_000_000, "max": 5_000_000},
    "above_50l": {"min": 5_000_000, "max": float("inf")},
}

# Usage → preferred body types and fuel types (helps scoring, not hard filters)
_USAGE_SIGNALS: dict[str, dict] = {
    "city":    {"body": {"hatchback", "sedan"}, "fuel": {"petrol", "electric", "cng"}},
    "highway": {"body": {"sedan", "suv"},       "fuel": {"diesel", "petrol"}},
    "family":  {"body": {"suv", "mpv"},         "fuel": {"diesel", "petrol", "hybrid"}},
    "first":   {"body": {"hatchback"},           "fuel": {"petrol", "cng"}},
    "luxury":  {"body": {"suv", "sedan"},        "fuel": {"petrol", "electric", "hybrid"}},
}


# ── Scoring ────────────────────────────────────────────────────────────────────

def _score_listing(listing: Listing, req: RecommendRequest) -> tuple[int, list[str]]:
    """
    Returns (score 0-100, reasons list).
    Weights: budget 35, fuel 25, body 20, usage 20.
    """
    score = 0
    reasons: list[str] = []
    car = listing.car

    # Budget fit (35 pts)
    if req.budget and req.budget in _BUDGET_BANDS:
        band = _BUDGET_BANDS[req.budget]
        price = float(listing.price)
        if band["min"] <= price <= band["max"]:
            score += 35
            reasons.append("Within your budget range")
        elif price < band["min"] * 0.85:
            score += 15
            reasons.append("Under budget — more value for money")
        elif price <= band["max"] * 1.10:
            score += 20
            reasons.append("Slightly over budget")

    # Fuel match (25 pts)
    if req.fuel and req.fuel != "any":
        listing_fuel = car.fuel_type.value if car.fuel_type else ""
        if listing_fuel == req.fuel:
            score += 25
            reasons.append(f"{req.fuel.capitalize()} fuel matches your preference")
        # partial credit for similar (e.g. hybrid when electric requested)
        elif req.fuel == "electric" and listing_fuel == "hybrid":
            score += 10
            reasons.append("Hybrid — lower emissions like electric")
    else:
        score += 15  # no preference: neutral credit

    # Body type match (20 pts)
    if req.body and req.body != "any":
        listing_body = car.body_type.value if car.body_type else ""
        if listing_body == req.body:
            score += 20
            reasons.append(f"{req.body.capitalize()} body type matches")
    else:
        score += 10

    # Usage signals (20 pts)
    if req.usage and req.usage in _USAGE_SIGNALS:
        signals = _USAGE_SIGNALS[req.usage]
        listing_body = car.body_type.value if car.body_type else ""
        listing_fuel = car.fuel_type.value if car.fuel_type else ""
        body_match = listing_body in signals["body"]
        fuel_match = listing_fuel in signals["fuel"]
        if body_match and fuel_match:
            score += 20
            reasons.append(f"Well suited for {req.usage.replace('_', ' ')} use")
        elif body_match or fuel_match:
            score += 10
            reasons.append(f"Partially suits {req.usage.replace('_', ' ')} use")

    return min(score, 100), reasons


# ── Endpoint ───────────────────────────────────────────────────────────────────

@router.post("", response_model=RecommendResponse)
@limiter.limit("30/minute")
async def recommend(
    request: Request,
    payload: RecommendRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Rule-engine recommendation. Returns listings scored against user answers.
    No AI / LLM — results grounded entirely in DB listing data.
    """
    _recommend_counter().inc()
    q = select(Listing).options(
        selectinload(Listing.car),
        selectinload(Listing.seller),
    ).where(Listing.is_active == True)  # noqa: E712

    # Hard filter: budget (pre-filter to avoid scoring irrelevant listings)
    if payload.budget and payload.budget in _BUDGET_BANDS:
        band = _BUDGET_BANDS[payload.budget]
        # Allow 10% overage so near-budget listings still appear
        q = q.where(Listing.price <= band["max"] * 1.10)
        if band["min"] > 0:
            q = q.where(Listing.price >= band["min"] * 0.85)

    # Hard filter: fuel type
    if payload.fuel and payload.fuel != "any":
        from models.car import Car
        q = q.join(Listing.car).where(Car.fuel_type == payload.fuel)

    # Hard filter: body type (mpv and muv are aliases)
    if payload.body and payload.body != "any":
        from models.car import Car as CarModel
        if not payload.fuel or payload.fuel == "any":
            q = q.join(Listing.car)
        body_values = [payload.body, "muv"] if payload.body == "mpv" else (
            [payload.body, "mpv"] if payload.body == "muv" else [payload.body]
        )
        q = q.where(CarModel.body_type.in_(body_values))

    q = q.limit(200)  # score a reasonable candidate set
    result = await db.execute(q)
    listings = result.scalars().all()

    scored = [
        (listing, *_score_listing(listing, payload))
        for listing in listings
    ]
    scored.sort(key=lambda x: x[1], reverse=True)

    top = scored[: payload.page_size]
    items = [
        RecommendedListing(
            listing=ListingOut.model_validate(listing),
            match_score=score,
            reasons=reasons,
        )
        for listing, score, reasons in top
    ]

    return RecommendResponse(
        items=items,
        total_scored=len(scored),
        request_id=str(uuid.uuid4()),
    )


@router.post("/ai", response_model=RecommendResponse)
@limiter.limit("20/minute")
async def recommend_ai(
    request: Request,
    payload: RecommendRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Semantic search via Qdrant embeddings + rule scoring fallback.
    Builds a natural-language query from user preferences, embeds it,
    searches Qdrant for similar listings, then scores those candidates
    with the rule engine for explainability.
    """
    from services.embeddings import embed_one
    from services import vector_store

    # Build natural language query from user preferences
    parts = []
    if payload.fuel and payload.fuel != "any":
        parts.append(f"{payload.fuel} fuel")
    if payload.body and payload.body != "any":
        parts.append(f"{payload.body} body type")
    if payload.budget and payload.budget in _BUDGET_BANDS:
        band = _BUDGET_BANDS[payload.budget]
        parts.append(f"price around {int((band['min'] + min(band['max'], 5_000_000)) / 2)}")
    if payload.usage and payload.usage in _USAGE_SIGNALS:
        parts.append(f"suitable for {payload.usage} use")
    query_text = " ".join(parts) if parts else "good value used car"

    vector = embed_one(query_text)
    semantic_ids: set[int] = set()
    if vector:
        semantic_results = vector_store.search_listings(query_vector=vector, top_k=50)
        semantic_ids = {r["id"] for r in semantic_results}

    # Fall back to the regular rule-based recommend if Qdrant is unavailable
    if not semantic_ids:
        return await recommend(request, payload, db)

    # Load the semantically retrieved listings from DB and score them
    q = select(Listing).options(
        selectinload(Listing.car), selectinload(Listing.seller)
    ).where(
        Listing.id.in_(semantic_ids),
        Listing.is_active == True,  # noqa: E712
    )
    result = await db.execute(q)
    listings = result.scalars().all()

    scored = [
        (listing, *_score_listing(listing, payload))
        for listing in listings
    ]
    scored.sort(key=lambda x: x[1], reverse=True)
    top = scored[:payload.page_size]

    items = [
        RecommendedListing(
            listing=ListingOut.model_validate(listing),
            match_score=score,
            reasons=["Semantically matched to your requirements"] + reasons,
        )
        for listing, score, reasons in top
    ]
    _recommend_counter().inc()
    return RecommendResponse(items=items, total_scored=len(scored), request_id=str(uuid.uuid4()))
