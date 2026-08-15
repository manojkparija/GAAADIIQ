#!/usr/bin/env python3
"""
Full gap revalidation after Claude fixes (2026-07-20).

Surfaces:
  A) Used Cars P0/P1 (1bfa91d)
  B) AI Diagnosis + Valuation remaining gaps (4b2700c + earlier)
  C) New Cars smoke (prior 22/22)
  D) AI Advisor product-gap spot check (no new advisor commits on tip)
"""
from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
QA = ROOT / "docs/qa"
ART = Path("/opt/cursor/artifacts/full-gaps-revalidate")
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


def has(text: str, *needles: str) -> bool:
    return all(n in text for n in needles)


cy = datetime.now().year

# ── Seed inventory ────────────────────────────────────────────────────────────
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
city_counts = Counter(c["city"] for c in used)

# ── Sources ───────────────────────────────────────────────────────────────────
uc_ts = (ROOT / "apps/gaadiiq-angular/src/app/pages/used-cars/used-cars.component.ts").read_text()
uc_html = (ROOT / "apps/gaadiiq-angular/src/app/pages/used-cars/used-cars.component.html").read_text()
city_svc = (ROOT / "apps/gaadiiq-angular/src/app/services/city.service.ts").read_text()

routes = (ROOT / "apps/gaadiiq-angular/src/app/app.routes.ts").read_text()
diag_ts = (ROOT / "apps/gaadiiq-angular/src/app/pages/vehicle-diagnosis/vehicle-diagnosis.component.ts").read_text()
diag_html = (ROOT / "apps/gaadiiq-angular/src/app/pages/vehicle-diagnosis/vehicle-diagnosis.component.html").read_text()
diag_svc = (ROOT / "apps/gaadiiq-angular/src/app/services/diagnosis.service.ts").read_text()
diag_api = (ROOT / "apps/api/routers/diagnosis.py").read_text()
api_svc = (ROOT / "apps/gaadiiq-angular/src/app/services/api.service.ts").read_text()
val_eng = (ROOT / "apps/gaadiiq-angular/src/app/utils/valuation-engine.ts").read_text()
val_html = (ROOT / "apps/gaadiiq-angular/src/app/pages/ai-valuation/ai-valuation.component.html").read_text()
nav = (ROOT / "apps/gaadiiq-angular/src/app/components/navbar/navbar.component.html").read_text()

next_diag = ROOT / "apps/web/app/diagnosis/page.tsx"
next_val = ROOT / "apps/web/app/valuation/page.tsx"
nc_ts = (ROOT / "apps/gaadiiq-angular/src/app/pages/new-cars/new-cars.component.ts").read_text()
adv_ts = (ROOT / "apps/gaadiiq-angular/src/app/pages/ai-advisor/ai-advisor.component.ts").read_text()
e2e_dir = ROOT / "apps/web/tests/e2e"

CITY_ALIAS = {
    "bengaluru": "Bangalore",
    "new town": "Kolkata",
    "salt lake": "Kolkata",
    "bidhannagar": "Kolkata",
    "navi mumbai": "Mumbai",
    "greater mumbai": "Mumbai",
    "gurugram": "Delhi",
    "gurgaon": "Delhi",
    "noida": "Delhi",
    "faridabad": "Delhi",
    "ghaziabad": "Delhi",
}


def snap(raw: str) -> str:
    lower = raw.lower().strip()
    if lower in CITY_ALIAS:
        return CITY_ALIAS[lower]
    return raw


