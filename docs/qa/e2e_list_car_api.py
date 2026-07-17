"""E2E seller List-Your-Car journey against API (ASGI in-memory)."""
import asyncio
import io
import json
from unittest.mock import patch

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from db.base import Base
from db.session import get_db
from main import app


async def run() -> dict:
    gaps: list[str] = []
    results: list[tuple] = []

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post(
            "/auth/register",
            json={"email": "seller.e2e@test.com", "password": "password123", "full_name": "Manoj"},
        )
        results.append(("register", r.status_code))
        token = r.json().get("access_token") if r.status_code < 400 else None
        if not token:
            gaps.append("Register did not return access_token")
            return {"results": results, "gaps": gaps, "body": r.text[:300]}

        h = {"Authorization": f"Bearer {token}"}

        r = await c.post(
            "/cars",
            json={
                "make": "Maruti Suzuki",
                "model": "Swift",
                "variant": "ZXI+",
                "year": 2022,
                "fuel_type": "petrol",
                "transmission": "manual",
                "body_type": "hatchback",
            },
            headers=h,
        )
        results.append(("create_car", r.status_code))
        car_id = r.json().get("id") if r.status_code < 400 else None

        r = await c.post(
            "/listings",
            json={
                "car_id": car_id,
                "listing_type": "used",
                "price": 650000,
                "km_driven": 32000,
                "owners_count": 1,
                "condition": "good",
                "city": "Kolkata",
                "description": "Single owner, full service history",
                "negotiable": True,
                "registration_year": 2022,
                "registration_state": "WB",
            },
            headers=h,
        )
        results.append(("create_listing", r.status_code))
        data = r.json() if r.status_code < 400 else {}
        listing_id = data.get("id")
        if listing_id and data.get("image_urls") == []:
            gaps.append("Listing published with zero photos — no require-images gate")
        if listing_id and data.get("ai_valuation") is None:
            gaps.append("AI valuation not run at create time despite marketing copy")

        r = await c.get("/listings")
        results.append(("public_feed_total", r.status_code, r.json().get("total")))
        if r.json().get("total", 0) == 0:
            gaps.append("Created listing not visible on public feed")

        r = await c.get("/listings/me", headers=h)
        me = r.json()
        me_count = len(me) if isinstance(me, list) else (me.get("total") if isinstance(me, dict) else None)
        results.append(("my_listings", r.status_code, me_count))

        fake = io.BytesIO(b"\xff\xd8\xff" + b"\x00" * 100)
        with patch(
            "services.storage.upload_image",
            return_value="https://media.gaadiiq.com/listings/e2e.jpg",
        ):
            r = await c.post(
                f"/listings/{listing_id}/images",
                files={"file": ("p.jpg", fake, "image/jpeg")},
                headers=h,
            )
        results.append(("image_upload_api", r.status_code, r.json().get("image_urls") if r.status_code < 400 else r.text[:120]))

        # Force heuristic path — avoid hanging on unreachable Ollama
        with patch("httpx.AsyncClient.get", side_effect=Exception("ollama-down")):
            r = await c.post(f"/listings/{listing_id}/valuate", headers=h)
        results.append(
            (
                "valuate_heuristic",
                r.status_code,
                r.json().get("ai_valuation") if r.status_code < 400 else r.text[:120],
            )
        )

        r = await c.get(f"/listings/{listing_id}")
        results.append(
            (
                "get_detail",
                r.status_code,
                {
                    "images": len((r.json() or {}).get("image_urls") or []),
                    "city": (r.json() or {}).get("city"),
                    "price": (r.json() or {}).get("price"),
                }
                if r.status_code < 400
                else r.text[:120],
            )
        )

        r = await c.post("/listings", json={"car_id": car_id, "listing_type": "used", "price": 1})
        results.append(("unauth_create", r.status_code))

    app.dependency_overrides.clear()
    return {"results": results, "gaps": gaps}


if __name__ == "__main__":
    print(json.dumps(asyncio.run(run()), indent=2, default=str))
