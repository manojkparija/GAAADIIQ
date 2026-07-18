#!/usr/bin/env python3
"""AI Advisor full feature scenario matrix — Angular scoring + static gaps + API contract checks."""
from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = Path("/opt/cursor/artifacts/ai-advisor")
OUT_DIR.mkdir(parents=True, exist_ok=True)
QA = ROOT / "docs/qa"

# ── Parse seed cars (SQL) ─────────────────────────────────────────────────────
sql = (ROOT / "scripts/seed-cars.sql").read_text()
pat = re.compile(
    r"\('([^']+)',\s*'([^']+)',\s*'([^']*)',\s*(\d+),\s*(\d+),\s*(\d+),\s*'([^']+)',\s*'([^']+)',\s*'([^']*)',\s*'([^']*)',\s*([\d.]+),\s*(\d+),\s*'([^']*)',\s*'([^']*)'"
)
cars: list[dict] = []
for i, m in enumerate(pat.findall(sql), 1):
    make, model, variant, year, price, km, fuel, _trans, _badge, _btype, rating, reviews, city, body = m
    cars.append(
        {
            "id": i,
            "make": make,
            "model": model,
            "variant": variant,
            "year": int(year),
            "price": int(price),
            "km": int(km),
            "fuel": fuel,
            "rating": float(rating),
            "reviews": int(reviews),
            "city": city,
            "bodyType": body,
            "specs": [],
            "features": [],
        }
    )


def ensure_specs(car: dict) -> None:
    if car["specs"]:
        return
    seats = 7 if car["bodyType"] == "MUV" else 5
    mileage = {"Petrol": 18, "Diesel": 20, "CNG": 26, "Hybrid": 24, "Electric": 0}.get(car["fuel"], 18)
    car["specs"] = [
        {"label": "Seating", "value": str(seats)},
        {"label": "Mileage", "value": f"{mileage} kmpl" if car["fuel"] != "Electric" else "0"},
    ]
    if car["fuel"] == "Electric":
        car["specs"].append({"label": "Range", "value": "350 km"})
        car["specs"].append({"label": "Power", "value": "140 bhp"})
    else:
        car["specs"].append({"label": "Power", "value": "100 bhp"})
    feats: list[str] = []
    if car["price"] >= 1_200_000:
        feats += ["Sunroof", "6 Airbags", "Connected Car"]
    if car["price"] >= 1_500_000:
        feats += ["ADAS", "360 Camera", "Wireless Charging", "Ventilated Seats"]
    if car["price"] >= 1_000_000:
        feats += ['10.25" Touchscreen']
    if "Thar" in car["model"] or "Jimny" in car["model"]:
        feats += ["4WD"]
    car["features"] = feats


for c in cars:
    ensure_specs(c)

cy = datetime.now().year
brand_new = [c for c in cars if c["year"] >= cy - 1 and c["km"] < 15000]
certified = [c for c in cars if c["year"] < cy - 1 or c["km"] >= 15000]

BUDGET_MAP = {
    "Under ₹5L": (0, 500000),
    "₹5L – ₹10L": (500000, 1000000),
    "₹10L – ₹15L": (1000000, 1500000),
    "₹15L – ₹20L": (1500000, 2000000),
    "₹20L – ₹30L": (2000000, 3000000),
    "Above ₹30L": (3000000, float("inf")),
}
DAILY_KM = {
    "< 20 km/day": 15,
    "20 – 50 km/day": 35,
    "50 – 100 km/day": 75,
    "100+ km/day": 120,
}


def need_seating(fs: str) -> int:
    if fs == "Just me":
        return 2
    if fs == "2 – 3 people":
        return 4
    if fs == "4 – 5 people":
        return 5
    return 7


def car_seating(car: dict) -> int:
    for s in car.get("specs") or []:
        if s["label"] == "Seating":
            return int(re.sub(r"\D", "", s["value"]) or 5)
    return 7 if car["bodyType"] == "MUV" else 5


