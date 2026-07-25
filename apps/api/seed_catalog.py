"""
Bulk catalogue seed for UI testing at volume.

Creates 52 listings (26 new, 26 used) carrying exactly 130 images, so the
grids, filters, pagination and lazy-loading paths can be exercised with a
realistic amount of data rather than the 15 rows in seed.py.

    cd apps/api
    python seed_catalog.py            # insert
    python seed_catalog.py --reset    # delete previous catalogue rows, re-insert
    python seed_catalog.py --count    # report image/listing counts, change nothing

Images are picsum.photos placeholders, matching the existing convention in
seed.py. They are NOT real vehicle photographs — swap in licensed assets (or
R2 URLs) before anything user-facing. Each URL is seeded deterministically
from make/model/index so a given listing keeps the same image across runs,
which makes visual diffs meaningful.

Vehicle data (makes, models, variants, engine sizes) reflects the Indian
market so filter and search behaviour is exercised against plausible values.
"""
import argparse
import asyncio
import sys  # isort: skip_file

from sqlalchemy import delete, func, select

sys.path.insert(0, ".")

from db.session import AsyncSessionLocal  # noqa: E402
from core.security import hash_password  # noqa: E402
from models.car import BodyType, Car, FuelType, Transmission  # noqa: E402
from models.listing import Listing, ListingCondition, ListingType  # noqa: E402
from models.user import User, UserRole  # noqa: E402

CATALOG_EMAIL = "catalog@gaadiiq.com"
CATALOG_PASSWORD = "Catalog@1234"

# Marker in the description so --reset can find exactly these rows and leave
# hand-made or demo listings untouched.
CATALOG_TAG = "[catalog-seed]"

TARGET_IMAGES = 130

CITIES = [
    "Mumbai", "Delhi", "Bangalore", "Hyderabad", "Chennai",
    "Pune", "Kolkata", "Ahmedabad", "Jaipur", "Kochi",
]