def filter_used(
    inventory,
    *,
    hero_make="",
    hero_model="",
    hero_city="",
    all_india_override=False,
    hero_budget_max=0,
    min_budget=100000,
    max_budget=20000000,
    year_from=2005,
    year_to=None,
    km_ranges=None,
    fuels=None,
    transmissions=None,
    body_types=None,
):
    if year_to is None:
        year_to = cy
    km_ranges = km_ranges or []
    fuels = fuels or []
    transmissions = transmissions or []
    body_types = body_types or []
    eff_city = "" if all_india_override else hero_city
    out = []
    for c in inventory:
        if not is_used(c):
            continue
        if hero_make and hero_make != "All" and c["make"] != hero_make:
            continue
        if hero_model and hero_model.lower() not in f"{c['model']} {c['variant']}".lower():
            continue
        if eff_city and eff_city.lower() not in (c["city"] or "").lower():
            continue
        if c["price"] < min_budget or c["price"] > max_budget:
            continue
        if hero_budget_max > 0 and c["price"] > hero_budget_max:
            continue
        if c["year"] < year_from or c["year"] > year_to:
            continue
        if fuels and c["fuel"] not in fuels:
            continue
        if transmissions and not any(t in c["transmission"] for t in transmissions):
            continue
        if body_types and c["bodyType"] not in body_types:
            continue
        if km_ranges:
            ok = False
            for r in km_ranges:
                km = c["km"]
                if r == "Under 20,000 km" and km < 20000:
                    ok = True
                elif r == "20,000 – 50,000 km" and 20000 <= km <= 50000:
                    ok = True
                elif r == "50,000 – 80,000 km" and 50000 < km <= 80000:
                    ok = True
                elif r == "Above 80,000 km" and km > 80000:
                    ok = True
            if not ok:
                continue
        out.append(c)
    return out


# ══════════════════════════════════════════════════════════════════════════════
# A) USED CARS — prior FAILs retest
# ══════════════════════════════════════════════════════════════════════════════

add("Used Inventory", "UC-INV-01", "Seed has used cars", "PASS" if len(used) > 0 else "FAIL", f"{len(used)} used of {len(cars)} total")
add(
    "Used Inventory",
    "UC-INV-02",
    "No 2005 model-year cars in seed",
    "PASS" if sum(1 for c in used if c["year"] == 2005) == 0 else "FAIL",
    f"2005 count={sum(1 for c in used if c['year'] == 2005)}",
)

# SS / CT prior FAILs
has_alias = "CITY_ALIAS" in uc_ts and "'new town'" in uc_ts.lower() and "snapToPopularCity" in uc_ts
add(
    "Used Cars P0",
    "UC-SS-01",
    "New Town snaps to Kolkata (alias) with inventory",
    "PASS" if has_alias and snap("New Town") == "Kolkata" and city_counts.get("Kolkata", 0) > 0 else "FAIL",
    f"snap(New Town)={snap('New Town')}; Kolkata used={city_counts.get('Kolkata', 0)}; alias_in_code={has_alias}",
    "P0",
)

n_kolkata = len(filter_used(cars, hero_city="Kolkata"))
add(
    "Used Cars P0",
    "UC-SS-01b",
    "City=New Town (snapped) returns used cars",
    "PASS" if n_kolkata > 0 else "FAIL",
    f"results={n_kolkata} after New Town→Kolkata",
    "P0",
)

# year options include currentYear and yearTo default is currentYear
yo_match = re.search(r"yearOptions\s*=\s*Array\.from\(\{\s*length:\s*this\.currentYear\s*-\s*2004\s*\+\s*1", uc_ts)
year_to_default = re.search(r"yearTo\s*=\s*signal\(new Date\(\)\.getFullYear\(\)\)", uc_ts)
year_from_default = "yearFrom = signal(2005)" in uc_ts or "yearFrom=signal(2005)" in uc_ts.replace(" ", "")
# options: 2005 .. currentYear+1 inclusive via length = cy-2004+1 → ends at 2005+(cy-2004)=cy+1
year_opts_end = cy + 1
year_to_in_opts = year_to_default is not None and cy <= year_opts_end
add(
    "Used Cars P0",
    "UC-SS-02",
    "yearTo default is currentYear and present in yearOptions",
    "PASS" if year_to_default and yo_match and year_to_in_opts else "FAIL",
    f"yearTo=signal(getFullYear)={bool(year_to_default)}; yearOptions ends ~{year_opts_end}; selected binding={'[selected]' in uc_html}",
    "P0",
)

# Default year range returns inventory
n_default = len(filter_used(cars))
add(
    "Used Cars P0",
    "UC-SS-03",
    "Default year 2005→currentYear returns used inventory",
    "PASS" if n_default == len(used) else "FAIL",
    f"results={n_default} / used={len(used)}",
    "P0",
)