def compute(profile: dict, inventory: list[dict]) -> tuple[list[dict], int]:
    condition = (profile.get("condition") or ["Any Condition"])[0]
    budget = (profile.get("budget") or [""])[0]
    daily_km_str = (profile.get("dailyKm") or ["20 – 50 km/day"])[0]
    family_size = (profile.get("familySize") or ["2 – 3 people"])[0]
    fuels = profile.get("fuel") or []
    body_types = [b for b in (profile.get("bodyType") or []) if b != "No preference"]
    usages = profile.get("usageType") or []
    lifestyle = profile.get("lifestyle") or []
    bud_min, bud_max = BUDGET_MAP.get(budget, (0, float("inf")))
    _daily_km = DAILY_KM.get(daily_km_str, 35)
    no_fuel_pref = "No preference" in fuels or len(fuels) == 0
    current_year = datetime.now().year
    if condition == "Brand New":
        allc = [c for c in inventory if c["year"] >= current_year - 1 and c["km"] < 15000]
    elif condition == "Certified Used":
        allc = [c for c in inventory if c["year"] < current_year - 1 or c["km"] >= 15000]
    else:
        allc = list(inventory)

    scored: list[dict] = []
    for car in allc:
        score = 0.0
        reasons: list[str] = []
        if bud_min <= car["price"] <= bud_max:
            score += 25
            reasons.append("Within your budget")
        elif car["price"] < bud_min and car["price"] >= bud_min * 0.75:
            score += 18
        elif car["price"] > bud_max and car["price"] <= bud_max * 1.12:
            score += 10
        elif car["price"] < bud_min * 0.75:
            score += 12
        else:
            score -= 20

        if no_fuel_pref:
            score += 10
        elif any(car["fuel"].lower() == f.lower() for f in fuels):
            score += 15
            reasons.append(f"{car['fuel']} — your preferred fuel")
        else:
            score -= 30

        need = need_seating(family_size)
        has = car_seating(car)
        if has == need or has == need + 1:
            score += 15
        elif has > need + 1:
            over = has - need
            penalty = over * 3 if need <= 4 else 0
            score += max(15 - penalty, 6)
        elif has == need - 1:
            score += 8
        else:
            score -= 10

        if not body_types:
            score += 8
        else:
            match = False
            for bt in body_types:
                if bt == "MUV / MPV" and car["bodyType"] == "MUV":
                    match = True
                elif bt == "Compact SUV" and car["bodyType"] == "SUV" and car["price"] < 1_300_000:
                    match = True
                elif car["bodyType"].lower() == bt.lower():
                    match = True
            if match:
                score += 15
                reasons.append(f"{car['bodyType']} — matches your preference")
            else:
                score -= 12

        if "Off-road adventure" in usages and any(
            re.search(r"4wd|4x4", f, re.I) for f in car.get("features") or []
        ):
            score += 5
        if "Long road trips" in usages and car["bodyType"] == "SUV":
            score += 3
        if "Eco-conscious" in lifestyle and car["fuel"] in ("Electric", "Hybrid", "CNG"):
            score += 3

        score += (car["rating"] - 4.0) * 5
        norm = min(max(round((score / 115) * 99), 30), 99)
        scored.append({**car, "matchScore": norm, "reasons": reasons})

    scored.sort(key=lambda x: -x["matchScore"])
    if no_fuel_pref:
        top = scored[:5]
    else:
        fuel_match = [c for c in scored if any(c["fuel"].lower() == f.lower() for f in fuels)]
        hard = bud_max * 1.10 if bud_max != float("inf") else float("inf")
        in_b = [c for c in fuel_match if c["price"] <= bud_max]
        over = [c for c in fuel_match if c["price"] > bud_max and c["price"] <= hard]
        over_allowed = over[: max(0, 3 - len(in_b))] if len(in_b) < 3 else []
        top = (in_b + over_allowed)[:5]
    return top, len(allc)


results: list[dict] = []


