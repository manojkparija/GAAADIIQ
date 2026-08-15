#!/usr/bin/env python3
"""
AI Diagnosis / AI Valuation — full scenario matrix.

Scope note: There is NO mechanical/OBD "AI Diagnosis" module in the repo.
The closest implemented feature is AI Valuation (price diagnosis) across:
  - Angular /ai-valuation (+ List Your Car wizard)
  - Next listing ValuationButton → POST /listings/{id}/valuate
  - API services/valuation.py (Ollama + heuristic)
  - Supabase Edge Function ai-valuation (Claude/Anthropic)
"""
from __future__ import annotations

import json
import math
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
QA = ROOT / "docs/qa"
ART = Path("/opt/cursor/artifacts/ai-diagnosis")
ART.mkdir(parents=True, exist_ok=True)

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


# ── Port Angular fallbackValuation ───────────────────────────────────────────
SEGMENT = {
    "BMW": 5_000_000,
    "Mercedes-Benz": 6_000_000,
    "Audi": 5_000_000,
    "Toyota": 1_800_000,
    "Honda": 1_200_000,
    "Hyundai": 1_200_000,
    "Kia": 1_200_000,
    "MG Motor": 1_500_000,
    "Tata": 900_000,
    "Mahindra": 1_200_000,
    "Maruti Suzuki": 750_000,
    "Skoda": 1_500_000,
    "Volkswagen": 1_300_000,
    "Renault": 700_000,
    "Nissan": 800_000,
    "Other": 900_000,
}

# Parse a few catalogue base prices from TS for variant-aware tests
ts = (ROOT / "apps/gaadiiq-angular/src/app/pages/ai-valuation/ai-valuation.component.ts").read_text()
html = (ROOT / "apps/gaadiiq-angular/src/app/pages/ai-valuation/ai-valuation.component.html").read_text()
edge = (ROOT / "supabase/functions/ai-valuation/index.ts").read_text()
api_val = (ROOT / "apps/api/services/valuation.py").read_text()
btn = (ROOT / "apps/web/components/valuation-button.tsx").read_text()
routes = (ROOT / "apps/gaadiiq-angular/src/app/app.routes.ts").read_text()
api_svc = (ROOT / "apps/gaadiiq-angular/src/app/services/api.service.ts").read_text()
list_car = (ROOT / "apps/gaadiiq-angular/src/app/pages/list-car/list-car.component.ts").read_text()
sub = (ROOT / "apps/gaadiiq-angular/src/app/services/subscription.service.ts").read_text()
home = (ROOT / "apps/gaadiiq-angular/src/app/pages/home/home.component.ts").read_text()
car_detail_html = (ROOT / "apps/gaadiiq-angular/src/app/pages/car-detail/car-detail.component.html").read_text()

# Extract Swift ZXi+ base
swift_zxi = 949000
if m := re.search(r"'ZXi\+',\s*basePrice:(\d+)", ts):
    swift_zxi = int(m.group(1))


def fallback_valuation(
    make: str,
    year: int,
    km: int,
    fuel: str,
    owners: str,
    condition: str,
    base: int | None = None,
) -> dict:
    age = datetime.now().year - year
    base_p = base if base is not None else SEGMENT.get(make, 900000)
    dep = 0.0
    for i in range(age):
        dep += 0.15 if i == 0 else (0.10 if i < 5 else 0.07)
    dep = min(dep, 0.75)
    km_penalty = max(0, (km - 20000) / 10000) * 0.01
    owner_penalty = {
        "1st Owner": 0,
        "2nd Owner": 0.05,
        "3rd Owner": 0.10,
        "4th+ Owner": 0.15,
    }.get(owners, 0)
    cond_mod = {"Excellent": 1.05, "Good": 1.0, "Fair": 0.92, "Needs Work": 0.82}.get(condition, 1.0)
    fuel_mod = {"Electric": 1.08, "Hybrid": 1.04}.get(fuel, 1.0)
    mid = round(base_p * (1 - dep - km_penalty - owner_penalty) * cond_mod * fuel_mod / 1000) * 1000
    low = round(mid * 0.90 / 1000) * 1000
    high = round(mid * 1.10 / 1000) * 1000
    return {"low": low, "mid": mid, "high": high, "dep": round((dep + km_penalty + owner_penalty) * 100)}