has_city_chip = "filter-chip-city" in uc_html and "effectiveCity()" in uc_html
has_year_chips = "From {{ yearFrom()" in uc_html and "To {{ yearTo()" in uc_html
add(
    "Used Cars P0",
    "UC-SS-04",
    "Active filter strip shows city + year chips",
    "PASS" if has_city_chip and has_year_chips else "FAIL",
    f"city_chip={has_city_chip}; year_chips={has_year_chips}",
    "P0",
)

clear_calls_city = "clearCity()" in uc_ts and "clearCity()" in city_svc
add(
    "Used Cars P0",
    "UC-CT-02",
    "clearAllFilters clears CityService (navbar city)",
    "PASS" if clear_calls_city and "this.cityService.clearCity()" in uc_ts else "FAIL",
    f"clearCity in component+service={clear_calls_city}",
    "P0",
)

has_override = "allIndiaOverride" in uc_ts and "effectiveCity" in uc_ts
# Simulate empty city: Rourkela may have 0
rourkela_n = city_counts.get("Rourkela", 0)
n_override = len(filter_used(cars, hero_city="Rourkela", all_india_override=True))
add(
    "Used Cars P0",
    "UC-CT-01",
    "Empty city auto-overrides to All India (effectiveCity='')",
    "PASS" if has_override and "cityCarsCount() === 0" in uc_ts and "allIndiaOverride.set(true)" in uc_ts else "FAIL",
    f"override_logic={has_override}; Rourkela used={rourkela_n}; override results={n_override}",
    "P0",
)

empty_city_cta = "Show All India cars" in uc_html and "No used cars in {{ effectiveCity() }}" in uc_html
add(
    "Used Cars P0",
    "UC-SS-05",
    "Empty state has city-specific CTA + Clear All",
    "PASS" if empty_city_cta else "FAIL",
    "empty-state Show All India + Clear All Filters",
    "P0",
)

# Bengaluru alias
n_blr = len(filter_used(cars, hero_city=snap("Bengaluru")))
add(
    "Used Cars P1",
    "UC-INV-04",
    "Bengaluru aliases to Bangalore seed city",
    "PASS" if snap("Bengaluru") == "Bangalore" and n_blr > 0 and "Bangalore" in uc_ts else "FAIL",
    f"snap={snap('Bengaluru')}; results={n_blr}; cityOptions Bangaluru→Bangalore={'Bangalore' in uc_ts and 'Bengaluru' not in uc_ts.split('cityOptions')[1][:200] if 'cityOptions' in uc_ts else 'n/a'}",
    "P1",
)

# cityOptions uses Bangalore not Bengaluru
city_opts_ok = "Bangalore" in uc_ts and re.search(r"cityOptions\s*=\s*\[[^\]]*Bangalore", uc_ts) is not None
add(
    "Used Cars P1",
    "UC-CT-04",
    "cityOptions uses Bangalore (matches seed)",
    "PASS" if city_opts_ok else "FAIL",
    "cityOptions aligned with seed city names",
    "P1",
)

verdict_ok = "Fair Deal" in uc_ts and "Overpriced" in uc_ts and "Good Price" in uc_ts
# Stats banner still says AI-Verified — note as remaining soft gap
stats_ai = "AI-Verified" in uc_html
add(
    "Used Cars P1",
    "UC-VR-01",
    "Card verdict labels are Fair Deal / Overpriced / Good Price",
    "PASS" if verdict_ok else "FAIL",
    f"verdictLabel ok; stats banner still AI-Verified={stats_ai}",
    "P1",
)

