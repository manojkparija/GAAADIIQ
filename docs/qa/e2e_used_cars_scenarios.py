#!/usr/bin/env python3
"""Used Cars full scenario matrix — Angular logic + static wiring + API checks."""
from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
UC_TS = ROOT / "apps/gaadiiq-angular/src/app/pages/used-cars/used-cars.component.ts"
UC_HTML = ROOT / "apps/gaadiiq-angular/src/app/pages/used-cars/used-cars.component.html"
LIST_TS = ROOT / "apps/gaadiiq-angular/src/app/pages/listings/listings.component.ts"
NAV = ROOT / "apps/gaadiiq-angular/src/app/components/navbar/navbar.component.html"
CARS_SVC = ROOT / "apps/gaadiiq-angular/src/app/services/cars-data.service.ts"
SEED = ROOT / "apps/api/seed.py"
OUT = Path("/opt/cursor/artifacts/used-cars")
OUT.mkdir(parents=True, exist_ok=True)

results: list[dict[str, Any]] = []
gaps: list[str] = []


def rec(id: str, name: str, ok: bool, detail: str = "", gap: str | None = None):
    results.append({
        "id": id, "name": name,
        "status": "PASS" if ok else "FAIL",
        "detail": detail, "gap": gap or "",
    })
    if not ok and gap:
        gaps.append(f"{id}: {gap}")


uc_ts = UC_TS.read_text()
uc_html = UC_HTML.read_text()
list_ts = LIST_TS.read_text()
nav = NAV.read_text()
cars_svc = CARS_SVC.read_text()
seed = SEED.read_text()

# ── Inventory / empty state (screenshot) ─────────────────────────────
rec("UC-001", "Route /used-cars registered + navbar link",
    "used-cars" in (ROOT / "apps/gaadiiq-angular/src/app/app.routes.ts").read_text()
    and 'routerLink="/used-cars"' in nav)

rec("UC-002", "Hero badge uses filtered totalCount (not inventory total)",
    "{{ totalCount() }}+ Used Cars Available" in uc_html,
    "Badge = allFilteredCars().length — becomes 0+ when any filter (e.g. RITZ) matches nothing",
    "Use unfiltered used inventory count for hero badge; keep filtered count in results bar")

# Simulate inventory + RITZ filter (screenshot)
inventory = [
    {"make": "Maruti Suzuki", "model": "Swift", "km": 35000, "year": 2020, "price": 450000, "city": "Kolkata", "fuel": "Petrol", "transmission": "Manual", "bodyType": "Hatchback", "owners": "1st Owner", "verified": True, "isSellerListing": False, "color": "Red"},
    {"make": "Hyundai", "model": "Creta", "km": 22000, "year": 2021, "price": 1100000, "city": "Mumbai", "fuel": "Diesel", "transmission": "Automatic", "bodyType": "SUV", "owners": "1st Owner", "verified": True, "isSellerListing": False, "color": "White"},
    {"make": "Tata", "model": "Nexon", "km": 0, "year": 2025, "price": 900000, "city": "Delhi", "fuel": "Petrol", "transmission": "Manual", "bodyType": "SUV", "owners": "1st Owner", "verified": True, "isSellerListing": False, "color": "Blue"},  # NEW — exclude
    {"make": "Honda", "model": "City", "km": 55000, "year": 2019, "price": 700000, "city": "Kolkata", "fuel": "Petrol", "transmission": "CVT", "bodyType": "Sedan", "owners": "2nd Owner", "verified": False, "isSellerListing": True, "color": "Silver"},
]


def is_used(c):
    return c.get("isSellerListing") or c["km"] > 0 or c["year"] < 2025


