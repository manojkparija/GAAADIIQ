"""
Audio / video upload endpoint tests (TC-F-12, TC-F-13, TC-S-04).

Focus is the validation boundary: content-type allowlist, size caps and
magic-byte checks that stop a spoofed Content-Type from smuggling a payload.
R2 is unconfigured under test, so storage returns a placeholder URL.
"""
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from db.session import get_db
from main import app
from routers.upload import _check_av_magic_bytes

# ── Minimal valid container headers ──────────────────────────────────────────
MP4 = b"\x00\x00\x00\x20ftypisom" + b"\x00" * 64
WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 64
OGG = b"OggS" + b"\x00" * 64
WAV = b"RIFF\x00\x00\x00\x00WAVE" + b"\x00" * 64
MP3_ID3 = b"ID3\x03\x00\x00\x00" + b"\x00" * 64
MP3_SYNC = b"\xff\xfb\x90\x00" + b"\x00" * 64


@pytest_asyncio.fixture
async def client(db_engine):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)

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
        yield c
    app.dependency_overrides.clear()


async def _token(client: AsyncClient, email: str) -> str:
    r = await client.post("/auth/register", json={"email": email, "password": "password123"})
    return r.json()["access_token"]


class TestAvMagicBytesSuite:
    @pytest.mark.parametrize("data", [MP4, WEBM, OGG, WAV, MP3_ID3, MP3_SYNC])
    def test_accepts_known_containers(self, data):
        assert _check_av_magic_bytes(data) is True

    @pytest.mark.parametrize("data", [
        b"",                                     # empty
        b"short",                                # under the 12-byte minimum
        b"<?php system($_GET[0]); ?>" + b"\x00" * 32,   # script disguised as media
        b"\x89PNG\r\n\x1a\n" + b"\x00" * 32,     # PNG is not audio/video
        b"GIF89a" + b"\x00" * 32,
        b"%PDF-1.4" + b"\x00" * 32,
        b"MZ\x90\x00" + b"\x00" * 32,            # Windows executable
        b"\x7fELF" + b"\x00" * 32,               # Linux executable
    ])
    def test_rejects_non_media(self, data):
        assert _check_av_magic_bytes(data) is False


class TestAudioUploadSuite:
    @pytest.mark.asyncio
    async def test_requires_authentication(self, client):
        r = await client.post(
            "/upload/audio", files={"file": ("a.webm", WEBM, "audio/webm")}
        )
        assert r.status_code in (401, 403)

    @pytest.mark.asyncio
    async def test_accepts_valid_audio(self, client):
        token = await _token(client, "audio-ok@test.com")
        r = await client.post(
            "/upload/audio",
            files={"file": ("engine.webm", WEBM, "audio/webm")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["url"].endswith(".webm")
        assert body["size_bytes"] == len(WEBM)

    @pytest.mark.asyncio
    async def test_rejects_disallowed_content_type(self, client):
        token = await _token(client, "audio-type@test.com")
        r = await client.post(
            "/upload/audio",
            files={"file": ("x.exe", MP4, "application/x-msdownload")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 415

    @pytest.mark.asyncio
    async def test_rejects_spoofed_content_type(self, client):
        # Declared as audio, but the bytes are an ELF binary (TC-S-04).
        token = await _token(client, "audio-spoof@test.com")
        r = await client.post(
            "/upload/audio",
            files={"file": ("evil.webm", b"\x7fELF" + b"\x00" * 64, "audio/webm")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 415

    @pytest.mark.asyncio
    async def test_rejects_empty_file(self, client):
        token = await _token(client, "audio-empty@test.com")
        r = await client.post(
            "/upload/audio",
            files={"file": ("empty.webm", b"", "audio/webm")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code in (400, 415)

    @pytest.mark.asyncio
    async def test_rejects_oversized_audio(self, client):
        token = await _token(client, "audio-big@test.com")
        oversized = WEBM + b"\x00" * (26 * 1024 * 1024)
        r = await client.post(
            "/upload/audio",
            files={"file": ("big.webm", oversized, "audio/webm")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 413

    @pytest.mark.asyncio
    async def test_rejects_video_sent_to_audio_endpoint(self, client):
        token = await _token(client, "audio-vid@test.com")
        r = await client.post(
            "/upload/audio",
            files={"file": ("clip.mp4", MP4, "video/mp4")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 415


class TestVideoUploadSuite:
    @pytest.mark.asyncio
    async def test_requires_authentication(self, client):
        r = await client.post("/upload/video", files={"file": ("v.mp4", MP4, "video/mp4")})
        assert r.status_code in (401, 403)

    @pytest.mark.asyncio
    async def test_accepts_valid_video(self, client):
        token = await _token(client, "video-ok@test.com")
        r = await client.post(
            "/upload/video",
            files={"file": ("fault.mp4", MP4, "video/mp4")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        assert r.json()["url"].endswith(".mp4")

    @pytest.mark.asyncio
    async def test_rejects_spoofed_content_type(self, client):
        token = await _token(client, "video-spoof@test.com")
        r = await client.post(
            "/upload/video",
            files={"file": ("evil.mp4", b"%PDF-1.4" + b"\x00" * 64, "video/mp4")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 415

    @pytest.mark.asyncio
    async def test_rejects_audio_sent_to_video_endpoint(self, client):
        token = await _token(client, "video-aud@test.com")
        r = await client.post(
            "/upload/video",
            files={"file": ("a.ogg", OGG, "audio/ogg")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 415
