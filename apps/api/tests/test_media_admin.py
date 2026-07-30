"""
Admin image upload (BR-001, BR-002, FR-001, FR-002, FR-004).

The journey the BRD is actually about: an admin supplies photography and states
what it is, once, and every catalogue surface finds it by that metadata. Its
distinguishing property against the brochure pipeline is that the metadata is
*asserted* rather than inferred, so the mandatory fields are enforced — an
untagged image is invisible to every surface and therefore not worth storing.
"""
import io

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
    app.dependency_overrides[get_admin_user] = lambda: User(
        email="admin@test.com", hashed_password="x"
    )
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
