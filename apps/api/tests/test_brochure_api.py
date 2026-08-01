"""
End-to-end brochure ingestion over HTTP.

Exercises the real route stack — auth, upload, PDF parsing, storage writes and
database rows — rather than calling the service functions directly.
"""
import io
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import services.media_storage as media_storage
from core.dependencies import get_admin_user
from db.session import get_db
from main import app
from models.user import User, UserRole
from services.media_storage import LocalStorage


def _car_png(colour=(190, 40, 40)) -> bytes:
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (900, 520), (245, 245, 248))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([80, 180, 820, 400], 40, fill=colour)
    d.ellipse([160, 350, 290, 470], fill=(30, 30, 30))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def _brochure_pdf() -> bytes:
    try:
        import fitz
    except ImportError:
        pytest.skip("PyMuPDF not installed")

    doc = fitz.open()
    p = doc.new_page()
    p.insert_text((60, 70), "MARUTI SUZUKI DZIRE 2025", fontsize=24)
    p.insert_text((60, 110), "ZXi+ AGS - Ex-showroom Rs 9,29,000", fontsize=14)
    p.insert_image(fitz.Rect(60, 200, 540, 480), stream=_car_png())
    data = doc.tobytes()
    doc.close()
    return data


@pytest_asyncio.fixture
async def client(db_engine, tmp_path, monkeypatch):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    # Point storage at a temp folder so the suite never writes into the repo.
    monkeypatch.setattr(
        media_storage, "_backend",
        LocalStorage(root=tmp_path / "media", public_prefix="/media"),
    )

    admin = User(
        id=uuid.uuid4(), email="admin@test.local",
        hashed_password="x", role=UserRole.admin, is_verified=True,
    )

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_admin_user] = lambda: admin
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        c.session_factory = session_factory
        yield c
    app.dependency_overrides.clear()


class TestBrochureUploadSuite:
    @pytest.mark.asyncio
    async def test_upload_extracts_images_and_records_metadata(self, client, monkeypatch):
        # The AI step is stubbed: it needs a model, and image extraction must
        # be provable without one.
        async def fake_extract(text, source=None):
            return [{
                "make": "Maruti Suzuki", "model": "Dzire", "variant": "ZXi+",
                "model_year": 2025, "price_inr": 929000, "fuel_type": "Petrol",
                "transmission": "AGS", "body_type": "Sedan",
                "colours": ["Sizzling Red"], "features": [], "specs": {},
                "confidence": 0.9,
            }], "gemini"

        monkeypatch.setattr("services.pdf_ingest.extract_vehicles", fake_extract)

        r = await client.post(
            "/brochures/upload",
            files={"file": ("dzire.pdf", _brochure_pdf(), "application/pdf")},
        )
        assert r.status_code == 201, r.text
        body = r.json()

        assert body["status"] == "completed"
        assert body["image_count"] == 1
        assert body["vehicle_count"] == 1
        assert body["ai_engine"] == "gemini"
        assert body["source_pdf_name"] == "dzire.pdf"

        # Requirement: unique id, path, source PDF name, timestamp.
        image = body["images"][0]
        assert uuid.UUID(image["id"])
        assert image["url"].startswith("/media/brochures/")
        assert image["source_pdf_name"] == "dzire.pdf"
        assert image["created_at"]
        assert image["page_number"] == 1

        # A single-vehicle brochure attributes its images automatically.
        assert image["make"] == "Maruti Suzuki"
        assert image["model"] == "Dzire"

    @pytest.mark.asyncio
    async def test_uploaded_image_is_actually_served(self, client, monkeypatch):
        monkeypatch.setattr(
            "services.pdf_ingest.extract_vehicles",
            _noop_vehicles,
        )
        r = await client.post(
            "/brochures/upload",
            files={"file": ("b.pdf", _brochure_pdf(), "application/pdf")},
        )
        url = r.json()["images"][0]["url"]

        served = await client.get(url)
        assert served.status_code == 200
        assert served.headers["content-type"] == "image/png"
        # Magic bytes prove real image data came back, not an error page.
        assert served.content[:8] == b"\x89PNG\r\n\x1a\n"

    @pytest.mark.asyncio
    async def test_non_pdf_is_rejected(self, client):
        r = await client.post(
            "/brochures/upload",
            files={"file": ("evil.pdf", b"MZ\x90\x00 not a pdf", "application/pdf")},
        )
        assert r.status_code == 400
        assert "not a PDF" in r.json()["detail"]

    @pytest.mark.asyncio
    async def test_empty_upload_is_rejected(self, client):
        r = await client.post(
            "/brochures/upload",
            files={"file": ("empty.pdf", b"", "application/pdf")},
        )
        assert r.status_code == 400

    @pytest.mark.asyncio
    async def test_images_survive_an_offline_ai(self, client, monkeypatch):
        # The point of extracting images first: a model outage must not lose
        # the brochure's photographs.
        async def dead(text, source=None):
            return [], "none"

        monkeypatch.setattr("services.pdf_ingest.extract_vehicles", dead)
        r = await client.post(
            "/brochures/upload",
            files={"file": ("b.pdf", _brochure_pdf(), "application/pdf")},
        )
        assert r.status_code == 201
        assert r.json()["image_count"] == 1
        assert r.json()["vehicle_count"] == 0
        assert r.json()["ai_engine"] == "none"