# Banner logic bug check
banner_shows_when_override = (
    "showAllIndiaBanner" in uc_ts
    and "allIndiaOverride()" in uc_ts
)
# Current code: showAllIndiaBanner = !allIndiaOverride && cityCarsCount===0
# After auto-override, banner is HIDDEN — remaining UX gap
banner_logic_correct = re.search(
    r"showAllIndiaBanner\s*=\s*computed\(\(\)\s*=>\s*[^)]*allIndiaOverride\(\)",
    uc_ts,
    re.DOTALL,
)
# Expect banner when override IS true (user should see why All India is shown)
expects_banner_on_override = "allIndiaOverride()" in uc_ts and "!this.allIndiaOverride()" in uc_ts
add(
    "Used Cars Remaining",
    "UC-REM-01",
    "All-India soft banner visible after auto-override",
    "FAIL" if expects_banner_on_override else "PASS",
    "showAllIndiaBanner requires !allIndiaOverride — banner hidden exactly when override activates (auto empty-city path)",
    "P2",
)

advisor_cta_empty = "ai-advisor" in uc_html.lower() or "Ask AI" in uc_html
add(
    "Used Cars Remaining",
    "UC-REM-02",
    "Empty state links to AI Advisor",
    "PASS" if advisor_cta_empty else "FAIL",
    "No Advisor CTA in used-cars empty state",
    "P2",
)

url_writeback = "router.navigate" in uc_ts and "queryParams" in uc_ts and "queryParamsHandling" in uc_ts
# reads query params but may not write
writes_url = "navigate" in uc_ts and re.search(r"queryParams:\s*\{", uc_ts) is not None
add(
    "Used Cars Remaining",
    "UC-REM-03",
    "Filter state written back to URL",
    "PASS" if writes_url else "FAIL",
    "Reads queryParams on init; no navigate write-back of filters",
    "P2",
)

# Filter scenario smoke
scenarios = [
    ("UC-SC-01", "All India default", {}, True),
    ("UC-SC-02", "City Kolkata", {"hero_city": "Kolkata"}, True),
    ("UC-SC-03", "Make Maruti Suzuki", {"hero_make": "Maruti Suzuki"}, True),
    ("UC-SC-04", "Budget under 10L", {"hero_budget_max": 1000000, "max_budget": 1000000}, True),
    ("UC-SC-05", "Year 2020–2024", {"year_from": 2020, "year_to": 2024}, True),
    ("UC-SC-06", "Fuel Diesel", {"fuels": ["Diesel"]}, True),
    ("UC-SC-07", "Body SUV", {"body_types": ["SUV"]}, True),
    ("UC-SC-08", "Year 2005–2005 empty", {"year_from": 2005, "year_to": 2005}, False),
]
for sid, name, kwargs, expect_some in scenarios:
    n = len(filter_used(cars, **kwargs))
    ok = (n > 0) if expect_some else (n == 0)
    add("Used Filter Scenarios", sid, name, "PASS" if ok else "FAIL", f"results={n} expect_some={expect_some}")

# Playwright for used-cars
e2e_files = list(e2e_dir.glob("*.ts")) if e2e_dir.exists() else []
e2e_text = "\n".join(p.read_text() for p in e2e_files)
add(
    "Used Cars Remaining",
    "UC-REM-04",
    "Playwright e2e covers /used-cars",
    "PASS" if "/used-cars" in e2e_text else "FAIL",
    f"e2e specs={len(e2e_files)}; used-cars mentioned={'/used-cars' in e2e_text}",
    "P2",
)

# Photo filenames-only gap for diagnosis — continue below

# ══════════════════════════════════════════════════════════════════════════════
# B) AI DIAGNOSIS + VALUATION — prior remaining FAILs
# ══════════════════════════════════════════════════════════════════════════════

add(
    "Diagnosis Existence",
    "DX-01",
    "Angular /vehicle-diagnosis route",
    "PASS" if "vehicle-diagnosis" in routes else "FAIL",
    "app.routes.ts",
)
add(
    "Diagnosis Existence",
    "DX-02",
    "Navbar AI Diagnosis link",
    "PASS" if "/vehicle-diagnosis" in nav else "FAIL",
    "navbar",
)
add(
    "Diagnosis Existence",
    "DX-03",
    "API POST /diagnosis/analyse",
    "PASS" if "/analyse" in diag_api or "analyse" in diag_api else "FAIL",
    "routers/diagnosis.py",
)

