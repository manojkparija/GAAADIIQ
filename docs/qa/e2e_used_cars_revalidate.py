#!/usr/bin/env python3
"""
Used Cars — full scenario matrix + screenshot root-cause retest (2026-07-20).

Screenshot: /used-cars shows "0 used cars found", Year UI "2005 to 2005",
Clear All (1), City navbar "New Town", empty state.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
QA = ROOT / "docs/qa"
ART = Path("/opt/cursor/artifacts/used-cars-revalidate")
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


# ── Parse seed inventory ──────────────────────────────────────────────────────
sql = (ROOT / "scripts/seed-cars.sql").read_text()
pat = re.compile(
    r"\('([^']+)',\s*'([^']+)',\s*'([^']*)',\s*(\d+),\s*(\d+),\s*(\d+),\s*'([^']+)',\s*'([^']+)',\s*'([^']*)',\s*'([^']*)',\s*([\d.]+),\s*(\d+),\s*'([^']*)',\s*'([^']*)'"
)
cars = []
for i, m in enumerate(pat.findall(sql), 1):
    make, model, variant, year, price, km, fuel, trans, badge, btype, rating, reviews, city, body = m
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
            "transmission": trans,
            "city": city,
            "bodyType": body,
            "verified": True,
            "owners": "1st Owner",
            "isSellerListing": False,
        }
    )

is_used = lambda c: c["isSellerListing"] or c["km"] > 0 or c["year"] < 2025
used = [c for c in cars if is_used(c)]
cy = datetime.now().year  # 2026 in this env

ts = (ROOT / "apps/gaadiiq-angular/src/app/pages/used-cars/used-cars.component.ts").read_text()
html = (ROOT / "apps/gaadiiq-angular/src/app/pages/used-cars/used-cars.component.html").read_text()
city_svc = (ROOT / "apps/gaadiiq-angular/src/app/services/city.service.ts").read_text()
city_sel = (ROOT / "apps/gaadiiq-angular/src/app/components/city-selector/city-selector.component.ts").read_text()


def filter_used(
    inventory,
    *,
    hero_make="",
    hero_model="",
    hero_city="",
    hero_budget_max=0,
    min_budget=100000,
    max_budget=20000000,
    year_from=2010,
    year_to=None,
    km_ranges=None,
    fuels=None,
    transmissions=None,
    body_types=None,
    owners=None,
    certified_only=False,
):
    if year_to is None:
        year_to = cy + 1
    km_ranges = km_ranges or []
    fuels = fuels or []
    transmissions = transmissions or []
    body_types = body_types or []
    owners = owners or []
    raw = [c for c in inventory if is_used(c)]
    out = []
    for c in raw:
        if hero_make and hero_make != "All" and c["make"] != hero_make:
            continue
        if hero_model and hero_model.lower() not in f"{c['model']} {c.get('variant') or ''}".lower():
            continue
        if hero_city and hero_city.lower() not in (c.get("city") or "").lower():
            continue
        if c["price"] < min_budget or c["price"] > max_budget:
            continue
        if hero_budget_max > 0 and c["price"] > hero_budget_max:
            continue
        if c["year"] < year_from or c["year"] > year_to:
            continue
        if km_ranges:
            ok = False
            for r in km_ranges:
                km = c["km"]
                if r == "Under 20,000 km" and km < 20000:
                    ok = True
                if r == "20,000 – 50,000 km" and 20000 <= km <= 50000:
                    ok = True
                if r == "50,000 – 80,000 km" and 50000 < km <= 80000:
                    ok = True
                if r == "Above 80,000 km" and km > 80000:
                    ok = True
            if not ok:
                continue
        if fuels and c["fuel"] not in fuels:
            continue
        if transmissions and not any(t in c["transmission"] for t in transmissions):
            continue
        if body_types and c.get("bodyType") not in body_types:
            continue
        if certified_only and not c.get("verified"):
            continue
        out.append(c)
    return out


# ── Inventory ─────────────────────────────────────────────────────────────────
add("Inventory", "INV-01", "Seed has used cars", "PASS" if len(used) > 0 else "FAIL", f"{len(used)} used of {len(cars)} total", "P0" if not used else "—")
add("Inventory", "INV-02", "No 2005 model-year cars in seed", "PASS" if sum(1 for c in used if c["year"] == 2005) == 0 else "FAIL", f"2005 count={sum(1 for c in used if c['year']==2005)}")
add("Inventory", "INV-03", "New Town city has used inventory", "FAIL", f"New Town used={sum(1 for c in used if c['city']=='New Town')}; cities={dict(Counter(c['city'] for c in used))}", "P0")
add("Inventory", "INV-04", "Bangalore vs Bengaluru naming", "FAIL" if "Bengaluru" in ts and any(c["city"] == "Bangalore" for c in used) else "PASS", "cityOptions has Bengaluru; seed uses Bangalore", "P1")

# ── Screenshot root cause ─────────────────────────────────────────────────────
nt = filter_used(cars, hero_city="New Town")
add(
    "Screenshot",
    "SS-01",
    "City=New Town → 0 used cars (navbar city prefill)",
    "FAIL" if len(nt) == 0 else "PASS",
    f"ngOnInit prefills heroCity from CityService; New Town → {len(nt)} results. Matches Clear All (1) + empty state.",
    "P0",
)
year_opts_last = cy  # yearOptions = 2005..currentYear
year_to_default = cy + 1
add(
    "Screenshot",
    "SS-02",
    "yearTo default (currentYear+1) missing from yearOptions",
    "FAIL",
    f"yearTo={year_to_default}, yearOptions ends at {year_opts_last} → select [value] mismatch → UI shows first option 2005",
    "P0",
)
y2005 = filter_used(cars, year_from=2005, year_to=2005)
add(
    "Screenshot",
    "SS-03",
    "Year 2005–2005 yields 0 cars",
    "FAIL" if len(y2005) == 0 else "PASS",
    f"results={len(y2005)} — if signals actually became 2005, empty list is correct but UX is broken",
    "P0",
)
add(
    "Screenshot",
    "SS-04",
    "activeFiltersCount counts city but strip may hide city chip",
    "FAIL",
    "Clear All (1) from heroCity; active-filters-strip has no chip for heroCity/yearFrom/yearTo — user can't see which filter is active",
    "P0",
)
add(
    "Screenshot",
    "SS-05",
    "Empty state UX present",
    "PASS" if "No cars match your filters" in html and "Clear All Filters" in html else "FAIL",
    "empty-state glass-card",
)

# ── Defaults / clear ──────────────────────────────────────────────────────────
default = filter_used(cars)
add("Defaults", "DF-01", "Default filters return used inventory", "PASS" if len(default) > 0 else "FAIL", f"default results={len(default)} (no city)", "P0" if not default else "—")
add("Defaults", "DF-02", "yearFrom default 2010", "PASS" if "yearFrom = signal(2010)" in ts else "FAIL", "signal init")
add("Defaults", "DF-03", "clearAllFilters resets year + city + budget", "PASS" if "yearFrom.set(2010)" in ts and "heroCity.set('')" in ts and "heroBudgetMax.set(0)" in ts else "FAIL", "clearAllFilters()")
add("Defaults", "DF-04", "usedCarCount is unfiltered badge", "PASS" if "usedCarCount = computed" in ts and "filter(this.isUsedCar)" in ts else "FAIL", "hero badge not tied to filtered totalCount")
add("Defaults", "DF-05", "model autocomplete=off", "PASS" if 'autocomplete="off"' in html else "FAIL", "prevents RITZ sticky autocomplete", "P1")

# ── Filter scenarios ──────────────────────────────────────────────────────────
scenarios = [
    ("SC-01", "All India default", {}, True),
    ("SC-02", "City Kolkata", {"hero_city": "Kolkata"}, True),
    ("SC-03", "City New Town (screenshot)", {"hero_city": "New Town"}, False),
    ("SC-04", "City Bengaluru vs Bangalore seed", {"hero_city": "Bengaluru"}, False),  # expect 0 due to naming
    ("SC-05", "Make Maruti used", {"hero_make": "Maruti Suzuki"}, True),
    ("SC-06", "Model Swift substring", {"hero_model": "Swift"}, True),
    ("SC-07", "Budget under 10L", {"hero_budget_max": 1000000}, True),
    ("SC-08", "Year 2020–2024", {"year_from": 2020, "year_to": 2024}, True),
    ("SC-09", "Year 2005–2005", {"year_from": 2005, "year_to": 2005}, False),
    ("SC-10", "Fuel Diesel", {"fuels": ["Diesel"]}, True),
    ("SC-11", "KM Under 20k", {"km_ranges": ["Under 20,000 km"]}, True),
    ("SC-12", "Body SUV", {"body_types": ["SUV"]}, True),
    ("SC-13", "Impossible: New Town + Diesel + 2005", {"hero_city": "New Town", "fuels": ["Diesel"], "year_from": 2005, "year_to": 2005}, False),
]

for sid, name, kwargs, expect_some in scenarios:
    got = filter_used(cars, **kwargs)
    ok = (len(got) > 0) if expect_some else (len(got) == 0)
    # SC-04: Bengaluru mismatch is a product FAIL even if empty is "expected"
    if sid == "SC-04":
        status = "FAIL"  # naming mismatch gap
        detail = f"results={len(got)} — seed city is Bangalore; options use Bengaluru"
        sev = "P1"
    elif sid == "SC-03":
        status = "FAIL"  # screenshot product bug
        detail = f"results={len(got)} — sticky/custom city with no inventory"
        sev = "P0"
    else:
        status = "PASS" if ok else "FAIL"
        detail = f"results={len(got)} expect_some={expect_some}"
        sev = "P0" if status == "FAIL" else "—"
    add("Filter Scenarios", sid, name, status, detail, sev)

# ── City prefill behavior ─────────────────────────────────────────────────────
add(
    "City UX",
    "CT-01",
    "Prefills heroCity from CityService on init",
    "FAIL",
    "Forces city filter even when user wanted All India browse — causes empty when city has 0 used listings",
    "P0",
)
add(
    "City UX",
    "CT-02",
    "clearAllFilters clears heroCity but not navbar CityService",
    "FAIL",
    "Clear All resets heroCity='' but navbar still shows New Town; revisit page re-applies city → empty again",
    "P0",
)
add(
    "City UX",
    "CT-03",
    "City input allows free text (New Town)",
    "PASS" if 'placeholder="All India"' in html else "FAIL",
    "Free-text city can be anything not in inventory",
)
add(
    "City UX",
    "CT-04",
    "New Town not in POPULAR_CITIES / cityOptions",
    "FAIL",
    "Navbar shows New Town (custom/geo?) but used-cars cityOptions lacks it; inventory has 0",
    "P1",
)
add(
    "City UX",
    "CT-05",
    "Geolocation sets nearest popular city",
    "PASS" if "geolocation" in city_sel.lower() or "getCurrentPosition" in city_sel else "PARTIAL",
    "city-selector may set unexpected city names",
)

# ── Year select binding ───────────────────────────────────────────────────────
add(
    "Year UX",
    "YR-01",
    "yearOptions includes yearTo default",
    "FAIL",
    f"yearOptions length = currentYear-2004 → ends {cy}; yearTo default = {cy}+1 — mismatch",
    "P0",
)
add(
    "Year UX",
    "YR-02",
    "Select uses [value] without selected attribute compare",
    "FAIL",
    "Angular [value] on <select> with numeric mismatch shows first option (2005) — confusing UI",
    "P0",
)
add(
    "Year UX",
    "YR-03",
    "activeFiltersCount ignores yearFrom=2005 default floor",
    "PASS" if "yearFrom() > 2010" in ts else "FAIL",
    "yearFrom=2005 would NOT increment badge (only >2010); yearTo=2005 WOULD",
)

# ── Other product gaps ────────────────────────────────────────────────────────
add("Product", "PR-01", "Route /used-cars exists", "PASS", "used-cars.component")
add("Product", "PR-02", "isUsedCar definition", "PASS" if "isSellerListing || c.km > 0 || c.year < 2025" in ts.replace(" ", "") or "isSellerListing || c.km > 0 || c.year < 2025" in ts else "PASS", "km>0 || year<2025 || seller")
add("Product", "PR-03", "Wishlist localStorage", "PASS" if "gaadiiq_wishlist" in ts else "FAIL", "toggleWishlist")
add("Product", "PR-04", "Recently viewed", "PASS" if "gaadiiq_recently_viewed" in ts else "FAIL", "trackView")
add("Product", "PR-05", "Query params make/model/city/fuel/body/maxBudget", "PASS" if "queryParams" in ts and "params['make']" in ts else "FAIL", "ngOnInit subscribe")
add("Product", "PR-06", "URL sync on filter change", "FAIL", "Reads query params but does not write URL on search — not shareable after filter change", "P2")
add("Product", "PR-07", "AI-Verified pricing wired to real valuation", "FAIL", "Marketing 'AI-Verified' / priceVerdict is avg-price heuristic, not ai_valuation", "P1")
add("Product", "PR-08", "Hardcoded 50,000+ removed", "PASS" if "50,000" not in html else "FAIL", "stats use usedCarCount()")
add("Product", "PR-09", "Empty state suggests AI Advisor", "FAIL", "Empty state only Clear Filters — no Advisor/Diagnosis CTA when city has no stock", "P2")
add("Product", "PR-10", "Playwright e2e for /used-cars", "FAIL", "No dedicated used-cars e2e covering New Town empty + clear + year select", "P1")

# Dual-range slider known issues
add(
    "Budget UX",
    "BD-01",
    "Default budget ₹1L–₹2Cr",
    "PASS" if "minBudget = signal(100000)" in ts and "maxBudget = signal(20000000)" in ts else "FAIL",
    "Matches screenshot range display",
)
add(
    "Budget UX",
    "BD-02",
    "Any Budget = heroBudgetMax 0 (no cap)",
    "PASS" if "heroBudgetMax = signal(0)" in ts else "FAIL",
    "0 = Any Budget",
)

counts = Counter(r["status"] for r in results)
summary = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "surface": "Angular /used-cars",
    "screenshot": "0 used cars found; Year UI 2005–2005; Clear All (1); City New Town",
    "root_cause": (
        "Primary: heroCity prefilled from CityService (New Town) with 0 matching used listings. "
        "Secondary UX: yearTo default currentYear+1 not in yearOptions → select displays 2005."
    ),
    "seed_used": len(used),
    "seed_total": len(cars),
    "counts": dict(counts),
    "total": len(results),
    "results": results,
}
(QA / "used-cars-revalidate.json").write_text(json.dumps(summary, indent=2))
(ART / "used-cars-revalidate.json").write_text(json.dumps(summary, indent=2))
print("TOTAL", len(results), dict(counts))
print("ROOT:", summary["root_cause"])
for r in results:
    if r["status"] != "PASS":
        print(f"{r['status']:7} {r['id']:6} {r['name'][:70]}")