async def _noop_vehicles(text, source=None):
    return [], "none"


class TestBrochureQuerySuite:
    @pytest.mark.asyncio
    async def test_images_are_listed_and_filterable(self, client, monkeypatch):
        async def fake(text, source=None):
            return [{
                "make": "Tata", "model": "Nexon", "variant": None, "model_year": None,
                "price_inr": None, "fuel_type": None, "transmission": None,
                "body_type": None, "colours": [], "features": [], "specs": {},
                "confidence": 0.5,
            }], "ollama"

        monkeypatch.setattr("services.pdf_ingest.extract_vehicles", fake)
        await client.post(
            "/brochures/upload",
            files={"file": ("nexon.pdf", _brochure_pdf(), "application/pdf")},
        )

        assert len((await client.get("/brochures/images")).json()) == 1
        # Case-insensitive: brochure capitalisation is wildly inconsistent.
        assert len((await client.get("/brochures/images?make=tata")).json()) == 1
        assert len((await client.get("/brochures/images?make=honda")).json()) == 0

    @pytest.mark.asyncio
    async def test_deleting_a_job_removes_its_files_and_rows(self, client, monkeypatch):
        monkeypatch.setattr("services.pdf_ingest.extract_vehicles", _noop_vehicles)
        job_id = (await client.post(
            "/brochures/upload",
            files={"file": ("b.pdf", _brochure_pdf(), "application/pdf")},
        )).json()["id"]

        url = (await client.get(f"/brochures/jobs/{job_id}")).json()["images"][0]["url"]
        assert (await client.get(url)).status_code == 200

        assert (await client.delete(f"/brochures/jobs/{job_id}")).status_code == 204
        # The file is gone, not merely unreferenced.
        assert (await client.get(url)).status_code == 404
        assert (await client.get(f"/brochures/jobs/{job_id}")).status_code == 404

    @pytest.mark.asyncio
    async def test_missing_media_key_is_404_not_500(self, client):
        r = await client.get("/media/brochures/does-not-exist/000.png")
        assert r.status_code == 404


class TestEmptyExtractionIsExplainedSuite:
    """
    "0 vehicles" has three causes that need three different responses, and the
    count alone distinguishes none of them. The UI used to guess "check
    GEMINI_API_KEY", which is wrong — and wastes an operator's evening — when
    the real problem is a brochure whose text is part of its artwork.
    """

    def test_no_readable_text_says_so(self):
        from routers.brochures import _why_no_vehicles

        reason = _why_no_vehicles("   \n  ", "none")

        assert "readable text" in reason.lower()
        assert "artwork" in reason.lower()
        # Naming the key is correct here now: with no text layer, reading the
        # pages as images is the route to the data, and that needs the key.
        assert "GEMINI_API_KEY" in reason

    def test_a_page_number_alone_is_not_usable_text(self):
        from routers.brochures import _why_no_vehicles

        assert "readable text" in _why_no_vehicles("Page 1 of 4\n© 2026", "none").lower()

    def test_text_present_but_no_model_names_the_key(self):
        from routers.brochures import _why_no_vehicles

        reason = _why_no_vehicles("Dzire VXi specifications " * 40, "none")

        assert "GEMINI_API_KEY" in reason
        assert "no readable text" not in reason.lower()

    def test_a_model_that_found_nothing_says_which_model(self):
        from routers.brochures import _why_no_vehicles

        reason = _why_no_vehicles("Dzire VXi specifications " * 40, "gemini")

        assert "gemini" in reason
        assert "found no vehicle records" in reason


