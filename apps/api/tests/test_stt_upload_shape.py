"""
The clip we send OpenAI is shaped the way OpenAI reads it.

Measured from Render, after the CORS fault was cleared and the account had
credit:

    INFO  [httpx] POST https://api.openai.com/v1/audio/transcriptions
          "HTTP/1.1 400 Bad Request"
    WARNING [gaadiiq.stt] STT provider openai failed: Client error '400 ...'
    INFO  "POST /diagnosis/stt HTTP/1.1" 422 Unprocessable Entity

The upload named the part "audio", with no extension. OpenAI decides the
container from the FILENAME, not from the part's Content-Type, and rejects
anything it cannot name — so a perfectly good WebM clip was refused before a
single sample was decoded.

The second half of that log line is the part worth keeping in mind: every
provider error becomes STTError, which the router answers with 422, which the
app renders as "No speech was recognised. Please speak clearly and try again."
A vendor rejection was therefore reported to the user as their own diction.
These tests pin the request shape; the status mapping is a separate matter.
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from core.config import settings
from services.stt import _bare_mime, transcribe

WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 64


@pytest.fixture
def openai_provider(monkeypatch):
    monkeypatch.setattr(settings, "stt_provider", "openai")
    monkeypatch.setattr(settings, "stt_api_key", "sk-test")
    monkeypatch.setattr(settings, "stt_api_url", "")
    yield


def _capturing_client(json_body=None):
    """A mocked httpx client that records the kwargs it was posted."""
    resp = MagicMock()
    resp.status_code = 200
    resp.text = ""
    resp.json = MagicMock(return_value=json_body or {"text": "engine is knocking"})
    resp.raise_for_status = MagicMock()

    post = AsyncMock(return_value=resp)
    cm = AsyncMock()
    cm.__aenter__.return_value.post = post
    cm.__aexit__.return_value = False
    return cm, post


async def _sent(content_type: str):
    cm, post = _capturing_client()
    with patch("httpx.AsyncClient", return_value=cm):
        await transcribe(WEBM, content_type, "en-IN")
    return post.call_args.kwargs


class TestUploadFilenameSuite:
    @pytest.mark.asyncio
    async def test_the_clip_is_named_with_an_extension(self, openai_provider):
        # The reported 400. "audio" alone is what OpenAI refuses.
        filename = (await _sent("audio/webm"))["files"]["file"][0]

        assert filename == "audio.webm", (
            "OpenAI reads the container from the filename; a bare name is a 400."
        )

    @pytest.mark.asyncio
    async def test_a_codec_parameter_does_not_leak_into_the_name(self, openai_provider):
        # What Android's MediaRecorder actually reports.
        sent = await _sent("audio/webm;codecs=opus")

        assert sent["files"]["file"][0] == "audio.webm"
        assert sent["files"]["file"][2] == "audio/webm", "the parameter must be dropped"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "content_type,expected",
        [
            ("audio/mp4", "audio.mp4"),
            ("audio/wav", "audio.wav"),
            ("audio/ogg;codecs=opus", "audio.ogg"),
            ("audio/aac", "audio.m4a"),
            ("audio/mpeg", "audio.mp3"),
        ],
    )
    async def test_each_accepted_container_gets_its_own_extension(
        self, openai_provider, content_type, expected
    ):
        assert (await _sent(content_type))["files"]["file"][0] == expected

    @pytest.mark.asyncio
    async def test_an_unknown_type_still_gets_a_usable_name(self, openai_provider):
        # Better a wrong-but-decodable guess than the bare name that fails
        # outright; webm is what every Android WebView produces.
        assert (await _sent(""))["files"]["file"][0] == "audio.webm"

    @pytest.mark.asyncio
    async def test_the_audio_itself_is_unchanged(self, openai_provider):
        # Naming is all that changed here — the bytes must go up untouched.
        assert (await _sent("audio/webm"))["files"]["file"][1] == WEBM


class TestBareMimeSuite:
    def test_strips_parameters(self):
        assert _bare_mime("audio/webm;codecs=opus") == "audio/webm"

    def test_normalises_case_and_space(self):
        assert _bare_mime(" AUDIO/WEBM ; codecs=opus") == "audio/webm"

    def test_survives_an_empty_content_type(self):
        assert _bare_mime("") == ""


class TestUnsupportedLanguageSuite:
    """
    Odia. Measured on Render:

        400 {"error":{"message":"Language 'or' is not supported.",
             "type":"invalid_request_error","param":"language",
             "code":"unsupported_language"}}

    Naming a language Whisper does not have is not a worse transcription, it is
    a refusal of the whole request -- so the field is omitted and Whisper
    detects instead. The language list the UI offers is unchanged.
    """

    @pytest.mark.asyncio
    async def test_odia_is_sent_without_a_language_field(self, openai_provider):
        cm, post = _capturing_client()
        with patch("httpx.AsyncClient", return_value=cm):
            await transcribe(WEBM, "audio/webm", "or-IN")

        assert "language" not in post.call_args.kwargs["data"], (
            "Whisper has no Odia model; naming it returns 400 for the whole request."
        )

    @pytest.mark.asyncio
    async def test_odia_still_transcribes(self, openai_provider):
        cm, _ = _capturing_client({"text": "ମୋ ଗାଡ଼ିରୁ ଶବ୍ଦ ଆସୁଛି"})
        with patch("httpx.AsyncClient", return_value=cm):
            r = await transcribe(WEBM, "audio/webm", "or-IN")

        assert r["text"] == "ମୋ ଗାଡ଼ିରୁ ଶବ୍ଦ ଆସୁଛି"
        assert r["language"] == "or-IN", "the caller's language is still reported back"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "locale,iso",
        [("hi-IN", "hi"), ("bn-IN", "bn"), ("ta-IN", "ta"), ("te-IN", "te"),
         ("kn-IN", "kn"), ("ml-IN", "ml"), ("mr-IN", "mr"), ("gu-IN", "gu"),
         ("pa-IN", "pa"), ("en-IN", "en")],
    )
    async def test_supported_languages_are_still_named(self, openai_provider, locale, iso):
        # Detection is worse than being told, so the ten that work must keep
        # sending the field. Dropping it for everything would be a regression
        # nobody would notice until accuracy fell.
        cm, post = _capturing_client()
        with patch("httpx.AsyncClient", return_value=cm):
            await transcribe(WEBM, "audio/webm", locale)

        assert post.call_args.kwargs["data"]["language"] == iso

    @pytest.mark.asyncio
    async def test_an_unknown_locale_falls_back_to_english(self, openai_provider):
        cm, post = _capturing_client()
        with patch("httpx.AsyncClient", return_value=cm):
            await transcribe(WEBM, "audio/webm", "xx-YY")

        assert post.call_args.kwargs["data"]["language"] == "en"