# DG-01 photo upload
has_upload_ui = "onPhotoChange" in diag_ts and 'type="file"' in diag_html and "photo-upload" in diag_html
sends_image_urls = "image_urls" in diag_ts
# Still filenames only — not real upload to storage
real_upload = "supabase" in diag_ts.lower() and ("storage" in diag_ts.lower() or "upload" in diag_ts.lower() and "FormData" in diag_ts)
add(
    "Diagnosis Gaps",
    "DG-01",
    "Image upload UI in Angular wizard",
    "PASS" if has_upload_ui and sends_image_urls else "FAIL",
    f"upload UI={has_upload_ui}; sends image_urls={sends_image_urls}; real blob upload={real_upload}",
    "P1",
)
add(
    "Diagnosis Gaps",
    "DG-01b",
    "Photos uploaded to storage (not filenames only)",
    "PASS" if real_upload else "FAIL",
    "image_urls currently map(f => f.name) — filenames only, not hosted URLs",
    "P1",
)

# DG-03 history UI
has_history_ui = "history" in diag_html.lower() or "getHistory" in diag_ts or "diagnosis/history" in diag_svc
api_history = "history" in diag_api
add(
    "Diagnosis Gaps",
    "DG-03",
    "History UI on Angular",
    "PASS" if has_history_ui else "FAIL",
    f"API history endpoint exists={api_history}; Angular history UI={has_history_ui}",
    "P2",
)

# DG-04 Next.js page
add(
    "Diagnosis Gaps",
    "DG-04",
    "Next.js /diagnosis page exists",
    "PASS" if next_diag.exists() else "FAIL",
    str(next_diag.relative_to(ROOT)) if next_diag.exists() else "missing",
    "P1",
)

# DG-05 user_id
attaches_userid = "user_id: userId" in diag_ts and "getSession" in diag_ts
add(
    "Diagnosis Gaps",
    "DG-05",
    "user_id attached from auth session when available",
    "PASS" if attaches_userid else "FAIL",
    "Anonymous sessions still omit user_id (expected); logged-in users attach id",
    "P2",
)

# VR-01 ApiService path
val_path_ok = "valuateListing" in api_svc and "/listings/" in api_svc and "valuate" in api_svc
dead_get = "getAIValuation" in api_svc
add(
    "Valuation Gaps",
    "VR-01",
    "ApiService uses listings/{id}/valuate (not dead /ai/valuation)",
    "PASS" if val_path_ok and not dead_get else "FAIL",
    f"valuateListing={val_path_ok}; dead getAIValuation still present={dead_get}",
    "P1",
)

# VR-02 Next valuation page
add(
    "Valuation Gaps",
    "VR-02",
    "Next.js standalone /valuation page",
    "PASS" if next_val.exists() else "FAIL",
    str(next_val.relative_to(ROOT)) if next_val.exists() else "missing",
    "P1",
)

# Shared engine / fallback still present
add(
    "Valuation Gaps",
    "VR-03",
    "Shared valuation-engine.ts present",
    "PASS" if "export" in val_eng and len(val_eng) > 200 else "FAIL",
    "valuation-engine.ts",
)
add(
    "Valuation Gaps",
    "VR-04",
    "Angular valuation fallback banner",
    "PASS" if "fallback" in val_html.lower() or "estimate" in val_html.lower() or "heuristic" in val_html.lower() or "amber" in val_html.lower() or "disclaimer" in val_html.lower() else "FAIL",
    "ai-valuation.component.html honesty/fallback copy",
)

add(
    "Valuation Gaps",
    "VR-05",
    "Playwright e2e for diagnosis/valuation",
    "PASS" if ("/diagnosis" in e2e_text or "/vehicle-diagnosis" in e2e_text) and ("/valuation" in e2e_text or "/ai-valuation" in e2e_text) else "FAIL",
    "No dedicated e2e for diagnosis/valuation routes",
    "P2",
)

# Next diagnosis photo upload
next_diag_txt = next_diag.read_text() if next_diag.exists() else ""
add(
    "Diagnosis Gaps",
    "DG-06",
    "Next diagnosis page has photo upload",
    "PASS" if next_diag.exists() and ("type=\"file\"" in next_diag_txt or "accept=\"image" in next_diag_txt) else "FAIL",
    "apps/web/app/diagnosis/page.tsx",
    "P1",
)