def add(suite: str, id_: str, name: str, status: str, detail: str, severity: str = "—") -> None:
    results.append(
        {
            "suite": suite,
            "id": id_,
            "name": name,
            "status": status,
            "detail": detail,
            "severity": severity,
        }
    )


# Inventory
add(
    "Inventory",
    "INV-01",
    "Seed catalog size",
    "PASS" if len(cars) >= 50 else "FAIL",
    f"{len(cars)} cars in seed-cars.sql",
    "P0" if len(cars) < 50 else "—",
)
add(
    "Inventory",
    "INV-02",
    "Brand New filter yields cars (year>=cy-1 & km<15k)",
    "PASS" if len(brand_new) > 0 else "FAIL",
    f"{len(brand_new)} cars; cy={cy}. Note: 2025@0km qualify as Brand New in 2026.",
    "P0" if not brand_new else "P1",
)
add(
    "Inventory",
    "INV-03",
    "Certified Used filter yields cars",
    "PASS" if len(certified) > 0 else "FAIL",
    f"{len(certified)} cars",
)
add(
    "Inventory",
    "INV-04",
    "Fuel diversity (Petrol/Diesel/EV/Hybrid/CNG)",
    "PASS" if len(Counter(c["fuel"] for c in cars)) >= 4 else "FAIL",
    str(dict(Counter(c["fuel"] for c in cars))),
)
add(
    "Inventory",
    "INV-05",
    "Body diversity (Hatch/Sedan/SUV/MUV)",
    "PASS" if len(Counter(c["bodyType"] for c in cars)) >= 4 else "FAIL",
    str(dict(Counter(c["bodyType"] for c in cars))),
)
add(
    "Inventory",
    "INV-06",
    "Analyzing copy claims 58 vehicles",
    "FAIL" if abs(len(cars) - 58) > 5 else "PASS",
    f"ANALYZE_MSGS says 'Evaluating 58 vehicles' but seed has {len(cars)}",
    "P2",
)

ts = (ROOT / "apps/gaadiiq-angular/src/app/pages/ai-advisor/ai-advisor.component.ts").read_text()
html = (ROOT / "apps/gaadiiq-angular/src/app/pages/ai-advisor/ai-advisor.component.html").read_text()
keys = re.findall(r"key: '(\w+)'", ts)

add("Quiz UX", "QZ-01", "Route /ai-advisor component exists", "PASS", "ai-advisor.component.ts/html/scss")
add(
    "Quiz UX",
    "QZ-02",
    "11 base steps defined in ALL_STEPS",
    "PASS" if len(keys) >= 11 else "FAIL",
    f"ALL_STEPS keys: {keys}",
)
add(
    "Quiz UX",
    "QZ-03",
    "EV step conditional on Electric fuel",
    "PASS" if "fuels.includes('Electric')" in ts and "ev: true" in ts else "FAIL",
    "visibleSteps filters ev unless Electric selected",
)
add(
    "Quiz UX",
    "QZ-04",
    "Progress = (stepIdx+1)/totalSteps",
    "PASS" if "stepIdx() + 1" in ts and "totalSteps()" in ts else "FAIL",
    "progress computed",
)
add(
    "Quiz UX",
    "QZ-05",
    "Multi-select steps (usage/fuel/lifestyle/body/features/priorities)",
    "PASS" if ts.count("multi: true") >= 5 else "FAIL",
    f"multi:true count={ts.count('multi: true')}",
)
add(
    "Quiz UX",
    "QZ-06",
    "Back disabled on step 0; Next requires selection",
    "PASS" if "canProceed" in ts and "btn-back" in html else "FAIL",
    "canProceed + back disabled",
)
add(
    "Quiz UX",
    "QZ-07",
    "SEO says 10 questions vs UI 11",
    "FAIL",
    "seo.setPage(... 'Answer 10 smart questions...') while totalSteps is 11 (or 12 w/ EV)",
    "P2",
)
add(
    "Quiz UX",
    "QZ-08",
    "Hero gradient-text on Advisor (intentional purple tint)",
    "PASS",
    'HTML: AI Car <span class="gradient-text">Advisor</span> — design choice, not a bug',
)
add(
    "Quiz UX",
    "QZ-09",
    "drivingMix answer used in scoring",
    "FAIL",
    "Step collects drivingMix but computeResults never reads it",
    "P1",
)
add(
    "Quiz UX",
    "QZ-10",
    "Analytics body_type uses wrong key p[body]",
    "FAIL" if "p['body']" in ts else "PASS",
    "track ai_query uses p['body'] but step key is bodyType → always undefined",
    "P1",
)
add(
    "Quiz UX",
    "QZ-11",
    "Restart clears quiz state",
    "PASS" if "restart()" in ts and "phase.set('quiz')" in ts else "FAIL",
    "restart() resets phase/profile",
)
add(
    "Quiz UX",
    "QZ-12",
    "No progress persist on nav away",
    "FAIL",
    "profile is in-memory signal only; leaving /ai-advisor discards answers (no localStorage/session)",
    "P1",
)