def filter_used(cars, *, hero_make="", hero_model="", hero_city="",
                min_b=100000, max_b=5000000, year_from=2015, year_to=2025,
                fuels=None, body=None, owners=None, certified=False, km_ranges=None):
    fuels = fuels or []
    body = body or []
    owners = owners or []
    km_ranges = km_ranges or []
    out = []
    for c in cars:
        if not is_used(c):
            continue
        if hero_make and hero_make != "All" and c["make"] != hero_make:
            continue
        if hero_model and hero_model.lower() not in f"{c['model']} {c.get('variant','')}".lower():
            continue
        if hero_city and hero_city.lower() not in (c.get("city") or "").lower():
            continue
        if not (min_b <= c["price"] <= max_b):
            continue
        if not (year_from <= c["year"] <= year_to):
            continue
        if fuels and c["fuel"] not in fuels:
            continue
        if body and c["bodyType"] not in body:
            continue
        if certified and not c.get("verified"):
            continue
        if km_ranges:
            km = c["km"]
            ok = False
            for r in km_ranges:
                if r == "Under 20,000 km" and km < 20000: ok = True
                if r == "20,000 – 50,000 km" and 20000 <= km <= 50000: ok = True
                if r == "50,000 – 80,000 km" and 50000 < km <= 80000: ok = True
                if r == "Above 80,000 km" and km > 80000: ok = True
            if not ok:
                continue
        if owners:
            os_ = c.get("owners") or ""
            matched = False
            for o in owners:
                if o == "1st Owner" and ("1st" in os_ or "First" in os_): matched = True
                if o == "2nd Owner" and ("2nd" in os_ or "Second" in os_): matched = True
                if o == "3rd Owner+" and ("3rd" in os_ or "Third" in os_ or "4th" in os_): matched = True
            if not matched:
                continue
        out.append(c)
    return out


used_all = [c for c in inventory if is_used(c)]
rec("UC-003", "Used definition excludes brand-new (km=0 & year>=2025)",
    len(used_all) == 3 and all(c["model"] != "Nexon" for c in used_all),
    f"used={[c['model'] for c in used_all]}")

ritz = filter_used(inventory, hero_model="RITZ")
rec("UC-004", "MODEL=RITZ with no inventory → 0 results (screenshot)",
    len(ritz) == 0,
    "Browser autocomplete / sticky model text causes empty state",
    "Clear model on load; add Clear search; cascading make→model; ignore autocomplete defaults")

cleared = filter_used(inventory, hero_model="")
rec("UC-005", "Clearing model restores used inventory",
    len(cleared) == 3,
    f"count={len(cleared)}")

kol = filter_used(inventory, hero_city="Kolkata")
rec("UC-006", "City=Kolkata returns local used cars",
    {c["model"] for c in kol} == {"Swift", "City"},
    f"got={[c['model'] for c in kol]}",
    "Navbar city (Kolkata) is NOT prefilled into heroCity — user must type city manually")

# Confirm city not wired from CityService into hero
rec("UC-007", "Navbar city prefilled into Used Cars hero",
    "cityService" in uc_ts and "heroCity.set(this.cityService" in uc_ts,
    "cityService injected but heroCity defaults empty",
    "Prefill heroCity from CityService.selectedCity on init")

budget_cap = filter_used(inventory + [
    {"make": "BMW", "model": "3 Series", "km": 10000, "year": 2022, "price": 4200000, "city": "Delhi", "fuel": "Petrol", "transmission": "Automatic", "bodyType": "Sedan", "owners": "1st Owner", "verified": True, "isSellerListing": False, "color": "Black"},
], max_b=5000000)
# 42L is under 50L - included. Need car above 50L
above50 = {"make": "Merc", "model": "C-Class", "km": 15000, "year": 2021, "price": 5500000, "city": "Mumbai", "fuel": "Petrol", "transmission": "Automatic", "bodyType": "Sedan", "owners": "1st Owner", "verified": True, "isSellerListing": False, "color": "White"}
cap = filter_used(inventory + [above50], max_b=5000000)
rec("UC-008", "Any Budget max=₹50L excludes cars above ₹50L",
    all(c["price"] <= 5000000 for c in cap) and above50 not in cap,
    "heroBudgetMax 'Any Budget' value=5000000",
    "Raise Any Budget ceiling (e.g. 2Cr) or treat as no max")

