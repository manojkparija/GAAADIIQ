"""
Demo data seed script for GAADIIQ.

Usage:
  cd apps/api
  python seed.py

Creates a demo dealer account + 15 car listings with real images.
Safe to run multiple times (checks for existing demo user first).
"""
import asyncio
import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

# Add the apps/api directory to path
sys.path.insert(0, ".")

from core.database import AsyncSessionLocal
from core.security import hash_password
from models.user import User
from models.car import Car
from models.listing import Listing

DEMO_EMAIL = "demo@gaadiiq.com"
DEMO_PASSWORD = "Demo@1234"

DEMO_CARS = [
    {
        "car": {
            "make": "Maruti Suzuki", "model": "Swift", "variant": "VXi AMT",
            "year": 2023, "fuel_type": "petrol", "transmission": "automatic",
            "body_type": "hatchback", "seating_capacity": 5, "engine_cc": 1197,
        },
        "listing": {
            "price": 750000, "city": "Mumbai", "km_driven": 8000,
            "owners_count": 1, "condition": "excellent", "listing_type": "used",
            "description": "Single owner, well maintained Maruti Swift in mint condition. All service records available.",
            "negotiable": True,
            "image_urls": [
                "https://picsum.photos/seed/swift2023a/800/600",
                "https://picsum.photos/seed/swift2023b/800/600",
            ],
        },
    },
    {
        "car": {
            "make": "Hyundai", "model": "Creta", "variant": "S+ Turbo DCT",
            "year": 2024, "fuel_type": "petrol", "transmission": "automatic",
            "body_type": "suv", "seating_capacity": 5, "engine_cc": 1482,
        },
        "listing": {
            "price": 1750000, "city": "Delhi", "km_driven": 3000,
            "owners_count": 1, "condition": "excellent", "listing_type": "used",
            "description": "2024 Creta with sunroof, wireless charging, and connected car features. Like new.",
            "negotiable": False,
            "image_urls": [
                "https://picsum.photos/seed/creta2024a/800/600",
                "https://picsum.photos/seed/creta2024b/800/600",
            ],
        },
    },
    {
        "car": {
            "make": "Tata Motors", "model": "Nexon EV", "variant": "Max LR Dark Edition",
            "year": 2024, "fuel_type": "electric", "transmission": "automatic",
            "body_type": "suv", "seating_capacity": 5, "engine_cc": None,
        },
        "listing": {
            "price": 2000000, "city": "Bangalore", "km_driven": 5000,
            "owners_count": 1, "condition": "excellent", "listing_type": "used",
            "description": "Tata Nexon EV Max with long range battery. Zero emissions, full ADAS suite. Serviced at Tata authorized center.",
            "negotiable": True,
            "image_urls": [
                "https://picsum.photos/seed/nexonevmax/800/600",
                "https://picsum.photos/seed/nexonevmax2/800/600",
            ],
        },
    },
    {
        "car": {
            "make": "Mahindra", "model": "XUV700", "variant": "AX7 L AWD",
            "year": 2023, "fuel_type": "diesel", "transmission": "automatic",
            "body_type": "suv", "seating_capacity": 7, "engine_cc": 2184,
        },
        "listing": {
            "price": 2300000, "city": "Hyderabad", "km_driven": 18000,
            "owners_count": 1, "condition": "good", "listing_type": "used",
            "description": "Top spec XUV700 with ADAS, panoramic sunroof, Harman sound system. AWD. Corporate registered.",
            "negotiable": True,
            "image_urls": [
                "https://picsum.photos/seed/xuv700aw/800/600",
                "https://picsum.photos/seed/xuv700aw2/800/600",
            ],
        },
    },
    {
        "car": {
            "make": "Honda", "model": "City", "variant": "ZX Hybrid",
            "year": 2023, "fuel_type": "hybrid", "transmission": "automatic",
            "body_type": "sedan", "seating_capacity": 5, "engine_cc": 1498,
        },
        "listing": {
            "price": 1850000, "city": "Pune", "km_driven": 12000,
            "owners_count": 1, "condition": "excellent", "listing_type": "used",
            "description": "Honda City 5th gen e:HEV hybrid. Exceptional fuel economy at 26+ km/l. All Honda service stamps.",
            "negotiable": False,
            "image_urls": [
                "https://picsum.photos/seed/cityhybrid/800/600",
                "https://picsum.photos/seed/cityhybrid2/800/600",
            ],
        },
    },
    {
        "car": {
            "make": "Toyota", "model": "Innova Crysta", "variant": "2.4 VX",
            "year": 2022, "fuel_type": "diesel", "transmission": "manual",
            "body_type": "muv", "seating_capacity": 7, "engine_cc": 2393,
        },
        "listing": {
            "price": 2100000, "city": "Chennai", "km_driven": 35000,
            "owners_count": 1, "condition": "good", "listing_type": "used",
            "description": "Toyota Innova Crysta diesel in immaculate condition. Perfect for families. Toyota care stamped.",
            "negotiable": True,
            "image_urls": [
                "https://picsum.photos/seed/innovacrys/800/600",
                "https://picsum.photos/seed/innovacrys2/800/600",
            ],
        },
    },
    {
        "car": {
            "make": "Kia", "model": "Seltos", "variant": "GTX Plus DCT",
            "year": 2024, "fuel_type": "petrol", "transmission": "automatic",
            "body_type": "suv", "seating_capacity": 5, "engine_cc": 1353,
        },
        "listing": {
            "price": 2000000, "city": "Kolkata", "km_driven": 2000,
            "owners_count": 1, "condition": "excellent", "listing_type": "used",
            "description": "Brand new 2024 Kia Seltos with 360 camera, ADAS, ventilated seats. As good as showroom.",
            "negotiable": False,
            "image_urls": [
                "https://picsum.photos/seed/seltos2024/800/600",
                "https://picsum.photos/seed/seltos2024b/800/600",
            ],
        },
    },
    {
        "car": {
            "make": "MG Motor", "model": "ZS EV", "variant": "Exclusive Pro",
            "year": 2023, "fuel_type": "electric", "transmission": "automatic",
            "body_type": "suv", "seating_capacity": 5, "engine_cc": None,
        },
        "listing": {
            "price": 2250000, "city": "Ahmedabad", "km_driven": 9000,
            "owners_count": 1, "condition": "excellent", "listing_type": "used",
            "description": "MG ZS EV with V2L technology, panoramic sunroof, ADAS. Range 461 km. Mumbai registered.",
            "negotiable": True,
            "image_urls": [
                "https://picsum.photos/seed/mgzsev2023/800/600",
                "https://picsum.photos/seed/mgzsev2023b/800/600",
            ],
        },
    },
    {
        "car": {
            "make": "Maruti Suzuki", "model": "Baleno", "variant": "Alpha",
            "year": 2023, "fuel_type": "petrol", "transmission": "manual",
            "body_type": "hatchback", "seating_capacity": 5, "engine_cc": 1197,
        },
        "listing": {
            "price": 820000, "city": "Jaipur", "km_driven": 15000,
            "owners_count": 1, "condition": "good", "listing_type": "used",
            "description": "Top spec Baleno Alpha with Arkamys audio, HUD, and wireless Apple CarPlay.",
            "negotiable": True,
            "image_urls": [
                "https://picsum.photos/seed/baleno2023/800/600",
            ],
        },
    },
    {
        "car": {
            "make": "Hyundai", "model": "i20", "variant": "Asta (O) Turbo CVT",
            "year": 2023, "fuel_type": "petrol", "transmission": "automatic",
            "body_type": "hatchback", "seating_capacity": 5, "engine_cc": 998,
        },
        "listing": {
            "price": 1100000, "city": "Lucknow", "km_driven": 20000,
            "owners_count": 1, "condition": "good", "listing_type": "used",
            "description": "i20 Turbo with sunroof, BOSE speakers, digital cluster. Excellent driving dynamics.",
            "negotiable": True,
            "image_urls": [
                "https://picsum.photos/seed/i20turbo/800/600",
                "https://picsum.photos/seed/i20turbo2/800/600",
            ],
        },
    },
    {
        "car": {
            "make": "Tata Motors", "model": "Tiago EV", "variant": "Long Range XZ+",
            "year": 2024, "fuel_type": "electric", "transmission": "automatic",
            "body_type": "hatchback", "seating_capacity": 5, "engine_cc": None,
        },
        "listing": {
            "price": 1000000, "city": "Nagpur", "km_driven": 5000,
            "owners_count": 1, "condition": "excellent", "listing_type": "used",
            "description": "India's most affordable EV. Long range variant with 315 km range. Home charger included.",
            "negotiable": False,
            "image_urls": [
                "https://picsum.photos/seed/tiagoev24/800/600",
            ],
        },
    },
    {
        "car": {
            "make": "Volkswagen", "model": "Virtus", "variant": "GT Plus",
            "year": 2023, "fuel_type": "petrol", "transmission": "automatic",
            "body_type": "sedan", "seating_capacity": 5, "engine_cc": 1498,
        },
        "listing": {
            "price": 1600000, "city": "Surat", "km_driven": 22000,
            "owners_count": 1, "condition": "good", "listing_type": "used",
            "description": "Volkswagen Virtus GT with 1.5 TSI engine, DSG gearbox. Sporty sedan with European build quality.",
            "negotiable": True,
            "image_urls": [
                "https://picsum.photos/seed/virtusgt/800/600",
                "https://picsum.photos/seed/virtusgt2/800/600",
            ],
        },
    },
    {
        "car": {
            "make": "Skoda", "model": "Slavia", "variant": "Style 1.5 TSI DSG",
            "year": 2022, "fuel_type": "petrol", "transmission": "automatic",
            "body_type": "sedan", "seating_capacity": 5, "engine_cc": 1498,
        },
        "listing": {
            "price": 1400000, "city": "Indore", "km_driven": 30000,
            "owners_count": 1, "condition": "good", "listing_type": "used",
            "description": "Skoda Slavia with 1.5 TSI 150PS engine. Crystal-clear Czech build, sunroof, ventilated seats.",
            "negotiable": True,
            "image_urls": [
                "https://picsum.photos/seed/skodaSlavia/800/600",
            ],
        },
    },
    {
        "car": {
            "make": "Toyota", "model": "Urban Cruiser Hyryder", "variant": "V Hybrid",
            "year": 2023, "fuel_type": "hybrid", "transmission": "automatic",
            "body_type": "suv", "seating_capacity": 5, "engine_cc": 1490,
        },
        "listing": {
            "price": 1900000, "city": "Coimbatore", "km_driven": 16000,
            "owners_count": 1, "condition": "excellent", "listing_type": "used",
            "description": "Toyota's strong hybrid SUV. 28+ km/l in city. Full self-charging hybrid, no external charging needed.",
            "negotiable": True,
            "image_urls": [
                "https://picsum.photos/seed/hyryder2023/800/600",
                "https://picsum.photos/seed/hyryder2023b/800/600",
            ],
        },
    },
    {
        "car": {
            "make": "Maruti Suzuki", "model": "Ertiga", "variant": "ZXi Plus",
            "year": 2023, "fuel_type": "cng", "transmission": "manual",
            "body_type": "muv", "seating_capacity": 7, "engine_cc": 1462,
        },
        "listing": {
            "price": 1100000, "city": "Bhopal", "km_driven": 25000,
            "owners_count": 1, "condition": "good", "listing_type": "used",
            "description": "7-seater Ertiga factory CNG. Excellent fuel economy. Perfect for families and commercial use.",
            "negotiable": True,
            "image_urls": [
                "https://picsum.photos/seed/ertigacng/800/600",
            ],
        },
    },
]