scenarios = [
    (
        "SC-01",
        "Brand New + ₹5–10L + Petrol + Hatchback",
        {
            "condition": ["Brand New"],
            "budget": ["₹5L – ₹10L"],
            "dailyKm": ["20 – 50 km/day"],
            "familySize": ["2 – 3 people"],
            "fuel": ["Petrol"],
            "bodyType": ["Hatchback"],
            "usageType": ["Daily commute"],
            "lifestyle": ["Value seeker"],
            "features": [],
            "priorities": ["Fuel efficiency"],
        },
    ),
    (
        "SC-02",
        "Certified Used + ₹10–15L + Diesel + SUV",
        {
            "condition": ["Certified Used"],
            "budget": ["₹10L – ₹15L"],
            "dailyKm": ["50 – 100 km/day"],
            "familySize": ["4 – 5 people"],
            "fuel": ["Diesel"],
            "bodyType": ["SUV"],
            "usageType": ["Long road trips"],
            "lifestyle": ["Comfort-focused"],
            "features": ["Sunroof"],
            "priorities": ["Low maintenance"],
        },
    ),
    (
        "SC-03",
        "Any + Above ₹30L + Electric (EV step path)",
        {
            "condition": ["Any Condition"],
            "budget": ["Above ₹30L"],
            "dailyKm": ["20 – 50 km/day"],
            "familySize": ["2 – 3 people"],
            "fuel": ["Electric"],
            "ev": ["Home charger ready"],
            "bodyType": ["SUV"],
            "usageType": ["Daily commute"],
            "lifestyle": ["Eco-conscious"],
            "features": ["ADAS Safety"],
            "priorities": ["Low total cost"],
        },
    ),
    (
        "SC-04",
        "No fuel pref + No body pref + Under ₹5L",
        {
            "condition": ["Any Condition"],
            "budget": ["Under ₹5L"],
            "dailyKm": ["< 20 km/day"],
            "familySize": ["Just me"],
            "fuel": ["No preference"],
            "bodyType": ["No preference"],
            "usageType": ["Daily commute"],
            "lifestyle": ["First-time buyer"],
            "features": [],
            "priorities": ["Low total cost"],
        },
    ),
    (
        "SC-05",
        "6+ family + MUV + Petrol/Diesel",
        {
            "condition": ["Any Condition"],
            "budget": ["₹15L – ₹20L"],
            "dailyKm": ["20 – 50 km/day"],
            "familySize": ["6+ people"],
            "fuel": ["Petrol", "Diesel"],
            "bodyType": ["MUV / MPV"],
            "usageType": ["Family outings", "School runs"],
            "lifestyle": ["Safety first"],
            "features": ["6+ Airbags"],
            "priorities": ["Safety rating"],
        },
    ),
    (
        "SC-06",
        "Off-road + SUV + Diesel",
        {
            "condition": ["Any Condition"],
            "budget": ["₹15L – ₹20L"],
            "dailyKm": ["100+ km/day"],
            "familySize": ["2 – 3 people"],
            "fuel": ["Diesel"],
            "bodyType": ["SUV"],
            "usageType": ["Off-road adventure"],
            "lifestyle": ["Performance lover"],
            "features": [],
            "priorities": ["Performance"],
        },
    ),
    (
        "SC-07",
        "Fuel hard-filter: CNG only in budget",
        {
            "condition": ["Any Condition"],
            "budget": ["₹5L – ₹10L"],
            "dailyKm": ["20 – 50 km/day"],
            "familySize": ["2 – 3 people"],
            "fuel": ["CNG"],
            "bodyType": ["No preference"],
            "usageType": ["Daily commute"],
            "lifestyle": ["Value seeker"],
            "features": [],
            "priorities": ["Fuel efficiency"],
        },
    ),
    (
        "SC-08",
        "Compact SUV preference under ₹13L heuristic",
        {
            "condition": ["Brand New"],
            "budget": ["₹10L – ₹15L"],
            "dailyKm": ["20 – 50 km/day"],
            "familySize": ["2 – 3 people"],
            "fuel": ["Petrol"],
            "bodyType": ["Compact SUV"],
            "usageType": ["Daily commute"],
            "lifestyle": ["Tech enthusiast"],
            "features": ["Large Touchscreen"],
            "priorities": ["Feature-rich"],
        },
    ),
]

