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
from models.vehicle_media import ImageCategory, VehicleMedia
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


# ── 360° spin sequences ──────────────────────────────────────────────────────
#
# A turntable set is 24-36 frames of the same car a few degrees apart. It is
# stored in the same table as gallery photographs and has to behave differently
# in both directions: out of the flat gallery, and into the spin viewer only
# when there are enough frames to actually turn the car.


def _spin_frames(count: int, *, make="Maruti", model="S-Presso", year=2026):
    return [
        VehicleMedia(
            source_pdf_name=f"spin_{i:02d}.png", storage_key=f"spin_{i:02d}.png",
            make=make, model=model, model_year=year,
            image_category=ImageCategory.three_sixty, sort_order=i,
        )
        for i in range(count)
    ]


@pytest.mark.asyncio
async def test_spin_frames_are_kept_out_of_the_flat_gallery(db_session):
    """
    Thirty-six near-identical frames in the thumbnail strip read as the same
    picture over and over and push the real photographs off the end of it.
    """
    car = Car(make="Maruti", model="S-Presso", year=2026)
    db_session.add(car)
    await db_session.flush()

    db_session.add_all(_spin_frames(24))
    db_session.add(
        VehicleMedia(
            source_pdf_name="front.png", storage_key="front.png",
            make="Maruti", model="S-Presso", model_year=2026,
        )
    )
    await db_session.flush()

    urls = await media_library.urls_for_cars(db_session, [car])
    assert [_basename(u) for u in urls[car.id]] == ["front.png"]


@pytest.mark.asyncio
async def test_spin_urls_are_returned_in_turn_order(db_session):
    car = Car(make="Maruti", model="S-Presso", year=2026)
    db_session.add(car)
    await db_session.flush()

    # Added out of order: sort_order is what defines the turn, not insertion.
    frames = _spin_frames(24)
    db_session.add_all(list(reversed(frames)))
    await db_session.flush()

    urls = await media_library.spin_urls_for_car(db_session, car)
    assert [_basename(u) for u in urls] == [f"spin_{i:02d}.png" for i in range(24)]


@pytest.mark.asyncio
async def test_too_few_frames_is_no_spin_at_all(db_session):
    """
    Four frames is not a rotation, it is four photographs. Returning them would
    give the buyer a viewer that lurches between quarters — worse than absent.
    """
    car = Car(make="Maruti", model="S-Presso", year=2026)
    db_session.add(car)
    await db_session.flush()

    db_session.add_all(_spin_frames(4))
    await db_session.flush()

    assert await media_library.spin_urls_for_car(db_session, car) == []


@pytest.mark.asyncio
async def test_spin_matches_the_same_identity_rules_as_the_gallery(db_session):
    """A 2025 spin does not belong to the 2026 car."""
    car = Car(make="Maruti", model="S-Presso", year=2026)
    db_session.add(car)
    await db_session.flush()

    db_session.add_all(_spin_frames(24, year=2025))
    await db_session.flush()

    assert await media_library.spin_urls_for_car(db_session, car) == []


@pytest.mark.asyncio
async def test_catalogue_queries_never_name_the_three_sixty_enum_label(db_session, monkeypatch):
    """
    The spin filter must not reach Postgres as an enum literal.

    `image_category` is a native Postgres enum. Naming a label the deployed type
    does not carry does not quietly return nothing — it raises, and since this
    query backs both /cars and /listings, the entire catalogue goes blank. That
    is exactly what happened once. The filtering happens in Python instead, and
    this pins it there by inspecting the SQL actually issued.
    """
    statements: list[str] = []
    original = type(db_session).execute

    async def spy(self, statement, *args, **kwargs):
        statements.append(str(statement.compile(compile_kwargs={"literal_binds": True})))
        return await original(self, statement, *args, **kwargs)

    monkeypatch.setattr(type(db_session), "execute", spy)

    car = Car(make="Maruti", model="S-Presso", year=2026)
    db_session.add(car)
    await db_session.flush()

    await media_library.urls_for_cars(db_session, [car])
    await media_library.spin_urls_for_car(db_session, car)

    assert statements, "no SQL was captured"
    for sql in statements:
        assert "three_sixty" not in sql, f"enum label leaked into SQL: {sql}"


@pytest.mark.asyncio
async def test_a_few_three_sixty_photos_stay_in_the_gallery(db_session):
    """
    The category is set by filename guessing and by hand, so ordinary
    photographs routinely carry `three_sixty` without being a spin sequence.

    Hiding those cost a real site its galleries: too few frames for the spin
    viewer to offer, so they left the gallery and reappeared nowhere. Below the
    spin threshold they are simply photographs.
    """
    car = Car(make="Maruti", model="S-Presso", year=2026)
    db_session.add(car)
    await db_session.flush()

    db_session.add_all(_spin_frames(5))
    await db_session.flush()

    urls = await media_library.urls_for_cars(db_session, [car])
    assert [_basename(u) for u in urls[car.id]] == [f"spin_{i:02d}.png" for i in range(5)]
    # ...and no spin is offered for them either, so nothing is hidden anywhere.
    assert await media_library.spin_urls_for_car(db_session, car) == []


@pytest.mark.asyncio
async def test_the_gallery_and_the_spin_agree_on_the_threshold(db_session):
    """
    An image may be hidden from the gallery only when the viewer actually shows
    it. The two paths share SPIN_MIN_FRAMES so they cannot drift apart and
    strand images between them.
    """
    car = Car(make="Maruti", model="S-Presso", year=2026)
    db_session.add(car)
    await db_session.flush()

    db_session.add_all(_spin_frames(media_library.SPIN_MIN_FRAMES))
    await db_session.flush()

    gallery = await media_library.urls_for_cars(db_session, [car])
    spin = await media_library.spin_urls_for_car(db_session, car)
    assert gallery[car.id] == []
    assert len(spin) == media_library.SPIN_MIN_FRAMES
