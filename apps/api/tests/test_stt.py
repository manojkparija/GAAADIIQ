"""
Server-side STT service + endpoint tests (BR-API-01, BR-VA-01, BR-TEST-01).

Every provider is exercised through a mocked httpx seam — no network, no
vendor SDKs, no audio decoding.
"""
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.config import settings
from db.session import get_db
from main import app
from services.stt import (
    STTError,
    STTUnavailable,
    _postprocess,
    estimate_duration_seconds,
    stt_enabled,
    transcribe,
)


def _wav(payload_bytes: int = 64, byte_rate: int = 32000) -> bytes:
    """Build a WAV whose header yields a known duration."""
    header = bytearray(b"RIFF" + b"\x00" * 4 + b"WAVE" + b"\x00" * 32)
    header[28:32] = byte_rate.to_bytes(4, "little")
    return bytes(header[:44]) + b"\x00" * payload_bytes


WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 64


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


@pytest.fixture
def whisper_provider(monkeypatch):
    monkeypatch.setattr(settings, "stt_provider", "whisper")
    monkeypatch.setattr(settings, "stt_api_key", "test-key")
    monkeypatch.setattr(settings, "stt_api_url", "https://stt.test/v1")
    yield


def _mock_http(json_body: dict, status_code: int = 200):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json = MagicMock(return_value=json_body)
    resp.raise_for_status = MagicMock()

    cm = AsyncMock()
    cm.__aenter__.return_value.post = AsyncMock(return_value=resp)
    cm.__aexit__.return_value = False
    return cm


class TestSttEnabledSuite:
    def test_disabled_by_default(self, monkeypatch):
        monkeypatch.setattr(settings, "stt_provider", "none")
        assert stt_enabled() is False

    def test_enabled_when_provider_set(self, monkeypatch):
        monkeypatch.setattr(settings, "stt_provider", "whisper")
        assert stt_enabled() is True


class TestDurationEstimateSuite:
    def test_measures_wav_duration(self):
        # 32000 bytes/sec, 64000 bytes of payload → 2s
        assert estimate_duration_seconds(_wav(64000), "audio/wav") == pytest.approx(2.0)

    def test_returns_none_for_compressed_formats(self):
        # Unknown rather than "within limit" — callers must not treat it as 0.
        assert estimate_duration_seconds(WEBM, "audio/webm") is None

    def test_returns_none_for_truncated_wav(self):
        assert estimate_duration_seconds(b"RIFF", "audio/wav") is None


class TestPostprocessSuite:
    def test_collapses_whitespace(self):
        assert _postprocess("  the   engine \n knocks  ") == "the engine knocks"

    def test_strips_bracketed_annotations(self):
        assert "[MUSIC]" not in _postprocess("[MUSIC] the engine knocks")


class TestTranscribeSuite:
    @pytest.mark.asyncio
    async def test_raises_when_no_provider(self, monkeypatch):
        monkeypatch.setattr(settings, "stt_provider", "none")
        with pytest.raises(STTUnavailable):
            await transcribe(WEBM, "audio/webm")

    @pytest.mark.asyncio
    async def test_raises_on_empty_audio(self, whisper_provider):
        with pytest.raises(STTError):
            await transcribe(b"", "audio/webm")

    @pytest.mark.asyncio
    async def test_whisper_returns_text(self, whisper_provider):
        with patch("httpx.AsyncClient", return_value=_mock_http({"text": "engine is knocking"})):
            r = await transcribe(WEBM, "audio/webm", "en-IN")
        assert r["text"] == "engine is knocking"
        assert r["provider"] == "whisper"
        assert r["language"] == "en-IN"

    @pytest.mark.asyncio
    async def test_whisper_empty_text_is_an_error(self, whisper_provider):
        with patch("httpx.AsyncClient", return_value=_mock_http({"text": ""})):
            with pytest.raises(STTError):
                await transcribe(WEBM, "audio/webm")

    @pytest.mark.asyncio
    async def test_transcribes_hindi(self, whisper_provider):
        with patch("httpx.AsyncClient", return_value=_mock_http({"text": "मेरी गाड़ी में आवाज आ रही है"})):
            r = await transcribe(WEBM, "audio/webm", "hi-IN")
        assert r["text"] == "मेरी गाड़ी में आवाज आ रही है"
        assert r["language"] == "hi-IN"

    @pytest.mark.asyncio
    async def test_google_returns_text_and_confidence(self, monkeypatch):
        monkeypatch.setattr(settings, "stt_provider", "google")
        monkeypatch.setattr(settings, "stt_api_key", "g-key")
        monkeypatch.setattr(settings, "stt_api_url", "")
        body = {"results": [{"alternatives": [{"transcript": "brake squeal", "confidence": 0.93}]}]}
        with patch("httpx.AsyncClient", return_value=_mock_http(body)):
            r = await transcribe(WEBM, "audio/webm", "en-IN")
        assert r["text"] == "brake squeal"
        assert r["confidence"] == pytest.approx(0.93)

    @pytest.mark.asyncio
    async def test_google_no_results_is_an_error(self, monkeypatch):
        monkeypatch.setattr(settings, "stt_provider", "google")
        monkeypatch.setattr(settings, "stt_api_key", "g-key")
        with patch("httpx.AsyncClient", return_value=_mock_http({"results": []})):
            with pytest.raises(STTError):
                await transcribe(WEBM, "audio/webm")

    @pytest.mark.asyncio
    async def test_google_requires_api_key(self, monkeypatch):
        monkeypatch.setattr(settings, "stt_provider", "google")
        monkeypatch.setattr(settings, "stt_api_key", "")
        with pytest.raises(STTUnavailable):
            await transcribe(WEBM, "audio/webm")

    @pytest.mark.asyncio
    async def test_azure_returns_display_text(self, monkeypatch):
        monkeypatch.setattr(settings, "stt_provider", "azure")
        monkeypatch.setattr(settings, "stt_api_key", "a-key")
        monkeypatch.setattr(settings, "stt_api_url", "https://azure.test/stt")
        body = {"RecognitionStatus": "Success", "DisplayText": "rattling noise"}
        with patch("httpx.AsyncClient", return_value=_mock_http(body)):
            r = await transcribe(_wav(), "audio/wav", "en-IN")
        assert r["text"] == "rattling noise"

    @pytest.mark.asyncio
    async def test_unknown_provider_is_unavailable(self, monkeypatch):
        monkeypatch.setattr(settings, "stt_provider", "acme")
        with pytest.raises(STTUnavailable):
            await transcribe(WEBM, "audio/webm")

    @pytest.mark.asyncio
    async def test_timeout_surfaces_as_stt_error(self, whisper_provider):
        with patch("httpx.AsyncClient", side_effect=httpx.TimeoutException("timed out")):
            with pytest.raises(STTError):
                await transcribe(WEBM, "audio/webm")

    @pytest.mark.asyncio
    async def test_provider_exception_surfaces_as_stt_error(self, whisper_provider):
        with patch("httpx.AsyncClient", side_effect=Exception("boom")):
            with pytest.raises(STTError):
                await transcribe(WEBM, "audio/webm")