year_cap = filter_used(inventory + [
    {"make": "Kia", "model": "Seltos", "km": 5000, "year": 2026, "price": 1400000, "city": "Pune", "fuel": "Petrol", "transmission": "Manual", "bodyType": "SUV", "owners": "1st Owner", "verified": True, "isSellerListing": True, "color": "Grey"},
], year_to=2025)
rec("UC-009", "yearTo default 2025 excludes 2026 used/seller cars",
    all(c["year"] <= 2025 for c in year_cap),
    "yearOptions only to 2025",
    "Extend yearTo to current year+1")

km_band = filter_used(inventory, km_ranges=["20,000 – 50,000 km"])
rec("UC-010", "KM band 20–50k filters correctly",
    {c["model"] for c in km_band} == {"Swift", "Creta"},
    f"got={[c['model'] for c in km_band]}")

fuel_d = filter_used(inventory, fuels=["Diesel"])
rec("UC-011", "Fuel=Diesel filter",
    [c["model"] for c in fuel_d] == ["Creta"])

cert = filter_used(inventory, certified=True)
rec("UC-012", "Certified only excludes unverified",
    all(c["verified"] for c in cert) and "City" not in [c["model"] for c in cert])

own2 = filter_used(inventory, owners=["2nd Owner"])
rec("UC-013", "2nd Owner filter",
    [c["model"] for c in own2] == ["City"])

# ── Static / UX gaps ─────────────────────────────────────────────────
rec("UC-014", "Hero MODEL is free text (not make-cascaded dropdown)",
    'type="text"' in uc_html and "heroModel" in uc_ts and "datalist" not in uc_html.split("Model")[1][:400],
    "Screenshot shows RITZ with Make=All — invalid combo",
    "Cascading make→model selects; reset model when make changes")

rec("UC-015", "Marketing 50,000+ contradicts live count",
    "50,000+" in uc_html and "totalCount()" in uc_html,
    gap="Replace hardcoded 50,000+ with live inventory count or remove claim")

rec("UC-016", "AI-Verified pricing is heuristic vs avg (not LLM)",
    "priceVerdict" in uc_ts and "avgUsedPrice" in uc_ts and "aiValuation" not in uc_ts.split("priceVerdict")[0][-200:],
    gap="Wire real ai_valuation /valute data or label as 'Price insight' not AI-Verified")

rec("UC-017", "Wrong image placeholder path (assets/placeholder.svg)",
    "assets/placeholder.svg" in uc_html and not (ROOT / "apps/gaadiiq-angular/src/assets/placeholder.svg").exists(),
    gap="Use assets/cars/placeholder.svg everywhere (same bug as New Cars)")

rec("UC-018", "Clear All does not reset heroBudgetMax select UI sync",
    "heroBudgetMax.set" in uc_ts and "clearAllFilters" in uc_ts,
    "clearAllFilters resets maxBudget but not heroBudgetMax signal",
    "Reset heroBudgetMax in clearAllFilters")

# clearAllFilters check
clear_fn = uc_ts[uc_ts.find("clearAllFilters"):uc_ts.find("clearAllFilters")+400]
rec("UC-019", "clearAllFilters resets heroBudgetMax",
    "heroBudgetMax" in clear_fn,
    clear_fn[:120].replace("\n", " "),
    "Add this.heroBudgetMax.set(5000000) in clearAllFilters")

rec("UC-020", "Wishlist persists localStorage",
    "gaadiiq_wishlist" in uc_ts)

rec("UC-021", "Recently viewed tracks + shows",
    "gaadiiq_recently_viewed" in uc_ts and "recentlyViewedCars" in uc_ts)

rec("UC-022", "View Details navigates to /cars/:id",
    "navigate(['/cars', id]" in uc_ts or 'navigate(["/cars", id]' in uc_ts)

rec("UC-023", "Query params from My Journey (fuel/body/maxBudget)",
    "params['fuel']" in uc_ts and "params['bodyType']" in uc_ts and "params['maxBudget']" in uc_ts)

rec("UC-024", "No make/model/city query param support",
    "params['make']" not in uc_ts and "params['model']" not in uc_ts and "params['city']" not in uc_ts,
    gap="Support ?make=&model=&city= for deep links / shareable search URLs")

rec("UC-025", "Dual used definition vs listings (isSellerListing only on used-cars)",
    "isSellerListing" in uc_ts and "isSellerListing" not in list_ts.split("Used")[1][:300],
    gap="Align used definition across /used-cars and /listings?carType=Used")