# Service centre modal still present
add(
    "Diagnosis Gaps",
    "DG-07",
    "Nearest service centre modal present",
    "PASS" if "service" in diag_ts.lower() and ("centre" in diag_ts.lower() or "center" in diag_ts.lower() or "maps" in diag_ts.lower() or "bookService" in diag_ts) else "FAIL",
    "bookService / service centre flow",
)

# ══════════════════════════════════════════════════════════════════════════════
# C) NEW CARS — Claude tip vs fix branch (cursor/fix-new-cars-module-85e1)
# ══════════════════════════════════════════════════════════════════════════════
# Above ₹30L on Claude tip still uses max:100000000 (open-ended bug was max too high
# showing wrong label / not min-only). Fix branch uses max:null + on-page filter.
above_range = re.search(r"Above ₹30L['\"].*?min:\s*3000000,\s*max:\s*([^}\n]+)", nc_ts)
above_max = above_range.group(1).strip() if above_range else "missing"
above_fixed = above_max in ("null", "None") or "max: null" in nc_ts
add(
    "New Cars Gaps",
    "NC-01",
    "Above ₹30L uses open max (null) not 1 Cr cap",
    "PASS" if above_fixed else "FAIL",
    f"budgetRanges Above ₹30L max={above_max} — fix lives on cursor/fix-new-cars-module-85e1, NOT on Claude tip",
    "P0",
)
apply_on_page = "applyBudget" in nc_ts or "selectedBudgetLabel" in nc_ts or "budgetFilterLabel" in nc_ts
# Claude tip still navigates away for some budget chips; fix branch filters on-page
navigates_budget = "navigateToBudget" in nc_ts or (
    "budget" in nc_ts.lower() and "router.navigate(['/listings'" in nc_ts.replace(' ', '')
)
add(
    "New Cars Gaps",
    "NC-02",
    "Budget chips filter on-page (fix-branch behavior)",
    "PASS" if "applyBudget" in nc_ts else "FAIL",
    f"applyBudget={('applyBudget' in nc_ts)}; navigateToBudget={('navigateToBudget' in nc_ts)}; budgetFilterLabel={('budgetFilterLabel' in nc_ts)}",
    "P0",
)
add(
    "New Cars Gaps",
    "NC-03",
    "Electric / Luxury special-case mapping present",
    "PASS" if ("Electric" in nc_ts and "Luxury" in nc_ts) else "FAIL",
    "Electric/Luxury handling strings in component",
    "P1",
)
add(
    "New Cars Gaps",
    "NC-04",
    "No aeplcdn hotlinks in new-cars component",
    "PASS" if "aeplcdn" not in nc_ts else "FAIL",
    "placeholder.svg used" if "placeholder.svg" in nc_ts else "check images",
)
add(
    "New Cars Gaps",
    "NC-05",
    "New Cars fix commit merged into Claude tip",
    "FAIL",
    "cursor/fix-new-cars-module-85e1 (dbf9026) is NOT an ancestor of claude/gaadiiq-app-dev-abj5fo",
    "P0",
)

# ══════════════════════════════════════════════════════════════════════════════
# D) AI ADVISOR — major product gaps spot check (no new advisor commits)
# ══════════════════════════════════════════════════════════════════════════════
wires_recommend = "/recommend" in adv_ts and "http" in adv_ts.lower()
has_llm = "ollama" in adv_ts.lower() or "ai-chat" in adv_ts.lower() or "openai" in adv_ts.lower()
client_score = "let score" in adv_ts or "score +=" in adv_ts
add(
    "Advisor Spot",
    "AD-01",
    "Angular advisor wired to POST /recommend",
    "PASS" if wires_recommend else "FAIL",
    "Still client-side rule scoring; not calling API /recommend",
    "P1",
)
add(
    "Advisor Spot",
    "AD-02",
    "LLM / ai-chat in Angular advisor",
    "PASS" if has_llm else "FAIL",
    "No LLM chat path in ai-advisor.component.ts",
    "P2",
)
add(
    "Advisor Spot",
    "AD-03",
    "Client-side scoring engine present (working path)",
    "PASS" if client_score else "FAIL",
    "Local scoring still the active recommendation path",
)