# (make, model, variant, body, fuel, transmission, engine_cc, base_price_lakh)
CATALOG: list[tuple] = [
    # ── Maruti Suzuki ────────────────────────────────────────────────────────
    ("Maruti Suzuki", "Swift", "ZXi+ AMT", "hatchback", "petrol", "amt", 1197, 9.2),
    ("Maruti Suzuki", "Dzire", "ZXi+", "sedan", "petrol", "manual", 1197, 9.4),
    ("Maruti Suzuki", "Baleno", "Alpha", "hatchback", "petrol", "manual", 1197, 9.9),
    ("Maruti Suzuki", "Brezza", "ZXi+ AT", "suv", "petrol", "automatic", 1462, 14.1),
    ("Maruti Suzuki", "Grand Vitara", "Alpha+ Hybrid", "suv", "hybrid", "automatic", 1490, 19.9),
    ("Maruti Suzuki", "Ertiga", "ZXi+ CNG", "muv", "cng", "manual", 1462, 13.0),
    ("Maruti Suzuki", "Fronx", "Velocity+ Turbo", "suv", "petrol", "automatic", 998, 13.1),
    ("Maruti Suzuki", "WagonR", "ZXi+", "hatchback", "petrol", "manual", 1197, 7.4),

    # ── Hyundai ──────────────────────────────────────────────────────────────
    ("Hyundai", "Creta", "SX(O) Turbo DCT", "suv", "petrol", "dct", 1482, 20.2),
    ("Hyundai", "Venue", "SX(O) Turbo", "suv", "petrol", "dct", 998, 13.5),
    ("Hyundai", "i20", "Asta(O) DCT", "hatchback", "petrol", "dct", 1197, 11.2),
    ("Hyundai", "Verna", "SX(O) Turbo DCT", "sedan", "petrol", "dct", 1482, 17.4),
    ("Hyundai", "Exter", "SX(O) Connect", "suv", "petrol", "amt", 1197, 10.2),
    ("Hyundai", "Alcazar", "Signature 7-Str", "suv", "diesel", "automatic", 1493, 21.3),

    # ── Tata ─────────────────────────────────────────────────────────────────
    ("Tata", "Nexon", "Fearless+ DCA", "suv", "petrol", "dct", 1199, 15.6),
    ("Tata", "Punch", "Creative+ AMT", "suv", "petrol", "amt", 1199, 9.5),
    ("Tata", "Harrier", "Fearless+ AT", "suv", "diesel", "automatic", 1956, 25.4),
    ("Tata", "Safari", "Accomplished+ 6S", "suv", "diesel", "automatic", 1956, 26.8),
    ("Tata", "Altroz", "XZ+ OS DCA", "hatchback", "petrol", "dct", 1199, 10.9),
    ("Tata", "Nexon EV", "Empowered+ LR", "suv", "electric", "automatic", None, 17.2),
    ("Tata", "Curvv", "Accomplished+ A", "suv", "petrol", "dct", 1199, 18.6),

    # ── Mahindra ─────────────────────────────────────────────────────────────
    ("Mahindra", "Scorpio N", "Z8 L AT 4WD", "suv", "diesel", "automatic", 2184, 24.9),
    ("Mahindra", "XUV700", "AX7 L AWD", "suv", "diesel", "automatic", 2198, 26.4),
    ("Mahindra", "Thar", "LX Hard Top AT", "suv", "diesel", "automatic", 2184, 17.6),
    ("Mahindra", "XUV300", "W8(O) Turbo", "suv", "petrol", "manual", 1197, 12.6),
    ("Mahindra", "Bolero Neo", "N10(O)", "suv", "diesel", "manual", 1493, 11.9),

    # ── Toyota ───────────────────────────────────────────────────────────────
    ("Toyota", "Innova HyCross", "ZX(O) Hybrid", "muv", "hybrid", "cvt", 1987, 31.3),
    ("Toyota", "Fortuner", "Legender 4x4 AT", "suv", "diesel", "automatic", 2755, 47.2),
    ("Toyota", "Urban Cruiser Hyryder", "V Hybrid", "suv", "hybrid", "automatic", 1490, 19.6),
    ("Toyota", "Glanza", "V AMT", "hatchback", "petrol", "amt", 1197, 9.1),
    ("Toyota", "Camry", "Hybrid", "sedan", "hybrid", "cvt", 2487, 48.5),

    # ── Kia ──────────────────────────────────────────────────────────────────
    ("Kia", "Seltos", "X-Line DCT", "suv", "petrol", "dct", 1482, 20.5),
    ("Kia", "Sonet", "GTX+ DCT", "suv", "petrol", "dct", 998, 15.7),
    ("Kia", "Carens", "Luxury Plus 7S", "muv", "diesel", "automatic", 1493, 19.4),
    ("Kia", "EV6", "GT Line AWD", "suv", "electric", "automatic", None, 65.9),

    # ── Honda ────────────────────────────────────────────────────────────────
    ("Honda", "City", "ZX CVT", "sedan", "petrol", "cvt", 1498, 16.4),
    ("Honda", "Elevate", "ZX CVT", "suv", "petrol", "cvt", 1498, 16.2),
    ("Honda", "Amaze", "VX CVT", "sedan", "petrol", "cvt", 1199, 9.9),

    # ── Volkswagen / Skoda ───────────────────────────────────────────────────
    ("Volkswagen", "Taigun", "GT Plus DSG", "suv", "petrol", "dct", 1498, 19.4),
    ("Volkswagen", "Virtus", "GT Plus DSG", "sedan", "petrol", "dct", 1498, 19.2),
    ("Skoda", "Kushaq", "Monte Carlo DSG", "suv", "petrol", "dct", 1498, 19.7),
    ("Skoda", "Slavia", "Style DSG", "sedan", "petrol", "dct", 1498, 18.9),
    ("Skoda", "Kodiaq", "L&K 4x4", "suv", "petrol", "automatic", 1984, 41.5),

    # ── MG / Renault / Nissan ────────────────────────────────────────────────
    ("MG", "Hector", "Savvy Pro CVT", "suv", "petrol", "cvt", 1451, 21.9),
    ("MG", "Astor", "Savvy CVT", "suv", "petrol", "cvt", 1498, 18.4),
    ("MG", "ZS EV", "Exclusive Pro", "suv", "electric", "automatic", None, 25.2),
    ("Renault", "Kiger", "RXZ Turbo CVT", "suv", "petrol", "cvt", 999, 11.2),
    ("Renault", "Triber", "RXZ AMT", "muv", "petrol", "amt", 999, 8.9),
    ("Nissan", "Magnite", "XV Premium Turbo", "suv", "petrol", "cvt", 999, 11.0),

    # ── Premium ──────────────────────────────────────────────────────────────
    ("Jeep", "Compass", "Model S 4x4", "suv", "diesel", "automatic", 1956, 32.4),
    ("BMW", "3 Series", "330i M Sport", "sedan", "petrol", "automatic", 1998, 62.6),
    ("Mercedes-Benz", "GLC", "300 4MATIC", "suv", "petrol", "automatic", 1999, 78.9),
]

assert len(CATALOG) == 52, f"expected 52 catalogue entries, got {len(CATALOG)}"


def _slug(*parts: object) -> str:
    return "".join(str(p) for p in parts if p).lower().replace(" ", "").replace("-", "")


def _images(make: str, model: str, index: int, count: int) -> list[str]:
    """
    Deterministic placeholder URLs.

    The seed is derived from make/model/index so a listing keeps the same
    images across runs — otherwise every re-seed would churn the UI and make
    visual comparison useless.
    """
    base = _slug(make, model, index)
    return [f"https://picsum.photos/seed/{base}{i}/800/600" for i in range(count)]


