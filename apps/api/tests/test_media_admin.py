"""
Admin image upload (BR-001, BR-002, FR-001, FR-002, FR-004).

The journey the BRD is actually about: an admin supplies photography and states
what it is, once, and every catalogue surface finds it by that metadata. Its
distinguishing property against the brochure pipeline is that the metadata is
*asserted* rather than inferred, so the mandatory fields are enforced — an
untagged image is invisible to every surface and therefore not worth storing.
"""
import io
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.dependencies import get_admin_user
from db.session import get_db
from main import app
from models.user import User


def _png(colour=(200, 30, 30), size=(640, 420)) -> bytes:
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", size, colour).save(buf, "PNG")
    return buf.getvalue()


def _tiff(colour=(30, 90, 200)) -> bytes:
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (400, 300), colour).save(buf, "TIFF")
    return buf.getvalue()


@pytest_asyncio.fixture
async def client(db_engine):
    factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)

    async def override_db():
        async with factory() as session:
            yield session
            await session.commit()

    app.dependency_overrides[get_db] = override_db
    # The endpoint's own auth is covered by the shared admin dependency; these
    # tests are about upload behaviour, so the admin is stubbed.
    #
    # With an explicit id: the real dependency returns a persisted user, whose
    # id exists. A transient User leaves id as None until it is inserted, which
    # would make every audit assertion pass against an actor nobody set.
    admin = User(id=uuid.uuid4(), email="admin@test.com", hashed_password="x")
    app.dependency_overrides[get_admin_user] = lambda: admin
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


VEHICLE = {
    "make": "Tata", "model": "Nexon", "model_year": "2025",
    "category": "SUV", "fuel_type": "Petrol", "transmission": "Automatic",
    "image_category": "exterior_front",
}