async def seed():
    async with AsyncSessionLocal() as session:
        # Check if demo user exists
        result = await session.execute(
            select(User).where(User.email == DEMO_EMAIL)
        )
        user = result.scalar_one_or_none()

        if user is None:
            user = User(
                email=DEMO_EMAIL,
                hashed_password=hash_password(DEMO_PASSWORD),
                full_name="GAADIIQ Demo Seller",
                role="dealer",
                is_verified=True,
                is_active=True,
            )
            session.add(user)
            await session.flush()
            print(f"✓ Created demo user: {DEMO_EMAIL} / {DEMO_PASSWORD}")
        else:
            print(f"ℹ Demo user already exists: {DEMO_EMAIL}")

        # Count existing listings
        from sqlalchemy import func
        count_result = await session.execute(
            select(func.count()).select_from(Listing).where(Listing.seller_id == user.id)
        )
        existing_count = count_result.scalar() or 0

        if existing_count >= len(DEMO_CARS):
            print(f"ℹ Already have {existing_count} listings, skipping seed.")
            return

        created = 0
        for item in DEMO_CARS:
            # Create car
            car = Car(**item["car"])
            session.add(car)
            await session.flush()

            # Create listing
            listing_data = dict(item["listing"])
            listing = Listing(
                **listing_data,
                car_id=car.id,
                seller_id=user.id,
                is_active=True,
                is_featured=(created % 3 == 0),  # Feature every 3rd listing
            )
            session.add(listing)
            created += 1

        await session.commit()
        print(f"✓ Seeded {created} car listings.")
        print(f"\nDemo account: {DEMO_EMAIL} / {DEMO_PASSWORD}")
        print("Login at /login to manage listings.")


if __name__ == "__main__":
    asyncio.run(seed())