def build_rows() -> list[dict]:
    """Build the catalogue, front-loading 3-image listings to hit 130 exactly."""
    rows: list[dict] = []
    images_used = 0

    for i, (make, model, variant, body, fuel, tx, cc, price_lakh) in enumerate(CATALOG):
        remaining_listings = len(CATALOG) - i
        remaining_images = TARGET_IMAGES - images_used
        # Give 3 images while the budget allows every remaining listing ≥2.
        count = 3 if remaining_images - 3 >= (remaining_listings - 1) * 2 else 2

        is_new = i % 2 == 0
        year = 2026 if is_new else 2019 + (i % 6)
        km = 0 if is_new else 8000 + (i * 2350) % 92000
        owners = 0 if is_new else 1 + (i % 3)
        condition = (
            ListingCondition.excellent if is_new or owners == 1
            else ListingCondition.good if owners == 2
            else ListingCondition.fair
        )
        # Used cars depreciate roughly with age; enough variation to make
        # price filters and sorting meaningful.
        price = price_lakh * 100000 if is_new else round(
            price_lakh * 100000 * (0.92 - 0.07 * (2026 - year)), -3
        )

        rows.append({
            "car": {
                "make": make, "model": model, "variant": variant, "year": year,
                "fuel_type": FuelType(fuel),
                "transmission": Transmission(tx),
                "body_type": BodyType(body),
                "seating_capacity": 7 if body == "muv" else 5,
                "engine_cc": cc,
            },
            "listing": {
                "listing_type": ListingType.new if is_new else ListingType.used,
                "price": price,
                "city": CITIES[i % len(CITIES)],
                "km_driven": km,
                "owners_count": owners,
                "condition": condition,
                "negotiable": not is_new,
                "registration_year": year if not is_new else None,
                "description": (
                    f"{year} {make} {model} {variant}. "
                    f"{'Brand new, unregistered.' if is_new else f'{owners} owner, {km:,} km driven.'} "
                    f"{CATALOG_TAG}"
                ),
                "image_urls": _images(make, model, i, count),
            },
        })
        images_used += count

    assert images_used == TARGET_IMAGES, f"expected {TARGET_IMAGES} images, built {images_used}"
    return rows


async def _get_or_create_seller(session) -> User:
    q = await session.execute(select(User).where(User.email == CATALOG_EMAIL))
    user = q.scalar_one_or_none()
    if user is not None:
        return user
    user = User(
        email=CATALOG_EMAIL,
        hashed_password=hash_password(CATALOG_PASSWORD),
        full_name="Catalog Seed Account",
        role=UserRole.seller,
        is_active=True,
    )
    session.add(user)
    await session.flush()
    return user


async def report() -> None:
    async with AsyncSessionLocal() as session:
        listings = (await session.execute(
            select(func.count()).select_from(Listing)
            .where(Listing.description.like(f"%{CATALOG_TAG}%"))
        )).scalar() or 0
        rows = (await session.execute(
            select(Listing.image_urls).where(Listing.description.like(f"%{CATALOG_TAG}%"))
        )).scalars().all()
        images = sum(len(u or []) for u in rows)
        print(f"catalogue listings: {listings}")
        print(f"catalogue images:   {images}")


async def reset() -> None:
    async with AsyncSessionLocal() as session:
        q = await session.execute(
            select(Listing.car_id).where(Listing.description.like(f"%{CATALOG_TAG}%"))
        )
        car_ids = list(q.scalars().all())
        await session.execute(
            delete(Listing).where(Listing.description.like(f"%{CATALOG_TAG}%"))
        )
        if car_ids:
            await session.execute(delete(Car).where(Car.id.in_(car_ids)))
        await session.commit()
        print(f"✓ Removed {len(car_ids)} catalogue listings and their cars.")


async def seed() -> None:
    rows = build_rows()

    async with AsyncSessionLocal() as session:
        existing = (await session.execute(
            select(func.count()).select_from(Listing)
            .where(Listing.description.like(f"%{CATALOG_TAG}%"))
        )).scalar() or 0
        if existing:
            print(f"ℹ {existing} catalogue listings already present — run with --reset to rebuild.")
            return

        seller = await _get_or_create_seller(session)

        images = 0
        for i, item in enumerate(rows):
            car = Car(**item["car"])
            session.add(car)
            await session.flush()

            listing = Listing(
                **item["listing"],
                car_id=car.id,
                seller_id=seller.id,
                is_active=True,
                is_featured=(i % 7 == 0),
            )
            session.add(listing)
            images += len(item["listing"]["image_urls"])

        await session.commit()

    new_count = sum(1 for r in rows if r["listing"]["listing_type"] is ListingType.new)
    print(f"✓ Seeded {len(rows)} listings ({new_count} new, {len(rows) - new_count} used)")
    print(f"✓ Total images: {images}")
    print(f"\nSeller account: {CATALOG_EMAIL} / {CATALOG_PASSWORD}")
    print("NOTE: images are picsum.photos placeholders, not real vehicle photos.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Bulk catalogue seed for UI testing.")
    parser.add_argument("--reset", action="store_true", help="remove catalogue rows, then re-seed")
    parser.add_argument("--count", action="store_true", help="report counts and exit")
    args = parser.parse_args()

    if args.count:
        asyncio.run(report())
    elif args.reset:
        asyncio.run(reset())
        asyncio.run(seed())
    else:
        asyncio.run(seed())