def heuristic_api(price: float, km: int, age: int, owners: int = 1, fuel: str = "petrol") -> float:
    if age <= 0:
        depreciation = 0.0
    elif age == 1:
        depreciation = 0.15
    else:
        depreciation = 0.15 + (min(age - 1, 9) * 0.10)
    depreciation = min(depreciation, 0.70)
    if km and age > 0:
        expected = age * 15000
        excess = max(0, km - expected)
        mileage_penalty = (excess // 10000) * 0.02
    else:
        mileage_penalty = 0.0
    fuel_factor = {"electric": 1.05, "hybrid": 1.02, "petrol": 1.0, "cng": 0.97, "diesel": 0.98}.get(fuel, 1.0)
    owner_penalty = owners * 0.03  # used listing
    fair = price * (1 - depreciation - mileage_penalty - owner_penalty) * fuel_factor
    fair = max(fair, price * 0.25)
    return round(fair / 1000) * 1000


# ── Inventory / existence ────────────────────────────────────────────────────
add(
    "Scope",
    "SC-00",
    "Mechanical/OBD AI Diagnosis module exists",
    "FAIL",
    "No /ai-diagnosis route, no DTC/symptom wizard, no OBD API — feature not implemented",
    "P0",
)
add(
    "Scope",
    "SC-01",
    "Closest feature: AI Valuation (price diagnosis)",
    "PASS",
    "Angular /ai-valuation, List-car valuation, Next ValuationButton, API POST /listings/{id}/valuate, Edge ai-valuation",
)

# ── Angular form UX ──────────────────────────────────────────────────────────
add(
    "Angular UX",
    "ANG-01",
    "Route /ai-valuation exists",
    "PASS" if "ai-valuation" in routes else "FAIL",
    "app.routes.ts loadComponent AiValuationComponent",
)
add(
    "Angular UX",
    "ANG-02",
    "Hero claims no sign-up but authGuard required",
    "FAIL",
    'HTML: "Free… no sign-up needed" vs routes canActivate:[authGuard] → login redirect',
    "P0",
)
add(
    "Angular UX",
    "ANG-03",
    "Form requires make/model/year/km/fuel/owners/condition",
    "PASS" if "formValid" in ts else "FAIL",
    "variant + transmission optional",
)
add(
    "Angular UX",
    "ANG-04",
    "Make→Model→Variant cascading catalogue",
    "PASS" if "onMakeChange" in ts and "availableVariants" in ts else "FAIL",
    "CATALOGUE drives dropdowns; Other → free-text model",
)
add(
    "Angular UX",
    "ANG-05",
    "Trust row claims 50,000+ valuations / actual sale prices",
    "FAIL",
    "Hardcoded marketing; no analytics counter; fallback is formula not sale prices",
    "P1",
)
add(
    "Angular UX",
    "ANG-06",
    "Results show low/mid/high + confidence + tips + CTAs",
    "PASS" if "Distress Sale" in html and "Fair Market" in html and "List My Car" in html else "FAIL",
    "result-section present",
)
add(
    "Angular UX",
    "ANG-07",
    "Silent fallback when Edge/Claude fails",
    "FAIL",
    "catch uses fallbackValuation() with no user banner that AI failed / heuristic used",
    "P0",
)
add(
    "Angular UX",
    "ANG-08",
    "Confidence uses Math.random()",
    "FAIL",
    "fallback confidence = 91+random or 78+random — non-deterministic, not real confidence",
    "P1",
)
add(
    "Angular UX",
    "ANG-09",
    "Subscription canUseFeature(ai_valuation) not enforced on page",
    "FAIL",
    "subscription.service gates ai_valuation to buyer_pro/dealer_pro but page never checks",
    "P1",
)
add(
    "Angular UX",
    "ANG-10",
    "ApiService.getAIValuation hits non-existent /ai/valuation/{id}",
    "FAIL",
    "Real API is POST /listings/{id}/valuate — dead client helper",
    "P1",
)
add(
    "Angular UX",
    "ANG-11",
    "SeoService not called in constructor (title/meta)",
    "FAIL" if "SeoService" not in ts or "seo.setPage" not in ts else "PASS",
    "Component injects only SupabaseService; no setPage for SEO",
    "P2",
)

# ── Fallback scoring scenarios ───────────────────────────────────────────────
scenarios = [
    (
        "FB-01",
        "Swift ZXi+ 2022 · 35k km · Petrol · 1st · Excellent",
        dict(make="Maruti Suzuki", year=2022, km=35000, fuel="Petrol", owners="1st Owner", condition="Excellent", base=swift_zxi),
        lambda r: r["mid"] > 0 and r["low"] < r["mid"] < r["high"],
    ),
    (
        "FB-02",
        "Creta segment · 5yr · 80k km · Diesel · 2nd · Fair",
        dict(make="Hyundai", year=datetime.now().year - 5, km=80000, fuel="Diesel", owners="2nd Owner", condition="Fair", base=1_299_000),
        lambda r: r["mid"] < 1_299_000 * 0.7,
    ),
    (
        "FB-03",
        "Electric premium vs Petrol same base",
        None,  # special
        None,
    ),
    (
        "FB-04",
        "Needs Work < Excellent same inputs",
        None,
        None,
    ),
    (
        "FB-05",
        "4th+ Owner penalty lowers mid",
        None,
        None,
    ),
    (
        "FB-06",
        "Brand-new year age=0 minimal dep",
        dict(make="Tata", year=datetime.now().year, km=500, fuel="Petrol", owners="1st Owner", condition="Excellent", base=899000),
        lambda r: r["mid"] >= 899000 * 0.95,  # cond 1.05 may boost above base
    ),
    (
        "FB-07",
        "Other make uses 900k segment fallback",
        dict(make="Other", year=2020, km=40000, fuel="Petrol", owners="1st Owner", condition="Good", base=None),
        lambda r: r["mid"] > 0,
    ),
    (
        "FB-08",
        "Range band ~±10%",
        dict(make="Honda", year=2021, km=30000, fuel="Petrol", owners="1st Owner", condition="Good", base=1_399_000),
        lambda r: abs(r["low"] / r["mid"] - 0.9) < 0.02 and abs(r["high"] / r["mid"] - 1.1) < 0.02,
    ),
]

for sid, name, params, pred in scenarios:
    if sid == "FB-03":
        p = fallback_valuation("Tata", 2022, 30000, "Petrol", "1st Owner", "Good", 1_149_000)
        e = fallback_valuation("Tata", 2022, 30000, "Electric", "1st Owner", "Good", 1_149_000)
        ok = e["mid"] > p["mid"]
        add("Fallback Scoring", sid, name, "PASS" if ok else "FAIL", f"petrol mid={p['mid']}, EV mid={e['mid']}")
        continue
    if sid == "FB-04":
        ex = fallback_valuation("Hyundai", 2021, 40000, "Petrol", "1st Owner", "Excellent", 1_299_000)
        nw = fallback_valuation("Hyundai", 2021, 40000, "Petrol", "1st Owner", "Needs Work", 1_299_000)
        ok = nw["mid"] < ex["mid"]
        add("Fallback Scoring", sid, name, "PASS" if ok else "FAIL", f"Excellent={ex['mid']}, NeedsWork={nw['mid']}")
        continue
    if sid == "FB-05":
        o1 = fallback_valuation("Maruti Suzuki", 2020, 50000, "Petrol", "1st Owner", "Good", 849000)
        o4 = fallback_valuation("Maruti Suzuki", 2020, 50000, "Petrol", "4th+ Owner", "Good", 849000)
        ok = o4["mid"] < o1["mid"]
        add("Fallback Scoring", sid, name, "PASS" if ok else "FAIL", f"1st={o1['mid']}, 4th+={o4['mid']}")
        continue
    assert params is not None and pred is not None
    r = fallback_valuation(**params)
    ok = pred(r)
    add(
        "Fallback Scoring",
        sid,
        name,
        "PASS" if ok else "FAIL",
        f"low={r['low']}, mid={r['mid']}, high={r['high']}, dep%={r['dep']}",
        "P0" if not ok else "—",
    )

# Transmission unused in fallback
add(
    "Fallback Scoring",
    "FB-09",
    "Transmission affects fallback valuation",
    "FAIL",
    "form.transmission collected but fallbackValuation never uses it",
    "P1",
)

# ── Edge function / Claude path ──────────────────────────────────────────────
add(
    "Edge Function",
    "EF-01",
    "supabase/functions/ai-valuation exists",
    "PASS" if "Anthropic" in edge else "FAIL",
    "Claude/Anthropic edge function",
)
add(
    "Edge Function",
    "EF-02",
    "Requires ANTHROPIC_API_KEY",
    "PASS" if "ANTHROPIC_API_KEY" in edge else "FAIL",
    "Returns 500 if missing — Angular then silent-falls back",
)
add(
    "Edge Function",
    "EF-03",
    "Model pin claude-opus-4-8",
    "PASS" if "claude-opus-4-8" in edge else "FAIL",
    "Hardcoded model; may break if alias renamed",
    "P2",
)
add(
    "Edge Function",
    "EF-04",
    "JSON.parse without fence stripping",
    "FAIL",
    "If Claude wraps JSON in ``` fences, parse throws → 500 → Angular fallback",
    "P1",
)
add(
    "Edge Function",
    "EF-05",
    "CORS Allow-Origin *",
    "PARTIAL",
    "Open CORS on edge function — OK for public tool but review for prod",
    "P2",
)
add(
    "Edge Function",
    "EF-06",
    "No rate limit / abuse protection in function",
    "FAIL",
    "Unauthenticated invoke possible from client if anon key allows functions; costly Claude calls",
    "P0",
)

# ── List Your Car integration ────────────────────────────────────────────────
add(
    "List Your Car",
    "LC-01",
    "Wizard invokes same ai-valuation edge function",
    "PASS" if "functions.invoke('ai-valuation'" in list_car else "FAIL",
    "fetchValuation in list-car.component.ts",
)
add(
    "List Your Car",
    "LC-02",
    "8s timeout then ruleBasedValuation",
    "PASS" if "timeout" in list_car and "ruleBasedValuation" in list_car else "FAIL",
    "Seller always gets a number",
)
add(
    "List Your Car",
    "LC-03",
    "Two different fallback engines (page vs list-car)",
    "FAIL",
    "ai-valuation.fallbackValuation vs list-car.ruleBasedValuation — same car can get different mid",
    "P0",
)
add(
    "List Your Car",
    "LC-04",
    "Persists to ai_valuation table on submit",
    "PASS" if "ai_valuation" in list_car and "insert" in list_car else "FAIL",
    "insert after publish (verify path in component)",
)

# ── API / Next ───────────────────────────────────────────────────────────────
add(
    "API",
    "API-01",
    "POST /listings/{id}/valuate exists",
    "PASS" if (ROOT / "apps/api/routers/listings.py").read_text().find("/valuate") >= 0 else "FAIL",
    "Persists ai_valuation + ai_valuation_at",
)
add(
    "API",
    "API-02",
    "Ollama primary + heuristic fallback + circuit breaker",
    "PASS" if "_try_ollama" in api_val and "_heuristic_valuation" in api_val and "_CB_THRESHOLD" in api_val else "FAIL",
    "services/valuation.py",
)
add(
    "API",
    "API-03",
    "Heuristic uses asking price as base (circular)",
    "FAIL",
    "fair_value = listing.price * (1-dep…) — valuates from ask price, not independent market base",
    "P0",
)
add(
    "API",
    "API-04",
    "Heuristic ignores listing.condition",
    "FAIL",
    "_heuristic_valuation never reads listing.condition",
    "P1",
)
add(
    "API",
    "API-05",
    "Response does not expose method/confidence/reasoning to UI",
    "FAIL",
    "estimate_valuation returns 4-tuple but ListingOut only stores ai_valuation float",
    "P0",
)
add(
    "API",
    "API-06",
    "Dual AI stacks: Angular Claude vs API Ollama",
    "FAIL",
    "Same product name, two providers, two schemas (low/mid/high vs single float)",
    "P0",
)

# API heuristic numeric scenarios
api_cases = [
    ("AH-01", "New (age0) used listing ~3% owner pen", heuristic_api(1_000_000, 0, 0, 1), (950_000, 1_000_000)),
    ("AH-02", "1yr ~15% dep", heuristic_api(1_000_000, 10_000, 1, 1), (800_000, 870_000)),
    ("AH-03", "High mileage < normal", None, None),
    ("AH-04", "EV > petrol", None, None),
    ("AH-05", "Floor ≥25% ask", heuristic_api(500_000, 300_000, 15, 5), (125_000, 500_000)),
]
for sid, name, val, band in api_cases:
    if sid == "AH-03":
        n = heuristic_api(1_000_000, 30_000, 3)
        h = heuristic_api(1_000_000, 80_000, 3)
        ok = h < n
        add("API Heuristic", sid, name, "PASS" if ok else "FAIL", f"normal={n}, high_km={h}")
        continue
    if sid == "AH-04":
        p = heuristic_api(1_000_000, 20_000, 2, fuel="petrol")
        e = heuristic_api(1_000_000, 20_000, 2, fuel="electric")
        ok = e > p
        add("API Heuristic", sid, name, "PASS" if ok else "FAIL", f"petrol={p}, electric={e}")
        continue
    assert val is not None and band is not None
    lo, hi = band
    ok = lo <= val <= hi
    add("API Heuristic", sid, name, "PASS" if ok else "FAIL", f"value={val}, expected [{lo},{hi}]", "P0" if not ok else "—")

add(
    "Next UI",
    "NX-01",
    "ValuationButton on listing detail",
    "PASS" if "valuate" in btn and "Get AI Valuation" in btn else "FAIL",
    "apps/web/components/valuation-button.tsx",
)
add(
    "Next UI",
    "NX-02",
    "Requires auth (sign in to valuate)",
    "PASS" if "Sign in to valuate" in btn else "FAIL",
    "Redirects to /login when no session",
)
add(
    "Next UI",
    "NX-03",
    "Shows only single float — no range/tips/method",
    "FAIL",
    "UI displays ai_valuation number only; no low/mid/high, confidence, or heuristic badge",
    "P1",
)
add(
    "Next UI",
    "NX-04",
    "No dedicated /valuate or /ai-valuation page on Next",
    "FAIL",
    "Home markets AI Price Valuation but no standalone Next tool page (only listing button)",
    "P1",
)
add(
    "Next UI",
    "NX-05",
    "Compare page shows AI Valuation column",
    "PASS" if "AI Valuation" in (ROOT / "apps/web/app/compare/page.tsx").read_text() else "FAIL",
    "Uses listing.ai_valuation",
)

# Car detail Angular display
add(
    "Car Detail",
    "CD-01",
    "Angular car-detail shows aiValuation card",
    "PASS" if "aiValuation" in car_detail_html else "FAIL",
    "fairPrice / marketMin / marketMax / verdict from Supabase ai_valuation table",
)
add(
    "Car Detail",
    "CD-02",
    "Car-detail valuation not live-recomputed",
    "FAIL",
    "Displays stored row only; no Get Valuation CTA wired to Edge/API",
    "P1",
)

# Home mislabel
add(
    "Platform",
    "PF-01",
    "Home AI Price Valuation card routes to /ai-advisor",
    "FAIL" if "AI Price Valuation" in home and "/ai-advisor" in home else "PASS",
    "Wrong destination — should be /ai-valuation",
    "P0",
)
add(
    "Platform",
    "PF-02",
    "FAB / footer link to /ai-valuation",
    "PASS",
    "home FAB + footer AI Valuation link exist",
)
add(
    "Platform",
    "PF-03",
    "No Playwright e2e for /ai-valuation",
    "FAIL",
    "No Angular valuation e2e; API has test_valuation.py only",
    "P1",
)
add(
    "Platform",
    "PF-04",
    "Three schemas for one feature",
    "FAIL",
    "Edge:{low,mid,high,confidence,tips} | API:float | Supabase table:{fair_price,market_min,max,verdict}",
    "P0",
)

counts = Counter(r["status"] for r in results)
summary = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "scope_note": (
        "No mechanical AI Diagnosis module. Tested AI Valuation (price diagnosis) "
        "as the implemented diagnosis-like feature."
    ),
    "counts": dict(counts),
    "total": len(results),
    "results": results,
}
(QA / "ai-diagnosis-scenarios.json").write_text(json.dumps(summary, indent=2))
(ART / "ai-diagnosis-scenarios.json").write_text(json.dumps(summary, indent=2))
print("TOTAL", len(results), dict(counts))
for r in results:
    if r["status"] != "PASS":
        print(f"{r['status']:7} {r['id']:7} {r['name'][:70]}")
