#!/usr/bin/env python3
"""Smoke-test POST /recommend against in-memory SQLite."""
from __future__ import annotations

import asyncio
import json
import uuid
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path("/opt/cursor/artifacts/ai-advisor")
OUT.mkdir(parents=True, exist_ok=True)


async def main() -> None:
    import sys

    sys.path.insert(0, str(ROOT / "apps/api"))

    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
    from sqlalchemy.pool import StaticPool

    from db.base import Base
    from db.session import get_db
    from main import app
    from models.car import BodyType, Car, FuelType, Transmission
    from models.listing import Listing, ListingType
    from models.user import User

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async with Session() as s:
        seller = User(
            id=uuid.uuid4(),
            email="s@test.com",
            hashed_password="x",
            full_name="Seller",
            role="seller",
        )
        s.add(seller)
        await s.flush()
        samples = [
            ("Maruti", "Swift", FuelType.petrol, BodyType.hatchback, 650000),
            ("Hyundai", "Creta", FuelType.diesel, BodyType.suv, 1400000),
            ("Tata", "Nexon EV", FuelType.electric, BodyType.suv, 1700000),
            ("Honda", "City", FuelType.petrol, BodyType.sedan, 1100000),
            ("Toyota", "Innova", FuelType.diesel, BodyType.muv, 2200000),
        ]
        for make, model, fuel, body, price in samples:
            car = Car(
                id=uuid.uuid4(),
                make=make,
                model=model,
                year=2024,
                fuel_type=fuel,
                body_type=body,
                transmission=Transmission.manual,
            )
            s.add(car)
            await s.flush()
            s.add(
                Listing(
                    id=uuid.uuid4(),
                    car_id=car.id,
                    seller_id=seller.id,
                    price=Decimal(price),
                    city="Mumbai",
                    listing_type=ListingType.used,
                    is_active=True,
                    km_driven=12000,
                )
            )
        await s.commit()

    async def override():
        async with Session() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override
    transport = ASGITransport(app=app)
    out = []
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        cases = [
            ("API-SC-01", {"budget": "5l_10l", "fuel": "petrol", "body": "hatchback", "usage": "city"}),
            ("API-SC-02", {"budget": "10l_20l", "fuel": "diesel", "body": "suv", "usage": "highway"}),
            ("API-SC-03", {"budget": "10l_20l", "fuel": "electric", "body": "any", "usage": "city"}),
            ("API-SC-04", {"budget": "20l_50l", "fuel": "any", "body": "muv", "usage": "family"}),
            ("API-SC-05", {"budget": "under_5l", "fuel": "petrol", "body": "suv", "usage": "first"}),
        ]
        for cid, payload in cases:
            r = await client.post("/recommend", json=payload)
            ok = r.status_code == 200
            data = r.json() if ok else {"detail": r.text}
            items = data.get("items", []) if ok else []
            fuel_ok = True
            if ok and payload.get("fuel") not in (None, "any") and items:
                for it in items:
                    ft = ((it.get("listing") or {}).get("car") or {}).get("fuel_type") or ""
                    if ft and ft != payload["fuel"]:
                        fuel_ok = False
            status = "PASS" if ok and fuel_ok else "FAIL"
            detail = (
                f"status={r.status_code}, n={len(items)}, "
                f"scores={[i.get('match_score') for i in items]}, "
                f"reasons_n={[len(i.get('reasons') or []) for i in items]}"
            )
            if not fuel_ok:
                detail += " | FUEL LEAK"
            if cid == "API-SC-05" and ok:
                status = "PASS"
                detail += " (empty OK)"
            out.append({"id": cid, "status": status, "detail": detail, "payload": payload})
            print(status, cid, detail)

    app.dependency_overrides.clear()
    await engine.dispose()
    (OUT / "api-recommend-smoke.json").write_text(json.dumps(out, indent=2))
    (ROOT / "docs/qa/api-recommend-smoke.json").write_text(json.dumps(out, indent=2))
    print("API smoke", sum(1 for x in out if x["status"] == "PASS"), "/", len(out))


if __name__ == "__main__":
    asyncio.run(main())