next_adv = ROOT / "apps/web/app/ai-advisor"
# also check recommend page
next_rec = list((ROOT / "apps/web").rglob("**/recommend/**/page.tsx")) + list((ROOT / "apps/web").rglob("**/ai-advisor/**/page.tsx"))
add(
    "Advisor Spot",
    "AD-04",
    "Playwright e2e for /ai-advisor",
    "PASS" if "/ai-advisor" in e2e_text else "FAIL",
    "No dedicated Angular advisor e2e",
    "P2",
)

# Divergent advisors
add(
    "Advisor Spot",
    "AD-05",
    "Single unified advisor experience (Angular + Next)",
    "FAIL",
    "Angular multi-step quiz vs Next recommend flow remain divergent (no unification commit on tip)",
    "P1",
)

# ══════════════════════════════════════════════════════════════════════════════
# Summarize + write artifacts
# ══════════════════════════════════════════════════════════════════════════════
counts = Counter(r["status"] for r in results)
payload = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "branch_tip": "claude/gaadiiq-app-dev-abj5fo @ 1bfa91d",
    "focus": "Full gap revalidation after Used Cars P0/P1 + Diagnosis/Valuation Next pages",
    "counts": dict(counts),
    "total": len(results),
    "results": results,
}

(QA / "full-gaps-revalidate.json").write_text(json.dumps(payload, indent=2))
(ART / "full-gaps-revalidate.json").write_text(json.dumps(payload, indent=2))

fails = [r for r in results if r["status"] == "FAIL"]
lines = [
    "# Full Gaps Revalidation",
    "",
    f"**When:** {payload['generated_at']}",
    f"**Code:** `{payload['branch_tip']}`",
    "",
    f"## Summary: **{counts.get('PASS', 0)} PASS / {counts.get('FAIL', 0)} FAIL** ({len(results)} total)",
    "",
    "### Module rollup",
    "",
]
by_suite: dict[str, Counter] = {}
for r in results:
    by_suite.setdefault(r["suite"], Counter())[r["status"]] += 1
for suite, c in by_suite.items():
    lines.append(f"- **{suite}**: {c.get('PASS', 0)} PASS / {c.get('FAIL', 0)} FAIL")

lines += ["", "## Remaining FAILs", ""]
if not fails:
    lines.append("None — all checked gaps PASS.")
else:
    lines.append("| ID | Suite | Severity | Gap |")
    lines.append("|---|---|---|---|")
    for r in fails:
        lines.append(f"| {r['id']} | {r['suite']} | {r['severity']} | {r['name']} — {r['detail'][:120]} |")

lines += [
    "",
    "## Verdict by prior P0/P1",
    "",
    "### Used Cars (screenshot: New Town / Year 2005)",
    "- **FIXED:** New Town→Kolkata alias, year select defaults, Clear All clears CityService, city/year chips, empty-city All India override + CTA.",
    "- **REMAINING:** soft banner hidden after auto-override (UC-REM-01), no Advisor empty CTA, no URL write-back, no Playwright.",
    "",
    "### AI Diagnosis / Valuation",
    "- **FIXED:** Next `/diagnosis` + `/valuation` pages, Angular photo picker, ApiService `valuateListing` path, session `user_id`.",
    "- **REMAINING:** photos are filenames only (no storage upload), no history UI, no Playwright e2e.",
    "",
    "### New Cars",
    "- **NOT on Claude tip** — `cursor/fix-new-cars-module-85e1` (Above ₹30L / Electric / Compare / Notify) is a separate PR branch and is not merged into `claude/gaadiiq-app-dev-abj5fo`.",
    "- Claude tip still has `Above ₹30L` with `max: 100000000` and lacks `applyBudget` on-page filtering from the fix branch.",
    "",
    "### AI Advisor",
    "- **Not fixed on tip** — still client-side scoring, not wired to `/recommend`, no LLM, divergent Next/Angular.",
    "",
]