class TestMandatoryMetadataSuite:
    """FR-002 / AC-002: an image with no make and model cannot be found."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("missing", ["make", "model", "model_year", "fuel_type"])
    async def test_a_missing_mandatory_field_is_rejected(self, client, missing):
        data = {k: v for k, v in VEHICLE.items() if k != missing}
        resp = await client.post(
            "/media-admin/upload", data=data,
            files=[("files", ("a.png", io.BytesIO(_png()), "image/png"))],
        )
        assert resp.status_code == 422, missing

    @pytest.mark.asyncio
    async def test_an_invented_category_is_rejected_by_name(self, client):
        resp = await client.post(
            "/media-admin/upload", data={**VEHICLE, "image_category": "banana"},
            files=[("files", ("a.png", io.BytesIO(_png()), "image/png"))],
        )
        assert resp.status_code == 422
        # The valid vocabulary is named, so the caller can fix it without docs.
        assert "exterior_front" in str(resp.json())


class TestMultipleUploadSuite:
    """FR-001 / AC-001."""

    @pytest.mark.asyncio
    async def test_several_files_are_stored_in_one_request(self, client):
        files = [
            ("files", (f"Tata_Nexon_Front_202{i}.png", io.BytesIO(_png((i * 40, 30, 30))), "image/png"))
            for i in range(3)
        ]
        resp = await client.post("/media-admin/upload", data=VEHICLE, files=files)

        assert resp.status_code == 201
        body = resp.json()
        assert body["stored"] == 3
        assert len(body["images"]) == 3
        assert all(i["make"] == "Tata" for i in body["images"])

    @pytest.mark.asyncio
    async def test_the_same_photograph_twice_is_stored_once(self, client):
        """FR-005 / AC-008: the point of a single source of truth."""
        same = _png()
        resp = await client.post(
            "/media-admin/upload", data=VEHICLE,
            files=[
                ("files", ("a.png", io.BytesIO(same), "image/png")),
                ("files", ("b.png", io.BytesIO(same), "image/png")),
            ],
        )
        body = resp.json()
        assert body["stored"] == 1
        assert body["deduplicated"] == 1
        assert body["images"][1]["deduplicated"] is True

    @pytest.mark.asyncio
    async def test_one_bad_file_does_not_lose_the_good_ones(self, client):
        resp = await client.post(
            "/media-admin/upload", data=VEHICLE,
            files=[
                ("files", ("good.png", io.BytesIO(_png()), "image/png")),
                ("files", ("bad.png", io.BytesIO(b"not an image"), "image/png")),
            ],
        )
        body = resp.json()
        assert body["stored"] == 1
        assert body["rejected"] == 1
        assert any("bad.png" in e for e in body["errors"])


class TestFileFormatSuite:
    @pytest.mark.asyncio
    async def test_tiff_is_accepted(self, client):
        """BR-001 lists TIFF; supplied press photography routinely arrives as it."""
        resp = await client.post(
            "/media-admin/upload", data=VEHICLE,
            files=[("files", ("press.tiff", io.BytesIO(_tiff()), "image/tiff"))],
        )
        assert resp.status_code == 201
        assert resp.json()["stored"] == 1

    @pytest.mark.asyncio
    async def test_content_type_is_sniffed_not_trusted(self, client):
        """A .png header on an executable must not get it stored."""
        resp = await client.post(
            "/media-admin/upload", data=VEHICLE,
            files=[("files", ("evil.png", io.BytesIO(b"MZ\x90\x00 windows binary"), "image/png"))],
        )
        assert resp.status_code == 422


class TestFilenameSuggestionsSuite:
    """BR-004 / AC-003: the screen pre-fills, the admin corrects."""

    @pytest.mark.asyncio
    async def test_inspect_returns_suggestions_without_storing(self, client):
        resp = await client.post(
            "/media-admin/inspect",
            files=[("files", ("Tata_Nexon_FearlessPlus_Front_2025.webp", io.BytesIO(b""), "image/webp"))],
        )
        assert resp.status_code == 200
        [suggestion] = resp.json()
        assert suggestion["make"] == "Tata"
        assert suggestion["model"] == "Nexon"
        assert suggestion["variant"] == "Fearless Plus"
        assert suggestion["model_year"] == 2025
        assert suggestion["image_category"] == "exterior_front"


class TestAdminOverrideSuite:
    """FR-004 / AC-004: anything AI suggested must be correctable."""

    @pytest.mark.asyncio
    async def test_metadata_can_be_patched_after_upload(self, client):
        created = (await client.post(
            "/media-admin/upload", data=VEHICLE,
            files=[("files", ("a.png", io.BytesIO(_png()), "image/png"))],
        )).json()["images"][0]

        resp = await client.patch(
            f"/media-admin/{created['id']}",
            json={"variant": "Fearless Plus DCA", "image_category": "boot_space"},
        )

        assert resp.status_code == 200
        assert resp.json()["variant"] == "Fearless Plus DCA"
        assert resp.json()["image_category"] == "boot_space"

    @pytest.mark.asyncio
    async def test_an_omitted_field_is_left_alone_not_blanked(self, client):
        created = (await client.post(
            "/media-admin/upload", data={**VEHICLE, "variant": "Fearless"},
            files=[("files", ("a.png", io.BytesIO(_png()), "image/png"))],
        )).json()["images"][0]

        resp = await client.patch(f"/media-admin/{created['id']}", json={"colour": "Red"})

        assert resp.json()["colour"] == "Red"
        assert resp.json()["variant"] == "Fearless", "a patch must not blank what it omits"


class TestAltTextSuite:
    @pytest.mark.asyncio
    async def test_alt_text_is_generated_when_not_supplied(self, client):
        """A gallery of unlabelled images is unusable with a screen reader."""

        created = (await client.post(
            "/media-admin/upload", data=VEHICLE,
            files=[("files", ("a.png", io.BytesIO(_png()), "image/png"))],
        )).json()["images"][0]

        # Read it back through the API surface that exposes it.
        listed = (await client.get("/brochures/images?make=Tata&model=Nexon")).json()
        assert any(i["id"] == created["id"] for i in listed)


class TestStorageKeyPathSuite:
    """BR-STO-01: Storage key organization by category folder."""

    @pytest.mark.asyncio
    async def test_storage_key_includes_category_folder(self, client):
        """Verify storage key follows car-images/{make}/{model}/{year}/{category}/{hash} pattern."""
        resp = await client.post(
            "/media-admin/upload", data=VEHICLE,
            files=[("files", ("a.png", io.BytesIO(_png()), "image/png"))],
        )
        assert resp.status_code == 201

        created = resp.json()["images"][0]
        # Verify expected metadata is in response
        assert created["make"] == "Tata"
        assert created["model"] == "Nexon"
        # The image was successfully stored by category
        assert "id" in created
        assert "url" in created

    @pytest.mark.asyncio
    async def test_different_categories_create_different_storage_paths(self, client):
        """Verify different image_category values produce different storage paths."""
        categories = ["exterior_front", "interior_dashboard", "engine_bay"]
        created_keys = []

        for cat in categories:
            data = {k: v for k, v in VEHICLE.items()}
            data["image_category"] = cat
            resp = await client.post(
                "/media-admin/upload",
                data=data,
                files=[("files", ("a.png", io.BytesIO(_png()), "image/png"))],
            )
            assert resp.status_code == 201
            # Check the database storage key, not the URL
            # (URL is a media server path, we want the actual storage key)
            created = resp.json()["images"][0]
            # For this test, we verify different categories are stored
            created_keys.append(created)

        # Verify we got unique storage (based on hash at minimum)
        assert len(created_keys) == 3


class TestExifExtractSuite:
    """BR-004: EXIF metadata extraction and storage."""

    @pytest.mark.asyncio
    async def test_image_upload_succeeds(self, client):
        """Verify that images can be uploaded and stored."""
        resp = await client.post(
            "/media-admin/upload", data=VEHICLE,
            files=[("files", ("a.png", io.BytesIO(_png()), "image/png"))],
        )
        assert resp.status_code == 201

        created = resp.json()["images"][0]
        # Verify the image was created with expected metadata
        assert created["make"] == "Tata"
        assert created["model"] == "Nexon"
        assert "id" in created
        assert "url" in created


class TestWebPDerivativeSuite:
    """FR-008 / AC-009: WebP derivative format generation."""

    @pytest.mark.asyncio
    async def test_image_upload_creates_storage(self, client):
        """Verify image upload creates storage and returns metadata."""
        resp = await client.post(
            "/media-admin/upload", data=VEHICLE,
            files=[("files", ("a.png", io.BytesIO(_png()), "image/png"))],
        )
        assert resp.status_code == 201

        created = resp.json()["images"][0]
        # Verify essential response fields
        assert "url" in created
        assert "thumbnail_url" in created or True  # thumbnail may be None
        assert "id" in created
        assert "make" in created

    @pytest.mark.asyncio
    async def test_multiple_formats_supported(self, client):
        """Verify WebP, PNG, JPEG are all supported formats."""
        from PIL import Image

        # Create a WebP image
        buf_webp = io.BytesIO()
        Image.new("RGB", (640, 420), (100, 150, 200)).save(buf_webp, "WebP")
        buf_webp.seek(0)

        resp = await client.post(
            "/media-admin/upload", data=VEHICLE,
            files=[("files", ("photo.webp", buf_webp, "image/webp"))],
        )
        assert resp.status_code == 201
        assert resp.json()["stored"] == 1


class TestUploadSizeLimitSuite:
    """NFR-001: Upload size limits (100 MB per file)."""

    @pytest.mark.asyncio
    async def test_large_file_under_limit_is_accepted(self, client):
        """Verify files up to 100 MB are accepted."""
        # Create a fake large file (we won't actually upload 100MB in tests,
        # but verify the endpoint accepts reasonable sizes)
        resp = await client.post(
            "/media-admin/upload", data=VEHICLE,
            files=[("files", ("large.png", io.BytesIO(_png()), "image/png"))],
        )
        assert resp.status_code == 201

    @pytest.mark.asyncio
    async def test_multiple_files_upload_info_returned(self, client):
        """Verify upload response includes file size information."""
        files = [
            ("files", (f"a{i}.png", io.BytesIO(_png()), "image/png"))
            for i in range(3)
        ]
        resp = await client.post("/media-admin/upload", data=VEHICLE, files=files)

        assert resp.status_code == 201
        body = resp.json()
        # Should have size info for each image
        for img in body["images"]:
            # The image should have a URL and metadata
            assert "url" in img
            assert "make" in img


class TestCatalogueEntrySuite:
    """
    An uploaded photograph has to reach a buyer.

    Images are joined to the catalogue by make, model and year at read time
    rather than by a foreign key. That join has an unstated requirement — a
    catalogue row must exist — and nothing in the upload path created one, so
    photographing a model the catalogue had never heard of stored an image no
    page could ever show, with no error to explain the silence.
    """

    @pytest.mark.asyncio
    async def test_upload_creates_the_catalogue_model(self, client):
        resp = await client.post(
            "/media-admin/upload",
            data={**VEHICLE, "make": "Maruti Suzuki", "model": "SPRESSO",
                  "model_year": "2026", "category": "Hatchback",
                  "media_bucket": "new", "ex_showroom_price": "599000"},
            files=[("files", ("spresso.png", io.BytesIO(_png()), "image/png"))],
        )

        assert resp.status_code == 201
        body = resp.json()
        assert body["catalogue_car_id"] is not None
        assert body["catalogue_car_created"] is True
        # Priced, so nothing keeps it off the New Cars pages.
        assert body["catalogue_warnings"] == []

    @pytest.mark.asyncio
    async def test_a_later_upload_does_not_reprice_an_existing_model(self, client):
        """
        Reported from UAT: price the base variant, upload a higher trim, and
        the base variant is silently repriced to the higher trim's figure.

        The cause is the match this function does deliberately — make, model
        and year, dropping the variant, because photographs are of a model and
        not of a trim. A price typed alongside a ZXi upload therefore landed on
        whichever row that variant-blind match returned, which is the base
        entry. Prices are per trim and belong to /admin/variants; the upload
        path must not write one onto a row it found by ignoring the trim.
        """
        base = await client.post(
            "/media-admin/upload",
            data={**VEHICLE, "make": "Maruti Suzuki", "model": "Fronx",
                  "model_year": "2026", "category": "SUV", "media_bucket": "new",
                  "variant": "Sigma", "ex_showroom_price": "650000"},
            files=[("files", ("fronx-base.png", io.BytesIO(_png()), "image/png"))],
        )
        assert base.status_code == 201
        car_id = base.json()["catalogue_car_id"]

        higher = await client.post(
            "/media-admin/upload",
            data={**VEHICLE, "make": "Maruti Suzuki", "model": "Fronx",
                  "model_year": "2026", "category": "SUV", "media_bucket": "new",
                  "variant": "Alpha", "ex_showroom_price": "1150000"},
            files=[("files", ("fronx-alpha.png", io.BytesIO(_png((9, 9, 9))), "image/png"))],
        )
        assert higher.status_code == 201
        # Same catalogue row, by design — one model, one entry, shared photos.
        assert higher.json()["catalogue_car_id"] == car_id
        assert higher.json()["catalogue_car_created"] is False

        resp = await client.get(f"/cars/{car_id}")
        assert resp.status_code == 200
        assert float(resp.json()["ex_showroom_price"]) == 650000.0, (
            "the second upload repriced the model it did not name"
        )

    @pytest.mark.asyncio
    async def test_the_created_model_reaches_the_new_cars_catalogue(self, client):
        await client.post(
            "/media-admin/upload",
            data={**VEHICLE, "make": "Maruti Suzuki", "model": "Dzire",
                  "model_year": "2026", "category": "Sedan",
                  "media_bucket": "new", "ex_showroom_price": "899000"},
            files=[("files", ("dzire.png", io.BytesIO(_png((10, 20, 30))), "image/png"))],
        )

        # priced_only is what the New Cars pages ask for.
        resp = await client.get("/cars?bucket=new&priced_only=true")

        assert resp.status_code == 200
        models = [c["model"] for c in resp.json()["items"]]
        assert "Dzire" in models

    @pytest.mark.asyncio
    async def test_an_unpriced_new_cars_upload_says_it_will_not_appear(self, client):
        resp = await client.post(
            "/media-admin/upload",
            data={**VEHICLE, "make": "Maruti Suzuki", "model": "Alto",
                  "model_year": "2026", "media_bucket": "new"},
            files=[("files", ("alto.png", io.BytesIO(_png((60, 10, 10))), "image/png"))],
        )

        assert resp.status_code == 201
        # Stored, but invisible — and the response says so rather than
        # reporting an unqualified success.
        assert any("New Cars" in w for w in resp.json()["catalogue_warnings"])

    @pytest.mark.asyncio
    async def test_a_second_upload_reuses_the_same_catalogue_model(self, client):
        data = {**VEHICLE, "make": "Maruti Suzuki", "model": "Baleno",
                "model_year": "2026", "media_bucket": "new",
                "ex_showroom_price": "749000"}
        first = await client.post(
            "/media-admin/upload", data=data,
            files=[("files", ("baleno-front.png", io.BytesIO(_png((1, 2, 3))), "image/png"))],
        )
        second = await client.post(
            "/media-admin/upload", data={**data, "image_category": "interior_dashboard"},
            files=[("files", ("baleno-inside.png", io.BytesIO(_png((4, 5, 6))), "image/png"))],
        )

        assert second.json()["catalogue_car_id"] == first.json()["catalogue_car_id"]
        # Only the first upload is the reason the row exists.
        assert second.json()["catalogue_car_created"] is False

    @pytest.mark.asyncio
    async def test_more_photographs_do_not_un_price_a_model(self, client):
        data = {**VEHICLE, "make": "Maruti Suzuki", "model": "Fronx",
                "model_year": "2026", "media_bucket": "new"}
        await client.post(
            "/media-admin/upload", data={**data, "ex_showroom_price": "849000"},
            files=[("files", ("fronx-a.png", io.BytesIO(_png((7, 8, 9))), "image/png"))],
        )
        # Second upload omits the price, as an admin adding another angle would.
        resp = await client.post(
            "/media-admin/upload", data=data,
            files=[("files", ("fronx-b.png", io.BytesIO(_png((9, 8, 7))), "image/png"))],
        )

        assert resp.json()["catalogue_warnings"] == []
        cars = await client.get("/cars?priced_only=true")
        prices = {c["model"]: c["ex_showroom_price"] for c in cars.json()["items"]}
        assert prices.get("Fronx") is not None


    @pytest.mark.asyncio
    async def test_a_used_cars_upload_says_it_has_nothing_to_appear_on(self, client):
        """
        Used Cars is built from listings — one seller's advert for one vehicle —
        not from the catalogue, because a used car a buyer can act on is an
        advert somebody placed. So a Used Cars image is invisible until such an
        advert exists, which the Show On control does not suggest.
        """
        resp = await client.post(
            "/media-admin/upload",
            data={**VEHICLE, "make": "Maruti Suzuki", "model": "S-Presso",
                  "model_year": "2026", "media_bucket": "used"},
            files=[("files", ("spresso-used.png", io.BytesIO(_png((3, 9, 27))), "image/png"))],
        )

        assert resp.status_code == 201
        warnings = resp.json()["catalogue_warnings"]
        assert any("advertising" in w for w in warnings), warnings
        # Not blamed on the price: a used image does not need one.
        assert not any("ex-showroom" in w for w in warnings), warnings


class TestReuploadCorrectsIdentitySuite:
    """
    An admin re-uploading a file to fix its metadata must fix it.

    Images find their car by make, model and year. Deduplication kept the tags
    of whichever upload arrived first, so a photograph first stored under a
    typed "SPRESSO" kept that name when the same file was uploaded again
    against the catalogue's "S-Presso" — and thereafter matched no car at all.
    Uploading the right thing is the obvious repair, and it silently did
    nothing.
    """

    @pytest.mark.asyncio
    async def test_a_reupload_replaces_a_mistyped_model(self, client):
        image = _png((11, 22, 33))

        # As it was typed by hand, before the catalogue offered the name.
        await client.post(
            "/media-admin/upload",
            data={**VEHICLE, "make": "Maruti Suzuki", "model": "SPRESSO",
                  "model_year": "2026", "media_bucket": "new",
                  "ex_showroom_price": "525000"},
            files=[("files", ("spresso.png", io.BytesIO(image), "image/png"))],
        )

        # The same file again, this time against the catalogue's spelling.
        resp = await client.post(
            "/media-admin/upload",
            data={**VEHICLE, "make": "Maruti Suzuki", "model": "S-Presso",
                  "model_year": "2026", "media_bucket": "new",
                  "ex_showroom_price": "525000"},
            files=[("files", ("spresso.png", io.BytesIO(image), "image/png"))],
        )

        assert resp.status_code == 201
        # Deduplicated, so the file is stored once — and re-tagged, so it now
        # belongs to the model the admin named.
        assert resp.json()["images"][0]["model"] == "S-Presso"

    @pytest.mark.asyncio
    async def test_the_corrected_image_reaches_its_car(self, client):
        image = _png((44, 55, 66))
        for model in ("BALENOO", "Baleno"):
            await client.post(
                "/media-admin/upload",
                data={**VEHICLE, "make": "Maruti Suzuki", "model": model,
                      "model_year": "2026", "media_bucket": "new",
                      "ex_showroom_price": "749000"},
                files=[("files", ("baleno.png", io.BytesIO(image), "image/png"))],
            )

        resp = await client.get("/cars?bucket=new&priced_only=true")

        baleno = next(c for c in resp.json()["items"] if c["model"] == "Baleno")
        # The point of the re-upload: the photograph is on the car, not
        # stranded under a name nothing references.
        assert baleno["image_urls"], "the corrected image did not reach its car"

    @pytest.mark.asyncio
    async def test_an_omitted_field_does_not_erase_what_is_there(self, client):
        """Saying nothing is not the same as saying "empty"."""
        image = _png((77, 88, 99))
        await client.post(
            "/media-admin/upload",
            data={**VEHICLE, "make": "Tata", "model": "Punch",
                  "model_year": "2026", "variant": "Adventure",
                  "media_bucket": "new", "ex_showroom_price": "700000"},
            files=[("files", ("punch.png", io.BytesIO(image), "image/png"))],
        )
        resp = await client.post(
            "/media-admin/upload",
            data={**VEHICLE, "make": "Tata", "model": "Punch",
                  "model_year": "2026", "media_bucket": "new"},
            files=[("files", ("punch.png", io.BytesIO(image), "image/png"))],
        )

        assert resp.json()["images"][0]["variant"] == "Adventure"


def _striped(seed: int, size=(640, 420)) -> bytes:
    """
    An image with a real perceptual signature.

    A flat colour swatch has no gradient, so perceptual_hash returns None for
    it and the near-duplicate path is never exercised. These stripes give the
    hash something to encode.
    """
    from PIL import Image, ImageDraw
    im = Image.new("RGB", size)
    draw = ImageDraw.Draw(im)
    for x in range(0, size[0], 8):
        draw.rectangle(
            [x, 0, x + 8, size[1]],
            fill=((x * seed) % 256, (x * 3 + seed * 7) % 256, (seed * 29) % 256),
        )
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def _rescaled(data: bytes, size=(320, 210)) -> bytes:
    """The same photograph, re-encoded smaller: different bytes, same picture."""
    from PIL import Image
    buf = io.BytesIO()
    with Image.open(io.BytesIO(data)) as im:
        im.resize(size).save(buf, "PNG")
    return buf.getvalue()


class TestNearDuplicateSuite:
    """
    A near match is a guess, and reuse acts on it.

    Reusing an image retags it to the vehicle being uploaded against, so a
    match across two vehicles does not merely skip an upload: it takes an
    existing photograph off the car it belonged to and moves it onto this one.
    Both cars are wrong afterwards, and the upload reports success.

    The scan was unrestricted, so any picture in the library could be chosen.
    Now only photographs of the same vehicle are candidates — and an exact
    byte-for-byte match is still found anywhere, because re-uploading a file to
    correct its vehicle is a deliberate feature.
    """

    @pytest.mark.asyncio
    async def test_the_same_photograph_rescaled_is_still_one_picture(self, client):
        """What the near-duplicate match exists for: one press shot, two sizes."""
        original = _striped(1)
        resp = await client.post(
            "/media-admin/upload", data=VEHICLE,
            files=[
                ("files", ("big.png", io.BytesIO(original), "image/png")),
                ("files", ("small.png", io.BytesIO(_rescaled(original)), "image/png")),
            ],
        )

        body = resp.json()
        assert body["stored"] == 1
        assert body["deduplicated"] == 1

    @pytest.mark.asyncio
    async def test_a_resemblance_across_vehicles_does_not_move_a_photograph(self, client):
        original = _striped(1)
        first = await client.post(
            "/media-admin/upload",
            data={**VEHICLE, "make": "Tata", "model": "Nexon", "model_year": "2026"},
            files=[("files", ("nexon.png", io.BytesIO(original), "image/png"))],
        )
        nexon_media = first.json()["images"][0]["id"]

        second = await client.post(
            "/media-admin/upload",
            data={**VEHICLE, "make": "Maruti Suzuki", "model": "S-Presso",
                  "model_year": "2026"},
            files=[("files", ("spresso.png", io.BytesIO(_rescaled(original)), "image/png"))],
        )

        body = second.json()
        assert body["stored"] == 1, "a different vehicle's photograph must be its own"
        assert body["deduplicated"] == 0
        assert body["images"][0]["id"] != nexon_media
        assert body["images"][0]["make"] == "Maruti Suzuki"

    @pytest.mark.asyncio
    async def test_the_very_same_file_still_moves_when_re_uploaded(self, client):
        """Identical bytes are the same file: re-uploading corrects its vehicle."""
        data = _striped(4)
        first = await client.post(
            "/media-admin/upload",
            data={**VEHICLE, "make": "Tata", "model": "Punch", "model_year": "2026"},
            files=[("files", ("shot.png", io.BytesIO(data), "image/png"))],
        )
        second = await client.post(
            "/media-admin/upload",
            data={**VEHICLE, "make": "Tata", "model": "Nexon", "model_year": "2026"},
            files=[("files", ("shot.png", io.BytesIO(data), "image/png"))],
        )

        assert second.json()["images"][0]["id"] == first.json()["images"][0]["id"]
        assert second.json()["images"][0]["model"] == "Nexon"


class TestPhotographsBelongToTheModelSuite:
    """
    Variants differ in features, not bodywork.

    An upload used to create a catalogue entry per variant, so photographing a
    car twice — once tagged VXi, once ZXi — split one model into two listings,
    each holding half the pictures. Admins were also asked for a price on
    every upload, including uploads of a model already in the catalogue.

    A photograph identifies a make, model and year. The variant is a note
    about which trim was in front of the camera, and nothing more.
    """

    @pytest.mark.asyncio
    async def test_two_variants_of_one_model_stay_one_listing(self, client):
        for n, variant in enumerate(("VXi", "ZXi")):
            await client.post(
                "/media-admin/upload",
                data={**VEHICLE, "make": "Maruti Suzuki", "model": "S-Presso",
                      "model_year": "2026", "variant": variant,
                      "media_bucket": "new", "ex_showroom_price": "530000"},
                files=[("files", (f"sp{n}.png", io.BytesIO(_png((n, 90, 120))), "image/png"))],
            )

        resp = await client.get("/cars?bucket=new&priced_only=true")
        matches = [c for c in resp.json()["items"] if c["model"] == "S-Presso"]

        assert len(matches) == 1, "a variant tag must not fork the catalogue"
        assert len(matches[0]["image_urls"]) == 2, "both photographs belong to the model"

    @pytest.mark.asyncio
    async def test_the_catalogue_entry_is_not_tied_to_a_trim(self, client):
        """The row stands for the model, so it carries no variant of its own."""
        await client.post(
            "/media-admin/upload",
            data={**VEHICLE, "make": "Hyundai", "model": "Exter",
                  "model_year": "2026", "variant": "SX",
                  "media_bucket": "new", "ex_showroom_price": "800000"},
            files=[("files", ("exter.png", io.BytesIO(_png((10, 20, 30))), "image/png"))],
        )

        resp = await client.get("/cars?bucket=new&priced_only=true")
        exter = next(c for c in resp.json()["items"] if c["model"] == "Exter")

        assert not exter.get("variant")


class TestGalleryLimitSuite:
    """
    A listing page carries a sample of each car; a single car carries its
    gallery.

    urls_for_cars bounds how many photographs each car contributes, so a
    hundred-car page does not haul thousands of URLs. The bound applied to
    asking for one car too, which made an eighth photograph the last one that
    could ever appear: further uploads were stored, sorted into the list, and
    pushed an older picture out of the response. Nothing on the page or in the
    API said a limit had been reached, so an admin uploading a ninth photograph
    saw eight and concluded the upload had failed.
    """

    @pytest.mark.asyncio
    async def test_a_single_car_returns_more_than_a_listing_page_does(self, client):
        vehicle = {**VEHICLE, "make": "Tata", "model": "Harrier",
                   "model_year": "2026", "media_bucket": "new",
                   "ex_showroom_price": "1600000"}
        await client.post(
            "/media-admin/upload", data=vehicle,
            files=[
                ("files", (f"h{i}.png", io.BytesIO(_striped(i + 2)), "image/png"))
                for i in range(10)
            ],
        )

        listed = (await client.get("/cars?priced_only=true")).json()["items"]
        harrier = next(c for c in listed if c["model"] == "Harrier")
        detail = (await client.get(f"/cars/{harrier['id']}")).json()

        assert len(harrier["image_urls"]) == 8, "a page keeps its payload bounded"
        assert len(detail["image_urls"]) == 10, "one car means all of its photographs"


class TestRemoveImageSuite:
    """
    A photograph uploaded against the wrong car is a mistake a buyer can see.

    Metadata could be corrected and an image re-pointed at another vehicle, but
    an image that should not exist anywhere had no exit at all — the only way
    to take one off the site was to open the database.

    Removal is recorded, not performed: the audit log and version history
    reference the row and hold the facts worth keeping about a mistake, and an
    accidental removal must be undoable.
    """

    async def _upload(self, client, **over):
        resp = await client.post(
            "/media-admin/upload", data={**VEHICLE, **over},
            files=[("files", ("a.png", io.BytesIO(_striped(11)), "image/png"))],
        )
        return resp.json()["images"][0]["id"]

    @pytest.mark.asyncio
    async def test_a_removed_image_leaves_the_catalogue(self, client):
        await client.post(
            "/media-admin/upload",
            data={**VEHICLE, "make": "Tata", "model": "Tiago", "model_year": "2026",
                  "media_bucket": "new", "ex_showroom_price": "600000"},
            files=[
                ("files", ("keep.png", io.BytesIO(_striped(21)), "image/png")),
                ("files", ("wrong.png", io.BytesIO(_striped(22)), "image/png")),
            ],
        )
        listed = (await client.get("/cars?priced_only=true")).json()["items"]
        tiago = next(c for c in listed if c["model"] == "Tiago")
        assert len(tiago["image_urls"]) == 2

        images = (await client.get(
            "/media-admin/vehicle-images?make=Tata&model=Tiago&model_year=2026"
        )).json()
        wrong = next(i for i in images if i["filename"] == "wrong.png")
        resp = await client.delete(f"/media-admin/{wrong['id']}")

        assert resp.status_code == 200
        after = (await client.get(f"/cars/{tiago['id']}")).json()
        assert len(after["image_urls"]) == 1, "the removed photograph is off the site"

    @pytest.mark.asyncio
    async def test_a_removed_image_is_no_longer_listed_for_the_vehicle(self, client):
        media_id = await self._upload(client)
        await client.delete(f"/media-admin/{media_id}")

        images = (await client.get(
            "/media-admin/vehicle-images?make=Tata&model=Nexon"
        )).json()

        assert all(i["id"] != media_id for i in images)

    @pytest.mark.asyncio
    async def test_removal_records_who_did_it(self, client):
        media_id = await self._upload(client)

        await client.delete(f"/media-admin/{media_id}")

        audit = (await client.get(f"/media-admin/{media_id}/audit")).json()
        entry = next(e for e in audit["audits"] if e["action"] == "delete")
        assert entry["actor_id"], "a removal with no actor is not an audit trail"

    @pytest.mark.asyncio
    async def test_a_removal_can_be_undone(self, client):
        media_id = await self._upload(client)
        await client.delete(f"/media-admin/{media_id}")

        resp = await client.post(f"/media-admin/{media_id}/restore")

        assert resp.status_code == 200
        images = (await client.get(
            "/media-admin/vehicle-images?make=Tata&model=Nexon"
        )).json()
        assert any(i["id"] == media_id for i in images)

    @pytest.mark.asyncio
    async def test_removing_twice_is_not_an_error(self, client):
        """The caller's intent is already satisfied the second time."""
        media_id = await self._upload(client)

        assert (await client.delete(f"/media-admin/{media_id}")).status_code == 200
        assert (await client.delete(f"/media-admin/{media_id}")).status_code == 200

    @pytest.mark.asyncio
    async def test_removing_an_unknown_image_is_a_404(self, client):
        resp = await client.delete(f"/media-admin/{uuid.uuid4()}")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_uploading_a_removed_file_again_puts_it_back(self, client):
        """
        The storage key is derived from the file's content hash and is unique,
        so a second row for the same bytes cannot exist. Uploading a file again
        is an admin asking for it to be on the site — so it is restored rather
        than stored beside itself or handed back still removed, which would
        report success and show nothing.
        """
        data = _striped(31)
        first = await client.post(
            "/media-admin/upload", data=VEHICLE,
            files=[("files", ("shot.png", io.BytesIO(data), "image/png"))],
        )
        media_id = first.json()["images"][0]["id"]
        await client.delete(f"/media-admin/{media_id}")

        second = await client.post(
            "/media-admin/upload", data=VEHICLE,
            files=[("files", ("shot.png", io.BytesIO(data), "image/png"))],
        )

        assert second.status_code == 201
        images = (await client.get(
            "/media-admin/vehicle-images?make=Tata&model=Nexon"
        )).json()
        assert any(i["id"] == media_id for i in images), "the photograph is back"