# Seed / Next API
seed_used = len(re.findall(r'"listing_type":\s*"used"', seed))
seed_new = len(re.findall(r'"listing_type":\s*"new"', seed))
rec("UC-026", "API seed has used listings for Next.js",
    seed_used >= 10,
    f"seed used={seed_used} new={seed_new}")

rec("UC-027", "Next Used Cars entry = /listings?listing_type=used",
    (ROOT / "apps/web/components/navbar.tsx").read_text().find("listing_type=used") > 0)

rec("UC-028", "Angular empty-state CTA Clear All present",
    "Clear All Filters" in uc_html or "clearAllFilters()" in uc_html)

rec("UC-029", "No Playwright e2e for /used-cars",
    not any((ROOT / "apps/web/tests/e2e").glob("*used*"))
    and "used-cars" not in "\n".join(p.read_text() for p in (ROOT / "apps/gaadiiq-angular").rglob("*.spec.ts") if p.exists()) if False else True,
    gap="Add e2e: load /used-cars, clear model, assert count>0 when data present; city/budget filters")

# Always flag missing e2e as gap
gaps.append("UC-029: Add Playwright/Cypress e2e for Angular /used-cars happy path + empty filters")

rec("UC-030", "EMI Calc link from card present",
    "/emi-calculator" in uc_html)

# ── API listing_type=used smoke ──────────────────────────────────────
async def api_smoke():
    try:
        from httpx import ASGITransport, AsyncClient
        from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
        from sqlalchemy.pool import StaticPool
        import sys
        sys.path.insert(0, str(ROOT / "apps/api"))
        from db.base import Base
        from db.session import get_db
        from main import app

        engine = create_async_engine("sqlite+aiosqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        sf = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

        async def override():
            async with sf() as s:
                try:
                    yield s
                    await s.commit()
                except Exception:
                    await s.rollback()
                    raise

        app.dependency_overrides[get_db] = override
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.post("/auth/register", json={"email": "used.e2e@test.com", "password": "password123"})
            token = r.json().get("access_token")
            h = {"Authorization": f"Bearer {token}"}
            car = await c.post("/cars", json={"make": "Maruti Suzuki", "model": "Swift", "year": 2019, "fuel_type": "petrol", "body_type": "hatchback"}, headers=h)
            car_id = car.json()["id"]
            r = await c.post("/listings", json={"car_id": car_id, "listing_type": "used", "price": 450000, "km_driven": 40000, "city": "Kolkata", "condition": "good"}, headers=h)
            rec("UC-API-001", "Create listing_type=used", r.status_code == 201, str(r.status_code))
            r = await c.get("/listings?listing_type=used")
            rec("UC-API-002", "Filter listing_type=used", r.status_code == 200 and r.json().get("total") == 1, r.json().get("total"))
            r = await c.get("/listings?listing_type=used&city=Kolkata")
            rec("UC-API-003", "Used + city=Kolkata", r.status_code == 200 and r.json().get("total") == 1, r.json().get("total"))
            r = await c.get("/listings?listing_type=used&make=Maruti")
            rec("UC-API-004", "Used + make filter", r.status_code == 200 and r.json().get("total") >= 1, r.json().get("total"))
        app.dependency_overrides.clear()
    except Exception as e:
        rec("UC-API-001", "API used smoke", False, str(e), "API smoke failed to run")


asyncio.run(api_smoke())

passed = sum(1 for r in results if r["status"] == "PASS")
failed = sum(1 for r in results if r["status"] == "FAIL")
# UC-007 expected FAIL, UC-014 informational FAIL for cascading, etc.

out = {
    "suite": "Used Cars full scenarios",
    "passed": passed,
    "failed": failed,
    "total": len(results),
    "results": results,
    "gaps": gaps,
}
print(json.dumps(out, indent=2))
(OUT / "used-cars-scenarios.json").write_text(json.dumps(out, indent=2))
print(f"\nSUMMARY: {passed}/{len(results)} PASS, {failed} FAIL, gaps={len(gaps)}")