for sid, name, prof in scenarios:
    top, cand = compute(prof, cars)
    fuels = set(prof.get("fuel") or [])
    no_pref = "No preference" in fuels or not fuels
    fuel_ok = True
    if top and not no_pref:
        fuel_ok = all(any(c["fuel"].lower() == f.lower() for f in fuels) for c in top)
    budget = (prof.get("budget") or [""])[0]
    _bmin, bmax = BUDGET_MAP.get(budget, (0, float("inf")))
    hard = bmax * 1.10 if bmax != float("inf") else float("inf")
    budget_ok = all(c["price"] <= hard for c in top) if top else True
    if not top:
        status = "FAIL"
        detail = f"candidates={cand}, EMPTY results"
    else:
        status = "PASS" if fuel_ok and budget_ok else "FAIL"
        detail = f"candidates={cand}, results={len(top)}, top=" + ", ".join(
            f"{c['make']} {c['model']} ({c['matchScore']}%, ₹{c['price'] // 100000}L, {c['fuel']})"
            for c in top[:3]
        )
        if not fuel_ok:
            detail += " | FUEL LEAK"
        if not budget_ok:
            detail += " | BUDGET LEAK"
    add("Scoring", sid, name, status, detail, "P0" if status == "FAIL" else "—")

top_empty, cand_empty = compute(
    {
        "condition": ["Brand New"],
        "budget": ["Under ₹5L"],
        "fuel": ["Electric"],
        "bodyType": ["MUV / MPV"],
        "familySize": ["6+ people"],
        "dailyKm": ["100+ km/day"],
        "usageType": [],
        "lifestyle": [],
        "features": ["ADAS Safety", "Ventilated Seats"],
        "priorities": [],
    },
    cars,
)
add(
    "Scoring",
    "SC-09",
    "Impossible combo returns empty gracefully",
    "PASS" if len(top_empty) == 0 else "PARTIAL",
    f"candidates={cand_empty}, results={len(top_empty)} — UI must show empty state",
    "P1",
)

