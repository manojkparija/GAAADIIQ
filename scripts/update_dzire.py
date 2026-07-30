#!/usr/bin/env python3
"""
Update Maruti Suzuki Dzire DB records with official specs, prices, and working image URLs.

Run from Render bash console:
  cd /app && DATABASE_URL="<your-url>" python scripts/update_dzire.py

Or set DATABASE_URL env var and run:
  python scripts/update_dzire.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys

DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL:
    sys.exit("ERROR: DATABASE_URL environment variable is not set.")

if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
elif DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)

# Official ex-showroom Delhi prices (Oct 2024 launch)
VARIANT_PRICES: dict[str, int] = {
    "LXi MT":     679000,
    "VXi MT":     809000,
    "VXi AMT":    864000,
    "VXi CNG MT": 914000,
    "ZXi MT":     939000,
    "ZXi AMT":    994000,
    "ZXi CNG MT": 1044000,
    "ZXi+ MT":    1069000,
    "ZXi+ AMT":   1124000,
}

# Working CarWale CDN image URLs for the 2024 Dzire
DZIRE_IMAGES: list[str] = [
    "https://imgd.aeplcdn.com/664x374/n/cw/ec/155009/dzire-exterior-right-front-three-quarter-3.jpeg?isig=0&q=80",
    "https://imgd.aeplcdn.com/664x374/n/cw/ec/155009/dzire-exterior-left-rear-three-quarter.jpeg?isig=0&q=80",
    "https://imgd.aeplcdn.com/664x374/n/cw/ec/155009/dzire-exterior-front.jpeg?isig=0&q=80",
    "https://imgd.aeplcdn.com/664x374/n/cw/ec/155009/dzire-exterior-rear.jpeg?isig=0&q=80",
    "https://imgd.aeplcdn.com/664x374/n/cw/ec/155009/dzire-interior-dashboard-1.jpeg?isig=0&q=80",
    "https://imgd.aeplcdn.com/664x374/n/cw/ec/155009/dzire-interior-steering-wheel.jpeg?isig=0&q=80",
]

VARIANT_DESCRIPTIONS: dict[str, str] = {
    "LXi MT":     "Entry variant. 1.2L Z-Series 81.58 PS petrol, 5MT, 6 airbags, ESP, HEARTECT body. 24.79 km/l.",
    "VXi MT":     "Mid variant. 1.2L Z-Series 81.58 PS petrol, 5MT, SmartPlay Pro+ 9\", Suzuki Connect, LED headlamps. 24.79 km/l.",
    "VXi AMT":    "Mid variant with AGS auto. 1.2L Z-Series 81.58 PS petrol, AGS (AMT), SmartPlay Pro+ 9\", Suzuki Connect. 25.71 km/l.",
    "VXi CNG MT": "CNG variant. 1197cc bi-fuel (Petrol+CNG), 5MT, SmartPlay Pro+, Suzuki Connect. 33.73 km/kg CNG.",
    "ZXi MT":     "Top petrol MT. 1.2L Z-Series, 5MT, LED projector headlamps, wireless charger, cruise control, fast-charge USB. 24.79 km/l.",
    "ZXi AMT":    "Top petrol AGS. 1.2L Z-Series, AGS (AMT), LED projector headlamps, wireless charger, cruise control. 25.71 km/l.",
    "ZXi CNG MT": "Top CNG. 1197cc bi-fuel, 5MT, LED projector headlamps, wireless charger, cruise control. 33.73 km/kg.",
    "ZXi+ MT":    "Flagship MT. 1.2L Z-Series, 5MT, electric sunroof, 360° HD camera, auto climate control, rear AC vent, precision-cut alloys.",
    "ZXi+ AMT":   "Flagship AGS. 1.2L Z-Series, AGS (AMT), electric sunroof, 360° HD camera, auto climate control, rear AC vent.",
}


async def update() -> None:
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
    from sqlalchemy import text

    engine = create_async_engine(DATABASE_URL, echo=False, connect_args={"ssl": False})
    images_json = json.dumps(DZIRE_IMAGES)

    async with AsyncSession(engine) as session:
        for variant, price in VARIANT_PRICES.items():
            # Get car id
            result = await session.execute(text("""
                SELECT id FROM cars
                WHERE make='Maruti Suzuki' AND model='Dzire' AND variant=:variant AND year=2024
                LIMIT 1
            """), {"variant": variant})
            car_row = result.fetchone()
            if not car_row:
                print(f"  SKIP (car not found): {variant}")
                continue
            car_id = car_row[0]

            # Update listing price, images, description
            res = await session.execute(text("""
                UPDATE listings
                SET price=:price,
                    image_urls=CAST(:images AS jsonb),
                    description=:desc,
                    updated_at=NOW()
                WHERE car_id=:car_id AND listing_type='new'
            """), {
                "price": price,
                "images": images_json,
                "desc": VARIANT_DESCRIPTIONS[variant],
                "car_id": car_id,
            })
            print(f"  Updated {variant:20s}  price=₹{price:>10,}  rows={res.rowcount}")

        await session.commit()
        print("\nDone — all Dzire listings updated with official prices and working images.")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(update())