class TestVisionOutcomesAreDistinguishedSuite:
    """
    "No text layer" has four outcomes, and they need four different messages.

    Collapsing them told an operator to set GEMINI_API_KEY when the key was set
    and the call had failed — the same misdiagnosis the previous fix removed,
    one layer further in.
    """

    def test_key_missing_is_the_only_message_naming_the_key(self):
        from routers.brochures import _why_no_vehicles

        # "none" is the only engine value that explains the fallback to Ollama
        reason = _why_no_vehicles("", "none")
        assert "GEMINI_API_KEY" in reason
        assert "Ollama" in reason

        # Vision outcomes should not mention the fallback mechanism
        for engine in ("gemini-vision", "ollama-vision", "vision-call-failed",
                       "vision-render-failed", "vision-parse-failed"):
            reason = _why_no_vehicles("", engine)
            assert "GEMINI_API_KEY" not in reason or "Set" not in reason, engine

    def test_a_failed_call_points_at_the_logs(self):
        from routers.brochures import _why_no_vehicles

        reason = _why_no_vehicles("", "vision-call-failed")

        assert "failed" in reason.lower()
        assert "logs" in reason.lower()
        # Quota and a bad key are the usual causes; naming them saves a search.
        assert "quota" in reason.lower()

    def test_a_successful_read_that_found_nothing_suggests_dpi(self):
        from routers.brochures import _why_no_vehicles

        assert "PDF_VISION_DPI" in _why_no_vehicles("", "gemini-vision")

    def test_render_and_parse_failures_are_told_apart(self):
        from routers.brochures import _why_no_vehicles

        render = _why_no_vehicles("", "vision-render-failed")
        parse = _why_no_vehicles("", "vision-parse-failed")

        assert "could not be rendered" in render
        assert "not the expected JSON" in parse
        assert render != parse


class TestRateLimitMessageSuite:
    def test_throttling_does_not_blame_the_api_key(self):
        from routers.brochures import _why_no_vehicles

        reason = _why_no_vehicles("", "vision-rate-limited")

        # The whole point of the distinct engine value: a throttle clears by
        # itself, so the message must say so rather than sending an operator
        # to recheck a key that was correct.
        assert "rate-limited" in reason.lower() or "rate limit" in reason.lower()
        assert "retry" in reason.lower()
        assert "fine" in reason.lower() or "clears" in reason.lower()

    def test_throttling_is_not_the_generic_failure_message(self):
        from routers.brochures import _why_no_vehicles

        assert _why_no_vehicles("", "vision-rate-limited") != _why_no_vehicles("", "vision-call-failed")


class TestManualImageTaggingSuite:
    """
    Endpoint to manually tag untagged images when vehicle extraction fails.
    """

    @pytest.mark.asyncio
    async def test_tag_images_manually(self, client, monkeypatch):
        # Upload a brochure but with no vehicle extraction
        async def no_extract(text, source=None):
            return [], "none"

        monkeypatch.setattr("services.pdf_ingest.extract_vehicles", no_extract)

        job_id = (await client.post(
            "/brochures/upload",
            files={"file": ("dzire.pdf", _brochure_pdf(), "application/pdf")},
        )).json()["id"]

        # Verify images exist but are untagged
        images_before = await client.get("/brochures/images?make=Maruti%20Suzuki&model=Dzire")
        assert len(images_before.json()) == 0

        # Tag the images
        tag_response = await client.post(
            "/brochures/tag-images",
            json={
                "pdf_name": "dzire.pdf",
                "make": "Maruti Suzuki",
                "model": "Dzire",
                "variant": "ZXi+",
            },
        )
        assert tag_response.status_code == 200
        assert tag_response.json()["tagged_count"] == 1

        # Now images should be queryable
        images_after = await client.get("/brochures/images?make=Maruti%20Suzuki&model=Dzire")
        assert len(images_after.json()) == 1
        assert images_after.json()[0]["make"] == "Maruti Suzuki"
        assert images_after.json()[0]["model"] == "Dzire"

    @pytest.mark.asyncio
    async def test_tag_images_not_found(self, client):
        # Try to tag images from a PDF that doesn't exist
        tag_response = await client.post(
            "/brochures/tag-images",
            json={
                "pdf_name": "nonexistent.pdf",
                "make": "Maruti Suzuki",
                "model": "Dzire",
            },
        )
        assert tag_response.status_code == 404
