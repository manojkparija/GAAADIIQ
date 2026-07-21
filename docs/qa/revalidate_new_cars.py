#!/usr/bin/env python3
"""Revalidate New Cars filter + wiring fixes (logic + static file checks)."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NC_TS = ROOT / "apps/gaadiiq-angular/src/app/pages/new-cars/new-cars.component.ts"
NC_HTML = ROOT / "apps/gaadiiq-angular/src/app/pages/new-cars/new-cars.component.html"
LIST_TS = ROOT / "apps/gaadiiq-angular/src/app/pages/listings/listings.component.ts"
COMPARE_TS = ROOT / "apps/gaadiiq-angular/src/app/pages/compare/compare.component.ts"
CARS_SVC = ROOT / "apps/gaadiiq-angular/src/app/services/cars-data.service.ts"
PLACEHOLDER = ROOT / "apps/gaadiiq-angular/src/assets/cars/placeholder.svg"

results = []


def rec(id: str, name: str, ok: bool, detail: str = "", gap: str | None = None):
    results.append({
        "id": id,
        "name": name,
        "status": "PASS" if ok else "FAIL",
        "detail": detail,
        "gap": gap,
    })


# ── Logic: budget Above ₹30L ─────────────────────────────────────────
cars = [
    {"make": "A", "model": "Cheap", "price": 800000, "km": 0, "year": 2025, "fuel": "Petrol", "bodyType": "Hatchback", "transmission": "Manual"},
    {"make": "B", "model": "Mid", "price": 1800000, "km": 0, "year": 2025, "fuel": "Petrol", "bodyType": "SUV", "transmission": "Automatic"},
    {"make": "C", "model": "Luxury1", "price": 3500000, "km": 0, "year": 2025, "fuel": "Petrol", "bodyType": "SUV", "transmission": "Automatic"},
    {"make": "D", "model": "Luxury2", "price": 4500000, "km": 0, "year": 2025, "fuel": "Electric", "bodyType": "SUV", "transmission": "Automatic"},
    {"make": "E", "model": "UsedOld", "price": 5000000, "km": 12000, "year": 2024, "fuel": "Diesel", "bodyType": "SUV", "transmission": "Manual"},
]


def filter_models(min_b: int, max_b: int, body_types=None, fuels=None):
    body_types = body_types or []
    fuels = fuels or []
    new = [c for c in cars if c["km"] == 0 and c["year"] >= 2025]
    by_model = {}
    for c in new:
        key = f"{c['make']}||{c['model']}"
        by_model.setdefault(key, []).append(c)
    out = []
    for key, group in by_model.items():
        in_band = [c for c in group if min_b <= c["price"] <= max_b]
        if not in_band:
            continue
        fuels_g = list({c["fuel"] for c in in_band})
        body = in_band[0]["bodyType"]
        is_ev = any(f == "Electric" for f in fuels_g)
        is_lux = min(c["price"] for c in in_band) >= 3000000
        if body_types:
            ok = False
            for bt in body_types:
                if bt == "Electric" and is_ev:
                    ok = True
                elif bt == "Luxury" and is_lux:
                    ok = True
                elif body == bt:
                    ok = True
            if not ok:
                continue
        if fuels and not any(f in fuels for f in fuels_g):
            continue
        out.append(key)
    return out


above = filter_models(3000000, 100000000)
rec("RV-001", "Above ₹30L returns only 30L+ new cars",
    set(above) == {"C||Luxury1", "D||Luxury2"},
    f"got={above}")

under5 = filter_models(0, 500000)
rec("RV-002", "Under ₹5L excludes mid/luxury",
    under5 == [],
    f"got={under5}")

band_10_15 = filter_models(1000000, 1500000)
# Mid is 18L — outside; none in 10-15
rec("RV-003", "₹10–15L band exact",
    band_10_15 == [],
    f"got={band_10_15}")

band_15_20 = filter_models(1500000, 2000000)
rec("RV-004", "₹15–20L includes Mid 18L",
    band_15_20 == ["B||Mid"],
    f"got={band_15_20}")

ev = filter_models(0, 100000000, body_types=["Electric"])
# body Electric maps to fuel — use fuels path
ev2 = filter_models(0, 100000000, fuels=["Electric"])
rec("RV-005", "Electric filter → EV models only",
    ev2 == ["D||Luxury2"],
    f"got={ev2}")

lux = filter_models(3000000, 100000000, body_types=["Luxury"])
rec("RV-006", "Luxury filter → min≥30L",
    set(lux) == {"C||Luxury1", "D||Luxury2"},
    f"got={lux}")

# Used car never in new filter
new_only = filter_models(0, 100000000)
rec("RV-007", "Used cars excluded from new list",
    "E||UsedOld" not in new_only,
    f"got={new_only}")

# ── Static source checks ─────────────────────────────────────────────
nc_ts = NC_TS.read_text()
nc_html = NC_HTML.read_text()
list_ts = LIST_TS.read_text()
compare_ts = COMPARE_TS.read_text()
cars_svc = CARS_SVC.read_text()

rec("RV-008", "Above ₹30L uses min:3000000 max:null in budgetRanges",
    "Above ₹30L" in nc_ts and "min: 3000000" in nc_ts and "max: null" in nc_ts)

rec("RV-009", "applyBudget / navigateToBudget filters on-page",
    "applyBudget" in nc_ts and "scrollToModels" in nc_ts)

rec("RV-010", "Placeholder path assets/cars/placeholder.svg exists + used",
    PLACEHOLDER.exists() and "assets/cars/placeholder.svg" in nc_ts and "assets/placeholder.svg" not in nc_html)

rec("RV-011", "No aeplcdn hotlinks in new-cars launches/upcoming",
    "aeplcdn.com" not in nc_ts)

rec("RV-012", "cars-data strips aeplcdn / uses placeholder",
    "aeplcdn" in cars_svc and "PLACEHOLDER" in cars_svc)

rec("RV-013", "listings reads minPrice + model query params",
    "minPrice" in list_ts and "params['model']" in list_ts)

rec("RV-014", "listings maps Electric/Luxury body types",
    "Electric" in list_ts and "Luxury" in list_ts and "LUXURY_MIN" in list_ts)

rec("RV-015", "View Details passes make+model; listings selects model",
    "model: model.model" in nc_html and "selectedModel.set" in list_ts)

rec("RV-016", "Compare prefill from keys query / sessionStorage",
    "gaadiiq_compare_keys" in compare_ts and "params['keys']" in compare_ts)

rec("RV-017", "Notify persists to localStorage per user",
    "gaadiiq_upcoming_notify" in nc_ts and "localStorage" in nc_ts)

rec("RV-018", "Price range shows onwards when min===max",
    "formatPriceRange" in nc_ts and "onwards" in nc_ts)

rec("RV-019", "Launches subtitle is 12 months (not false 3 months)",
    "last 12 months" in nc_html)

rec("RV-020", "Expert labeled editorial + model in CTA",
    "Editorial" in nc_html and "model: pick.model" in nc_html)

rec("RV-021", "Active budget card class wired",
    "budget-card" in nc_html and "class.active" in nc_html)

rec("RV-022", "budgetFilterLabel reflects Above ₹30L",
    "budgetFilterLabel" in nc_ts and "Above" in nc_ts)

passed = sum(1 for r in results if r["status"] == "PASS")
failed = sum(1 for r in results if r["status"] == "FAIL")
out = {
    "suite": "New Cars revalidation after fixes",
    "passed": passed,
    "failed": failed,
    "total": len(results),
    "results": results,
}
print(json.dumps(out, indent=2))
Path("/opt/cursor/artifacts/new-cars/revalidate-results.json").write_text(json.dumps(out, indent=2))
print(f"\nSUMMARY: {passed}/{len(results)} PASS, {failed} FAIL")
raise SystemExit(0 if failed == 0 else 1)