class TestSttEndpointSuite:
    @pytest.mark.asyncio
    async def test_returns_503_when_disabled(self, client, monkeypatch):
        monkeypatch.setattr(settings, "stt_provider", "none")
        r = await client.post(
            "/diagnosis/stt", files={"file": ("a.webm", WEBM, "audio/webm")}
        )
        assert r.status_code == 503

    @pytest.mark.asyncio
    async def test_transcribes_when_enabled(self, client, whisper_provider):
        with patch("httpx.AsyncClient", return_value=_mock_http({"text": "engine knocking"})):
            r = await client.post(
                "/diagnosis/stt",
                files={"file": ("a.webm", WEBM, "audio/webm")},
                data={"language": "en-IN"},
            )
        assert r.status_code == 200
        assert r.json()["text"] == "engine knocking"

    @pytest.mark.asyncio
    async def test_preserves_requested_language(self, client, whisper_provider):
        with patch("httpx.AsyncClient", return_value=_mock_http({"text": "आवाज आ रही है"})):
            r = await client.post(
                "/diagnosis/stt",
                files={"file": ("a.webm", WEBM, "audio/webm")},
                data={"language": "hi-IN"},
            )
        assert r.status_code == 200
        assert r.json()["language"] == "hi-IN"

    @pytest.mark.asyncio
    async def test_unknown_language_falls_back_to_english(self, client, whisper_provider):
        with patch("httpx.AsyncClient", return_value=_mock_http({"text": "hello"})):
            r = await client.post(
                "/diagnosis/stt",
                files={"file": ("a.webm", WEBM, "audio/webm")},
                data={"language": "xx-YY"},
            )
        assert r.status_code == 200
        assert r.json()["language"] == "en-IN"

    @pytest.mark.asyncio
    async def test_rejects_unsupported_content_type(self, client, whisper_provider):
        r = await client.post(
            "/diagnosis/stt", files={"file": ("a.exe", WEBM, "application/x-msdownload")}
        )
        assert r.status_code == 415

    @pytest.mark.asyncio
    async def test_rejects_empty_audio(self, client, whisper_provider):
        r = await client.post(
            "/diagnosis/stt", files={"file": ("a.webm", b"", "audio/webm")}
        )
        assert r.status_code == 400

    @pytest.mark.asyncio
    async def test_rejects_audio_over_duration_cap(self, client, whisper_provider, monkeypatch):
        monkeypatch.setattr(settings, "stt_max_audio_seconds", 60)
        # 32000 bytes/sec × 61s
        long_wav = _wav(payload_bytes=32000 * 61)
        r = await client.post(
            "/diagnosis/stt", files={"file": ("long.wav", long_wav, "audio/wav")}
        )
        assert r.status_code == 413

    @pytest.mark.asyncio
    async def test_accepts_audio_within_duration_cap(self, client, whisper_provider):
        short_wav = _wav(payload_bytes=32000 * 5)  # 5 seconds
        with patch("httpx.AsyncClient", return_value=_mock_http({"text": "short clip"})):
            r = await client.post(
                "/diagnosis/stt", files={"file": ("short.wav", short_wav, "audio/wav")}
            )
        assert r.status_code == 200

    @pytest.mark.asyncio
    async def test_provider_failure_returns_422(self, client, whisper_provider):
        with patch("httpx.AsyncClient", side_effect=Exception("provider down")):
            r = await client.post(
                "/diagnosis/stt", files={"file": ("a.webm", WEBM, "audio/webm")}
            )
        assert r.status_code == 422


