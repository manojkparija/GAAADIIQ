"""
Resolving media-library images onto catalogue cars.

Cars carry no image column: an admin uploads a photograph against a vehicle's
identity (make, model, year) and the association to a catalogue row is worked
out at read time. These tests pin that matching down, including the bucket
choice that decides whether an image serves the New Cars pages, the Used Cars
pages, or both.
"""
import pytest

from models.car import Car
from models.vehicle_media import VehicleMedia
from services import media_library


def _basename(url: str) -> str:
    return url.rsplit("/", 1)[-1]


@pytest.mark.asyncio
async def test_matches_on_make_model_year_ignoring_case_and_padding(db_session):
    """
    The media table holds free text — a brochure's wording, or whatever an
    admin typed — while the catalogue is curated, so " maruti " must match
    "Maruti".
    """
    car = Car(make="Maruti", model="S-Presso", year=2020)
    db_session.add(car)
    await db_session.flush()

    db_session.add(
        VehicleMedia(
            source_pdf_name="messy.png", storage_key="messy.png",
            make="  maruti ", model="S-PRESSO", model_year=2020,
        )
    )
    await db_session.flush()

    urls = await media_library.urls_for_cars(db_session, [car])
    assert [_basename(u) for u in urls[car.id]] == ["messy.png"]


@pytest.mark.asyncio
async def test_wrong_year_or_model_does_not_match(db_session):
    car = Car(make="Maruti", model="S-Presso", year=2020)
    db_session.add(car)
    await db_session.flush()

    db_session.add_all([
        VehicleMedia(source_pdf_name="wrong_year.png", storage_key="wrong_year.png", make="Maruti", model="S-Presso",
                     model_year=2019),
        VehicleMedia(source_pdf_name="wrong_model.png", storage_key="wrong_model.png", make="Maruti", model="Swift",
                     model_year=2020),
    ])
    await db_session.flush()

    urls = await media_library.urls_for_cars(db_session, [car])
    assert urls[car.id] == []


@pytest.mark.asyncio
async def test_bucket_filters_which_surface_an_image_serves(db_session):
    """
    "both" and NULL match either surface. NULL matters because every image
    stored before the column existed would otherwise vanish from the site.
    """
    car = Car(make="Maruti", model="S-Presso", year=2020)
    db_session.add(car)
    await db_session.flush()

    db_session.add_all([
        VehicleMedia(source_pdf_name="new.png", storage_key="new.png", make="Maruti", model="S-Presso",
                     model_year=2020, media_bucket="new"),
        VehicleMedia(source_pdf_name="used.png", storage_key="used.png", make="Maruti", model="S-Presso",
                     model_year=2020, media_bucket="used"),
        VehicleMedia(source_pdf_name="both.png", storage_key="both.png", make="Maruti", model="S-Presso",
                     model_year=2020, media_bucket="both"),
        VehicleMedia(source_pdf_name="legacy.png", storage_key="legacy.png", make="Maruti", model="S-Presso",
                     model_year=2020, media_bucket=None),
    ])
    await db_session.flush()

    for bucket, expected in [
        ("new", {"new.png", "both.png", "legacy.png"}),
        ("used", {"used.png", "both.png", "legacy.png"}),
        (None, {"new.png", "used.png", "both.png", "legacy.png"}),
    ]:
        urls = await media_library.urls_for_cars(db_session, [car], bucket=bucket)
        assert {_basename(u) for u in urls[car.id]} == expected, bucket


@pytest.mark.asyncio
async def test_hero_shot_comes_first(db_session):
    car = Car(make="Tata", model="Nexon", year=2021)
    db_session.add(car)
    await db_session.flush()

    db_session.add_all([
        VehicleMedia(source_pdf_name="ordinary.png", storage_key="ordinary.png", make="Tata", model="Nexon",
                     model_year=2021, sort_order=1),
        VehicleMedia(source_pdf_name="hero.png", storage_key="hero.png", make="Tata", model="Nexon",
                     model_year=2021, is_primary=True, sort_order=5),
    ])
    await db_session.flush()

    urls = await media_library.urls_for_cars(db_session, [car])
    assert _basename(urls[car.id][0]) == "hero.png"


@pytest.mark.asyncio
async def test_one_upload_serves_every_car_row_for_the_model(db_session):
    """
    The reason the association is resolved rather than stored: two catalogue
    rows for the same model and year share one photograph.
    """
    a = Car(make="Maruti", model="S-Presso", year=2020, variant="LXI")
    b = Car(make="Maruti", model="S-Presso", year=2020, variant="VXI")
    db_session.add_all([a, b])
    await db_session.flush()

    db_session.add(
        VehicleMedia(source_pdf_name="shared.png", storage_key="shared.png", make="Maruti", model="S-Presso",
                     model_year=2020)
    )
    await db_session.flush()

    urls = await media_library.urls_for_cars(db_session, [a, b])
    assert [_basename(u) for u in urls[a.id]] == ["shared.png"]
    assert [_basename(u) for u in urls[b.id]] == ["shared.png"]


@pytest.mark.asyncio
async def test_cars_without_images_get_an_empty_list_not_a_missing_key(db_session):
    car = Car(make="Kia", model="Seltos", year=2022)
    db_session.add(car)
    await db_session.flush()

    urls = await media_library.urls_for_cars(db_session, [car])
    assert urls[car.id] == []


@pytest.mark.asyncio
async def test_no_cars_is_not_a_query(db_session):
    assert await media_library.urls_for_cars(db_session, []) == {}


@pytest.mark.asyncio
async def test_per_car_limit_is_respected(db_session):
    car = Car(make="Honda", model="City", year=2023)
    db_session.add(car)
    await db_session.flush()

    db_session.add_all([
        VehicleMedia(source_pdf_name=f"{i}.png", storage_key=f"{i}.png", make="Honda", model="City",
                     model_year=2023, sort_order=i)
        for i in range(12)
    ])
    await db_session.flush()

    urls = await media_library.urls_for_cars(db_session, [car], per_car=3)
    assert len(urls[car.id]) == 3


@pytest.mark.asyncio
async def test_webp_derivative_is_preferred_over_the_original(db_session):
    """The WebP is what a gallery should serve; the original is the fallback."""
    car = Car(make="Hyundai", model="Creta", year=2024)
    db_session.add(car)
    await db_session.flush()

    db_session.add(
        VehicleMedia(source_pdf_name="big.png", storage_key="big.png", webp_key="small.webp", make="Hyundai",
                     model="Creta", model_year=2024)
    )
    await db_session.flush()

    urls = await media_library.urls_for_cars(db_session, [car])
    assert _basename(urls[car.id][0]) == "small.webp"