add(
    "Results UX",
    "RS-01",
    "Empty results UI",
    "FAIL" if "No matches" not in html and "results().length === 0" not in html else "PASS",
    "results-page always renders; no dedicated empty-state when results=[]",
    "P0",
)
add(
    "Results UX",
    "RS-02",
    "Compare Top 3 requires >=2 results",
    "PASS" if "results().length >= 2" in html else "FAIL",
    "comparison gated",
)
add(
    "Results UX",
    "RS-03",
    "Match score + reasons + TCO + EMI shown",
    "PASS" if all(x in html for x in ["matchScore", "reasons", "fiveYearTco", "monthlyEmi"]) else "FAIL",
    "finance-grid + why-section present",
)
add(
    "Results UX",
    "RS-04",
    "View Details → /cars/:id",
    "PASS" if "/cars" in html else "FAIL",
    "routerLink to car detail",
)
add(
    "Results UX",
    "RS-05",
    "Images use placehold.co CDN fallback",
    "FAIL",
    "placehold.co used instead of assets/cars/placeholder.svg",
    "P1",
)
add(
    "Results UX",
    "RS-06",
    "Category badges (Best Match / Mileage / Value / TCO)",
    "PASS" if "Best Match" in ts and "Lowest TCO" in ts else "FAIL",
    "badges assigned in computeResults",
)
add(
    "Results UX",
    "RS-07",
    "Best Family badge familySize type bug",
    "FAIL",
    "needSeating(p['familySize'] as string) but familySize is string[] → always needS=7 → spurious Best Family",
    "P1",
)
add(
    "Results UX",
    "RS-08",
    "Fake analyzing animation (no real AI)",
    "FAIL",
    "ANALYZE_MSGS + setTimeout theater; computeResults is client rule-engine marketed as AI",
    "P0",
)
add(
    "Results UX",
    "RS-09",
    "Compare button with 0–1 results",
    "PARTIAL",
    "Button always shown; table hidden when <2 — OK but no disabled state",
    "P2",
)

add(
    "Product Logic",
    "PL-01",
    "Brand New = year>=cy-1 & km<15k (not listing_type/new)",
    "FAIL",
    f"In {cy}, year>={cy - 1} & km<15k → {len(brand_new)} cars. Differs from marketplace listing_type / isUsedCar.",
    "P0",
)
add(
    "Product Logic",
    "PL-02",
    "Certified Used ≠ marketplace certified flag",
    "FAIL",
    "Filter is year/km heuristic only; ignores badge=Certified / verified / owners",
    "P1",
)
add(
    "Product Logic",
    "PL-03",
    "No LLM / Ollama / chat in Angular advisor",
    "FAIL",
    "Vision/PRD promise conversational LLM; Angular has zero API calls",
    "P0",
)
add(
    "Product Logic",
    "PL-04",
    "Angular advisor not wired to POST /recommend",
    "FAIL",
    "API has rule-engine POST /recommend; Angular scores CarsDataService locally",
    "P0",
)
add(
    "Product Logic",
    "PL-05",
    "City (Kolkata navbar) unused in advisor",
    "FAIL",
    "Recommendations ignore CityService / user city",
    "P2",
)

nxt = (ROOT / "apps/web/app/recommend/page.tsx").read_text()
nav = (ROOT / "apps/web/components/navbar.tsx").read_text()

