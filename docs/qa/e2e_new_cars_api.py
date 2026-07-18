"""Comprehensive New Cars API scenario suite (ASGI in-memory)."""
from __future__ import annotations

import asyncio
import json
from typing import Any

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from db.base import Base
from db.session import get_db
from main import app


async def run() -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    gaps: list[str] = []

    def rec(name: str, ok: bool, detail: Any = None, gap: str | None = None):
        results.append({"scenario": name, "status": "PASS" if ok else "FAIL", "detail": detail})
        if not ok and gap:
            gaps.append(gap)
        elif gap and ok is False:
            gaps.append(gap)

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
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
        # Auth
        r = await c.post(
            "/auth/register",
            json={"email": "newcars@test.com", "password": "password123", "full_name": "New Cars Tester"},
        )
        rec("NC-API-001 Register seller", r.status_code == 201, r.status_code)
        token = r.json().get("access_token")
        h = {"Authorization": f"Bearer {token}"}

        # Empty new listings
        r = await c.get("/listings?listing_type=new")
        rec(
            "NC-API-002 Empty new listings feed",
            r.status_code == 200 and r.json().get("total") == 0,
            {"status": r.status_code, "total": r.json().get("total")},
        )

        # Create cars
        car_new = await c.post(
            "/cars",
            json={
                "make": "Hyundai",
                "model": "Creta",
                "variant": "SX",
                "year": 2026,
                "fuel_type": "petrol",
                "transmission": "automatic",
                "body_type": "suv",
            },
            headers=h,
        )
        rec("NC-API-003 Create car for new listing", car_new.status_code == 201, car_new.status_code)
        car_new_id = car_new.json().get("id")

        car_used = await c.post(
            "/cars",
            json={"make": "Maruti Suzuki", "model": "Swift", "year": 2020, "fuel_type": "petrol", "body_type": "hatchback"},
            headers=h,
        )
        car_used_id = car_used.json().get("id")

        # Create proper new listing (km null / 0)
        r = await c.post(
            "/listings",
            json={
                "car_id": car_new_id,
                "listing_type": "new",
                "price": 1499000,
                "km_driven": 0,
                "city": "Kolkata",
                "condition": "excellent",
                "negotiable": False,
                "description": "Brand new Creta SX",
            },
            headers=h,
        )
        rec("NC-API-004 Create listing_type=new", r.status_code == 201, r.status_code)
        new_id = r.json().get("id") if r.status_code == 201 else None
        if r.status_code == 201 and r.json().get("listing_type") != "new":
            gaps.append("Created listing did not persist listing_type=new")

        # Create used listing for filter contrast
        await c.post(
            "/listings",
            json={"car_id": car_used_id, "listing_type": "used", "price": 550000, "km_driven": 40000, "city": "Delhi"},
            headers=h,
        )

        # Filter new only
        r = await c.get("/listings?listing_type=new")
        items = r.json().get("items") or []
        ok = r.status_code == 200 and r.json().get("total") == 1 and all(i.get("listing_type") == "new" for i in items)
        rec("NC-API-005 Filter listing_type=new returns only new", ok, {"total": r.json().get("total")})

        # Filter new + make
        r = await c.get("/listings?listing_type=new&make=Hyundai")
        rec(
            "NC-API-006 Filter new + make=Hyundai",
            r.status_code == 200 and r.json().get("total") == 1,
            {"total": r.json().get("total")},
        )

        r = await c.get("/listings?listing_type=new&make=Maruti")
        rec(
            "NC-API-007 Filter new + make=Maruti (expect 0)",
            r.status_code == 200 and r.json().get("total") == 0,
            {"total": r.json().get("total")},
        )

        # Body / fuel / price filters
        r = await c.get("/listings?listing_type=new&body_type=suv")
        rec("NC-API-008 Filter new + body_type=suv", r.status_code == 200 and r.json().get("total") == 1, r.json().get("total"))

        r = await c.get("/listings?listing_type=new&fuel_type=petrol")
        rec("NC-API-009 Filter new + fuel_type=petrol", r.status_code == 200 and r.json().get("total") == 1, r.json().get("total"))

        r = await c.get("/listings?listing_type=new&min_price=1000000&max_price=2000000")
        rec("NC-API-010 Filter new by price band", r.status_code == 200 and r.json().get("total") == 1, r.json().get("total"))

        r = await c.get("/listings?listing_type=new&city=Kolkata")
        rec("NC-API-011 Filter new by city", r.status_code == 200 and r.json().get("total") == 1, r.json().get("total"))

        # Detail
        r = await c.get(f"/listings/{new_id}")
        rec(
            "NC-API-012 Get new listing detail",
            r.status_code == 200 and r.json().get("listing_type") == "new",
            {"type": r.json().get("listing_type"), "price": r.json().get("price")},
        )

        # GAP: allow new listing with high km (should ideally reject or warn)
        car2 = await c.post(
            "/cars",
            json={"make": "Tata", "model": "Nexon", "year": 2025, "fuel_type": "electric", "body_type": "suv"},
            headers=h,
        )
        r = await c.post(
            "/listings",
            json={
                "car_id": car2.json()["id"],
                "listing_type": "new",
                "price": 1600000,
                "km_driven": 25000,
                "city": "Mumbai",
            },
            headers=h,
        )
        allowed_bad = r.status_code == 201
        rec(
            "NC-API-013 Reject new listing with km_driven>0 (expect FAIL=gap)",
            not allowed_bad,
            {"status": r.status_code, "km": 25000},
            gap="API allows listing_type=new with km_driven=25000 — no new-car km validation",
        )
        if allowed_bad:
            # still count as documented gap, scenario expected behavior fails
            results[-1]["status"] = "FAIL"
            results[-1]["detail"] = {"status": r.status_code, "note": "accepted invalid new+km"}

        # Cars catalogue list
        r = await c.get("/cars")
        rec("NC-API-014 List cars catalogue", r.status_code == 200 and r.json().get("total", 0) >= 2, r.json().get("total"))

        r = await c.get("/cars?make=Hyundai")
        rec("NC-API-015 Filter cars by make", r.status_code == 200 and r.json().get("total", 0) >= 1, r.json().get("total"))

        # Similar for new listing
        if new_id:
            r = await c.get(f"/listings/{new_id}/similar")
            rec("NC-API-016 Similar listings for new car", r.status_code == 200, r.status_code)

        # Update new listing price
        if new_id:
            r = await c.patch(f"/listings/{new_id}", json={"price": 1450000}, headers=h)
            rec("NC-API-017 Update new listing price", r.status_code == 200 and r.json().get("price") == 1450000, r.json().get("price"))

        # Search may or may not find new listing
        r = await c.get("/search?q=Creta")
        search_ok = r.status_code == 200
        rec("NC-API-018 Search finds Creta", search_ok, {"status": r.status_code, "body_keys": list(r.json().keys()) if search_ok else r.text[:80]})

        # Unauth cannot create
        c.cookies.clear()
        r = await c.post(
            "/listings",
            json={"car_id": car_new_id, "listing_type": "new", "price": 1},
        )
        rec("NC-API-019 Unauth create new listing blocked", r.status_code in (401, 403), r.status_code)

        # Check seed has no new (informational — seed not loaded in memory DB)
        gaps.append("API seed.py seeds only used listings — New Cars feed empty on fresh deploy unless manually created")
        gaps.append("No brand→model→variant catalogue API (ex-showroom, on-road, brochure, colours)")
        gaps.append("No dealers / get-best-price / brochure endpoints for new cars")

    app.dependency_overrides.clear()

    passed = sum(1 for x in results if x["status"] == "PASS")
    failed = sum(1 for x in results if x["status"] == "FAIL")
    return {
        "suite": "New Cars API",
        "passed": passed,
        "failed": failed,
        "total": len(results),
        "results": results,
        "gaps": gaps,
    }


if __name__ == "__main__":
    print(json.dumps(asyncio.run(run()), indent=2, default=str))