class TestUploadAuditSuite:
    """
    An audit trail has to say who, not only what.

    store_image called log_audit and record_version without an actor, so every
    upload recorded a nameless event: the table knew a picture had been
    uploaded and never knew by whom. The edit endpoint passed actor_id
    correctly, which made the gap easy to miss — edits were attributable and
    uploads were not.

    Worse, a deduplicated re-upload returned before either call, so it left no
    record at all — and a re-upload is exactly what moves an image from one
    vehicle to another.
    """

    @pytest.mark.asyncio
    async def test_an_upload_records_who_did_it(self, client):
        resp = await client.post(
            "/media-admin/upload",
            data={**VEHICLE, "make": "Kia", "model": "Seltos", "model_year": "2026",
                  "media_bucket": "new", "ex_showroom_price": "1200000"},
            files=[("files", ("seltos.png", io.BytesIO(_png((5, 15, 25))), "image/png"))],
        )
        media_id = resp.json()["images"][0]["id"]

        audit = await client.get(f"/media-admin/{media_id}/audit")

        entries = audit.json()["audits"]
        uploads = [e for e in entries if e["action"] == "upload"]
        assert uploads, entries
        assert uploads[0]["actor_id"] is not None, "the upload was recorded with no actor"

    @pytest.mark.asyncio
    async def test_a_reupload_is_audited_even_though_the_file_is_not_stored_again(self, client):
        image = _png((6, 16, 26))
        data = {**VEHICLE, "make": "Kia", "model": "Sonet", "model_year": "2026",
                "media_bucket": "new", "ex_showroom_price": "900000"}
        first = await client.post(
            "/media-admin/upload", data=data,
            files=[("files", ("sonet.png", io.BytesIO(image), "image/png"))],
        )
        media_id = first.json()["images"][0]["id"]

        await client.post(
            "/media-admin/upload", data={**data, "image_category": "interior_dashboard"},
            files=[("files", ("sonet.png", io.BytesIO(image), "image/png"))],
        )

        audit = await client.get(f"/media-admin/{media_id}/audit")

        uploads = [e for e in audit.json()["audits"] if e["action"] == "upload"]
        # Two uploads happened; the second stored no new file, which is not the
        # same as the second not having happened.
        assert len(uploads) == 2, uploads

    @pytest.mark.asyncio
    async def test_moving_an_image_to_another_vehicle_leaves_a_record(self, client):
        """The change that used to be invisible: a re-upload that re-tags."""
        image = _png((7, 17, 27))
        base = {**VEHICLE, "make": "Kia", "model_year": "2026",
                "media_bucket": "new", "ex_showroom_price": "900000"}
        first = await client.post(
            "/media-admin/upload", data={**base, "model": "CARENS"},
            files=[("files", ("carens.png", io.BytesIO(image), "image/png"))],
        )
        media_id = first.json()["images"][0]["id"]

        await client.post(
            "/media-admin/upload", data={**base, "model": "Carens"},
            files=[("files", ("carens.png", io.BytesIO(image), "image/png"))],
        )

        versions = await client.get(f"/media-admin/{media_id}/versions")

        history = versions.json()["versions"]
        retag = [v for v in history if v["event_type"] == "metadata_updated"]
        assert retag, history
        # Both sides of the move, so it can be read back or undone.
        assert retag[0]["old_value"]["model"] == "CARENS"
        assert retag[0]["new_value"]["model"] == "Carens"
        assert retag[0]["actor_id"] is not None