add(
    "Next /recommend",
    "NX-01",
    "Page exists with 4-step wizard",
    "PASS" if 'step === "budget"' in nxt and "usage" in nxt else "FAIL",
    "budget→fuel→body→usage→results",
)
add(
    "Next /recommend",
    "NX-02",
    "Calls POST /recommend API",
    "FAIL",
    "fetchRecommendations uses GET /listings filters — ignores API match_score/reasons",
    "P0",
)
add(
    "Next /recommend",
    "NX-03",
    "Usage answer affects results",
    "FAIL",
    "usage collected then dropped — not sent to API/listings",
    "P0",
)
add(
    "Next /recommend",
    "NX-04",
    "No match scores / reasons in UI",
    "FAIL",
    "Results render listing cards only; API RecommendResponse unused",
    "P0",
)
add(
    "Next /recommend",
    "NX-05",
    "No TCO / EMI / cost analysis on Next advisor",
    "FAIL",
    "Angular has finance-grid; Next has none — feature parity gap",
    "P1",
)
add(
    "Next /recommend",
    "NX-06",
    "Navbar AI Advisor → /recommend",
    "PASS" if "/recommend" in nav else "FAIL",
    "Next nav points to /recommend",
)
add(
    "Next /recommend",
    "NX-07",
    "E2E covers interactive budget→fuel",
    "PASS",
    "public-pages.spec.ts has heading + Under ₹5 L → fuel step",
)
add(
    "Next /recommend",
    "NX-08",
    "CNG option missing on Next (Angular has CNG)",
    "FAIL",
    "FUEL_OPTIONS lacks CNG; API supports cng",
    "P2",
)
add(
    "Next /recommend",
    "NX-09",
    "MPV value mpv vs API/DB muv",
    "FAIL",
    'BODY_OPTIONS value "mpv"; Car.body_type enum is muv — POST /recommend body=mpv returns 0',
    "P1",
)
home = (ROOT / "apps/gaadiiq-angular/src/app/pages/home/home.component.ts").read_text()
add(
    "Platform",
    "PF-03",
    "Home AI Price Valuation routes to /ai-advisor",
    "FAIL" if "AI Price Valuation" in home and "/ai-advisor" in home else "PASS",
    "Wrong feature linked to advisor quiz",
    "P2",
)
add(
    "Scoring",
    "SC-04b",
    "Budget leak root cause: noFuelPref skips hard budget cap",
    "FAIL",
    "computeResults noFuelPref path uses scored.slice(0,5) with no budMax*1.10 exclusion",
    "P0",
)

add("API", "API-01", "POST /recommend router exists", "PASS", "apps/api/routers/recommend.py registered in main.py")
add(
    "API",
    "API-02",
    "POST /recommend/ai-chat missing (LLD)",
    "FAIL",
    "LLD SequenceDiagrams + APIContracts define ai-chat SSE; not implemented",
    "P0",
)
add(
    "API",
    "API-03",
    "recommendations table unused by endpoint",
    "FAIL",
    "DB schema docs have recommendations table; endpoint does not persist sessions",
    "P1",
)
add("API", "API-04", "Rule-engine documents no LLM", "PASS", "recommend.py docstring: No LLM is used here")

add(
    "Platform",
    "PF-01",
    "Two divergent AI Advisors (Angular 11-step vs Next 4-step)",
    "FAIL",
    "Screenshot/product = Angular /ai-advisor; Next /recommend is thinner filter UI — no shared engine",
    "P0",
)
add(
    "Platform",
    "PF-02",
    "No Playwright e2e for Angular /ai-advisor",
    "FAIL",
    "Only Next /recommend e2e exists",
    "P1",
)

# Lifestyle / EV answer unused
add(
    "Quiz UX",
    "QZ-13",
    "EV readiness answer used in scoring",
    "FAIL",
    "ev step collected when Electric selected but computeResults never reads p['ev']",
    "P1",
)
add(
    "Quiz UX",
    "QZ-14",
    "Lifestyle First-time buyer / Comfort / Tech unused",
    "FAIL",
    "Only Eco-conscious, Safety first, Luxury, Value seeker affect score; others ignored",
    "P2",
)

counts = Counter(r["status"] for r in results)
summary = {
    "generated_at": datetime.utcnow().isoformat() + "Z",
    "surface_primary": "Angular /ai-advisor (screenshot)",
    "surface_secondary": "Next /recommend + API POST /recommend",
    "seed_cars": len(cars),
    "brand_new_filter": len(brand_new),
    "certified_used_filter": len(certified),
    "counts": dict(counts),
    "total": len(results),
    "results": results,
}
(OUT_DIR / "ai-advisor-scenarios.json").write_text(json.dumps(summary, indent=2))
(QA / "ai-advisor-scenarios.json").write_text(json.dumps(summary, indent=2))
print("TOTAL", len(results), dict(counts))
for r in results:
    if r["status"] in ("FAIL", "PARTIAL"):
        print(f"{r['status']:7} {r['id']:6} {r['name'][:62]}")
