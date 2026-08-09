#!/usr/bin/env python3
"""
Seed Maruti Suzuki Dzire (2024) car entries and new-car template listings.

Run from the Render shell for gaadiiq-api:
  cd /app && python scripts/seed_dzire.py

Environment variable required:
  DATABASE_URL  — the Supabase connection string, already set on the service

Each of the 9 Dzire variants gets:
  - one row in `cars`
  - one template "new" listing with all 30 shared brochure image URLs

Images are stored as placeholder URLs (https://media.gaadiiq.com/cars/dzire-2024/...)
until R2 is configured and real uploads replace them.
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL:
    sys.exit("ERROR: DATABASE_URL environment variable is not set.")

# Normalise URL for asyncpg
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
elif DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)

# ── Dzire 2024 variants ────────────────────────────────────────────────────────
# fmt: off
VARIANTS = [
    {"variant": "LXi MT",     "transmission": "manual",    "fuel_type": "petrol", "engine_cc": 1197},
    {"variant": "VXi MT",     "transmission": "manual",    "fuel_type": "petrol", "engine_cc": 1197},
    {"variant": "VXi AMT",    "transmission": "amt",       "fuel_type": "petrol", "engine_cc": 1197},
    {"variant": "VXi CNG MT", "transmission": "manual",    "fuel_type": "cng",    "engine_cc": 1197},
    {"variant": "ZXi MT",     "transmission": "manual",    "fuel_type": "petrol", "engine_cc": 1197},
    {"variant": "ZXi AMT",    "transmission": "amt",       "fuel_type": "petrol", "engine_cc": 1197},
    {"variant": "ZXi CNG MT", "transmission": "manual",    "fuel_type": "cng",    "engine_cc": 1197},
    {"variant": "ZXi+ MT",    "transmission": "manual",    "fuel_type": "petrol", "engine_cc": 1197},
    {"variant": "ZXi+ AMT",   "transmission": "amt",       "fuel_type": "petrol", "engine_cc": 1197},
]
# fmt: on

# Approximate on-road prices (INR) — adjust when official prices are confirmed
VARIANT_PRICES: dict[str, float] = {
    "LXi MT":     649000,
    "VXi MT":     749000,
    "VXi AMT":    799000,
    "VXi CNG MT": 820000,
    "ZXi MT":     860000,
    "ZXi AMT":    910000,
    "ZXi CNG MT": 925000,
    "ZXi+ MT":    960000,
    "ZXi+ AMT":  1010000,
}

# ── Shared brochure image URLs ─────────────────────────────────────────────────
BASE = "https://media.gaadiiq.com/cars/dzire-2024"
BROCHURE_IMAGES: list[str] = [
    # Exterior
    f"{BASE}/exterior-cover-front-3q-gallant-red.jpg",
    f"{BASE}/exterior-rear-3q-gallant-red.jpg",
    f"{BASE}/exterior-front-fascia-grille.jpg",
    f"{BASE}/exterior-led-projector-headlamps-drl.jpg",
    f"{BASE}/exterior-16inch-alloy-wheels.jpg",
    f"{BASE}/exterior-shark-fin-antenna-rear-spoiler.jpg",
    f"{BASE}/exterior-3d-led-tail-lamps.jpg",
    f"{BASE}/exterior-body-colour-orvm-turn-indicator.jpg",
    # Interior
    f"{BASE}/interior-cabin-overview.jpg",
    f"{BASE}/interior-smart-sunroof.jpg",
    f"{BASE}/interior-dual-tone-dashboard-climate-control.jpg",
    f"{BASE}/interior-rear-ac-vent.jpg",
    f"{BASE}/interior-rear-passenger-cabin-seat.jpg",
    f"{BASE}/interior-cruise-control-stalk.jpg",
    f"{BASE}/interior-smartplay-pro-plus-touchscreen.jpg",
    # Technology & Safety
    f"{BASE}/feature-technology-safety-overview.jpg",
    f"{BASE}/safety-6-airbags.jpg",
    f"{BASE}/feature-360-surround-view-camera.jpg",
    f"{BASE}/safety-tect-high-strength-steel-body.jpg",
    f"{BASE}/feature-ags-amt-gear-selector.jpg",
    f"{BASE}/feature-wireless-smartphone-charger.jpg",
    f"{BASE}/feature-suzuki-connect-telematics.jpg",
    # Color swatches
    f"{BASE}/colour-swatch-gallant-red.jpg",
    f"{BASE}/colour-swatch-alluring-blue.jpg",
    f"{BASE}/colour-swatch-nutmeg-brown.jpg",
    f"{BASE}/colour-swatch-bluish-black.jpg",
    f"{BASE}/colour-swatch-arctic-white.jpg",
    f"{BASE}/colour-swatch-magma-grey.jpg",
    f"{BASE}/colour-swatch-splendid-silver.jpg",
    # Back cover
    f"{BASE}/back-cover-maruti-suzuki-arena-lineup.jpg",
]


async def seed() -> None:
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
    from sqlalchemy import text

    engine = create_async_engine(DATABASE_URL, echo=False)

    async with AsyncSession(engine) as session:
        # ── Find or create a system seller user ──────────────────────────────
        result = await session.execute(
            text("SELECT id FROM users WHERE email = 'system@gaadiiq.com' LIMIT 1")
        )
        row = result.fetchone()
        if row:
            seller_id = row[0]
            print(f"  Using existing system user  id={seller_id}")
        else:
            seller_id = uuid.uuid4()
            now = datetime.now(timezone.utc)
            await session.execute(text("""
                INSERT INTO users (id, created_at, updated_at, email, hashed_password,
                                   full_name, role, is_verified, is_active)
                VALUES (:id, :now, :now, 'system@gaadiiq.com', 'NOT_A_REAL_HASH',
                        'GAADIIQ System', 'admin', true, true)
            """), {"id": seller_id, "now": now})
            print(f"  Created system user  id={seller_id}")

        # ── Seed each variant ─────────────────────────────────────────────────
        images_json = __import__("json").dumps(BROCHURE_IMAGES)
        now = datetime.now(timezone.utc)
        created = 0
        skipped = 0

        for v in VARIANTS:
            # Check if car entry already exists
            exists = await session.execute(text("""
                SELECT id FROM cars
                WHERE make='Maruti Suzuki' AND model='Dzire' AND variant=:variant AND year=2024
                LIMIT 1
            """), {"variant": v["variant"]})
            car_row = exists.fetchone()

            if car_row:
                car_id = car_row[0]
                print(f"  Car already exists  {v['variant']:20s}  id={car_id}")
                skipped += 1
            else:
                car_id = uuid.uuid4()
                await session.execute(text("""
                    INSERT INTO cars (id, created_at, updated_at, make, model, variant, year,
                                      fuel_type, transmission, body_type, seating_capacity, engine_cc)
                    VALUES (:id, :now, :now, 'Maruti Suzuki', 'Dzire', :variant, 2024,
                            :fuel_type, :transmission, 'sedan', 5, :engine_cc)
                """), {
                    "id": car_id, "now": now,
                    "variant": v["variant"],
                    "fuel_type": v["fuel_type"],
                    "transmission": v["transmission"],
                    "engine_cc": v["engine_cc"],
                })
                print(f"  Created car         {v['variant']:20s}  id={car_id}")
                created += 1

            # Check for existing template listing
            listing_exists = await session.execute(text("""
                SELECT id FROM listings
                WHERE car_id=:car_id AND listing_type='new' AND seller_id=:seller_id
                LIMIT 1
            """), {"car_id": car_id, "seller_id": seller_id})
            if listing_exists.fetchone():
                print(f"  Listing already exists for {v['variant']}")
                continue

            listing_id = uuid.uuid4()
            price = VARIANT_PRICES[v["variant"]]
            await session.execute(text("""
                INSERT INTO listings (id, created_at, updated_at, car_id, seller_id,
                                      listing_type, price, negotiable, condition,
                                      city, description, image_urls,
                                      is_active, is_featured, views_count)
                VALUES (:id, :now, :now, :car_id, :seller_id,
                        'new', :price, false, 'excellent',
                        'Pan India',
                        :description,
                        CAST(:images AS jsonb),
                        true, false, 0)
            """), {
                "id": listing_id,
                "now": now,
                "car_id": car_id,
                "seller_id": seller_id,
                "price": price,
                "description": (
                    f"2024 Maruti Suzuki Dzire {v['variant']} — "
                    "K12N 1.2L DualJet petrol engine, TECT body structure, "
                    "6 airbags (ZXi+), SmartPlay Pro+ infotainment, "
                    "Suzuki Connect telematics. Available at authorised Arena dealerships."
                ),
                "images": images_json,
            })
            print(f"  Created listing     {v['variant']:20s}  id={listing_id}  price=₹{price:,.0f}")

        await session.commit()
        print(f"\n{'='*60}")
        print(f"  Cars created : {created}  |  skipped (already exist): {skipped}")
        print(f"  Listings     : each variant has a new-car template listing")
        print(f"  Images/listing: {len(BROCHURE_IMAGES)} placeholder URLs")
        print(f"\n  NOTE: Replace placeholder URLs with real uploads once")
        print(f"        R2_ENDPOINT_URL / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY")
        print(f"        are configured in the Render service environment.")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