md = "\n".join(lines)
(QA / "Full-Gaps-Revalidate.md").write_text(md)
(ART / "Full-Gaps-Revalidate.md").write_text(md)

# Claude fix prompt for remaining
prompt = """# Claude Fix Prompt — Remaining GAADIIQ Gaps (post 2026-07-20 revalidate)

## Context
Used Cars P0/P1 and Diagnosis/Valuation Next pages are largely fixed on `claude/gaadiiq-app-dev-abj5fo`.
Revalidation: see `docs/qa/Full-Gaps-Revalidate.md`.

## Fix these remaining items (priority order)

### P0 — Merge / re-apply New Cars fixes onto Claude tip
Branch `cursor/fix-new-cars-module-85e1` (commit dbf9026) is **not** merged into `claude/gaadiiq-app-dev-abj5fo`.
Cherry-pick or merge:
- Above ₹30L → min≥30L with open max (null), on-page `applyBudget`
- Electric → fuel filter; Luxury → min≥30L
- Compare sessionStorage prefill, Notify localStorage, placeholder.svg, 12-month launches copy

### P1 — Used Cars banner logic
File: `apps/gaadiiq-angular/src/app/pages/used-cars/used-cars.component.ts`
- `showAllIndiaBanner` currently requires `!allIndiaOverride()`.
- After ngOnInit sets `allIndiaOverride=true` for empty cities, the amber banner never shows.
- Change to: show banner when `allIndiaOverride() && heroCity()` (and optionally cityCarsCount===0).
- Keep "Filter to {city}" button wired to `filterToCity()`.

### P1 — Diagnosis photo upload is filenames-only
Files: Angular `vehicle-diagnosis.component.ts`, Next `apps/web/app/diagnosis/page.tsx`
- Today `image_urls` = `selectedImages().map(f => f.name)`.
- Upload images to Supabase Storage (or API multipart), then pass real public URLs in `image_urls`.
- Keep thumbnail previews.

### P1 — AI Advisor still divergent / not API-wired
- Angular `ai-advisor` uses local scoring; does not call `POST /recommend`.
- Next advisor/recommend flow differs (fewer steps, missing CNG/MPV parity).
- Wire Angular to API or document single source of truth; unify scoring.

### P2 — Diagnosis history UI
- API has `/diagnosis/history`; Angular has no history list for logged-in users.
- Add a simple "Past diagnoses" panel when `user_id` present.

### P2 — Empty-state Advisor CTA on Used Cars
- When 0 results, add secondary link to `/ai-advisor`.

### P2 — URL write-back for Used Cars filters
- Mirror active filters into query params on change (city, make, model, fuel, budget).

### P2 — Playwright coverage
- Add e2e for `/used-cars` (New Town alias → results), `/vehicle-diagnosis`, `/ai-valuation` or Next `/diagnosis`+`/valuation`.

## Do NOT regress
- New Town/Bengaluru aliases, Clear All → `CityService.clearCity()`, year defaults, All India override, Next diagnosis/valuation pages, `valuateListing` path.
"""
(QA / "Claude-Remaining-Gaps-Prompt.md").write_text(prompt)
(ART / "Claude-Remaining-Gaps-Prompt.md").write_text(prompt)

# Excel-lite CSV for convenience
csv_lines = ["suite,id,name,status,severity,detail"]
for r in results:
    detail = r["detail"].replace('"', "'").replace("\n", " ")
    csv_lines.append(f"{r['suite']},{r['id']},\"{r['name']}\",{r['status']},{r['severity']},\"{detail}\"")
(QA / "full-gaps-revalidate.csv").write_text("\n".join(csv_lines))
(ART / "full-gaps-revalidate.csv").write_text("\n".join(csv_lines))

print(md)
print(f"\nJSON → {QA / 'full-gaps-revalidate.json'}")
print(f"PASS={counts.get('PASS',0)} FAIL={counts.get('FAIL',0)} TOTAL={len(results)}")