# ── Server-side TTS (BR-API-02) ──────────────────────────────────────────────

class TestTtsSuite:
    """Optional by design — the browser's speechSynthesis is the default path."""

    @pytest.fixture
    def google_tts(self, monkeypatch):
        monkeypatch.setattr(settings, "tts_provider", "google")
        monkeypatch.setattr(settings, "tts_api_key", "g-key")
        monkeypatch.setattr(settings, "tts_api_url", "")
        yield

    def test_disabled_by_default(self, monkeypatch):
        from services.tts import tts_enabled
        monkeypatch.setattr(settings, "tts_provider", "none")
        assert tts_enabled() is False

    @pytest.mark.asyncio
    async def test_raises_when_no_provider(self, monkeypatch):
        from services.tts import TTSUnavailable, synthesize
        monkeypatch.setattr(settings, "tts_provider", "none")
        with pytest.raises(TTSUnavailable):
            await synthesize("hello")

    @pytest.mark.asyncio
    async def test_rejects_empty_text(self, google_tts):
        from services.tts import TTSError, synthesize
        with pytest.raises(TTSError):
            await synthesize("   ")

    @pytest.mark.asyncio
    async def test_google_returns_audio(self, google_tts):
        from services.tts import synthesize
        with patch("httpx.AsyncClient", return_value=_mock_http({"audioContent": "QUJD"})):
            r = await synthesize("Brake pads are worn", "hi-IN")
        assert r["audio_base64"] == "QUJD"
        assert r["provider"] == "google"
        assert r["language"] == "hi-IN"

    @pytest.mark.asyncio
    async def test_missing_audio_is_an_error(self, google_tts):
        from services.tts import TTSError, synthesize
        with patch("httpx.AsyncClient", return_value=_mock_http({})):
            with pytest.raises(TTSError):
                await synthesize("hello")

    @pytest.mark.asyncio
    async def test_google_requires_key(self, monkeypatch):
        from services.tts import TTSUnavailable, synthesize
        monkeypatch.setattr(settings, "tts_provider", "google")
        monkeypatch.setattr(settings, "tts_api_key", "")
        with pytest.raises(TTSUnavailable):
            await synthesize("hello")

    @pytest.mark.asyncio
    async def test_long_text_is_truncated_not_rejected(self, google_tts, monkeypatch):
        from services.tts import synthesize
        monkeypatch.setattr(settings, "tts_max_chars", 50)
        with patch("httpx.AsyncClient", return_value=_mock_http({"audioContent": "QUJD"})):
            r = await synthesize("x" * 500)
        assert r["audio_base64"] == "QUJD"

    def test_ssml_metacharacters_are_escaped(self):
        # Report text containing < or & must not break the SSML document.
        from services.tts import _escape_ssml
        out = _escape_ssml('brake & <clutch> "worn"')
        assert "&amp;" in out and "&lt;" in out and "&quot;" in out
        assert "<clutch>" not in out

    @pytest.mark.asyncio
    async def test_endpoint_returns_503_when_disabled(self, client, monkeypatch):
        monkeypatch.setattr(settings, "tts_provider", "none")
        r = await client.post("/diagnosis/tts", json={"text": "hello", "language": "en-IN"})
        assert r.status_code == 503

    @pytest.mark.asyncio
    async def test_endpoint_synthesizes_when_enabled(self, client, google_tts):
        with patch("httpx.AsyncClient", return_value=_mock_http({"audioContent": "QUJD"})):
            r = await client.post(
                "/diagnosis/tts", json={"text": "Brake pads worn", "language": "hi-IN"}
            )
        assert r.status_code == 200
        assert r.json()["audio_base64"] == "QUJD"

    @pytest.mark.asyncio
    async def test_endpoint_rejects_empty_text(self, client, google_tts):
        r = await client.post("/diagnosis/tts", json={"text": "", "language": "en-IN"})
        assert r.status_code == 422

    @pytest.mark.asyncio
    async def test_endpoint_falls_back_to_english_for_unknown_language(self, client, google_tts):
        with patch("httpx.AsyncClient", return_value=_mock_http({"audioContent": "QUJD"})):
            r = await client.post("/diagnosis/tts", json={"text": "hi", "language": "xx-YY"})
        assert r.json()["language"] == "en-IN"
