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
from services.stt import STTError, _bare_mime, transcribe

WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 64


@pytest.fixture
def openai_provider(monkeypatch):
    monkeypatch.setattr(settings, "stt_provider", "openai")
    monkeypatch.setattr(settings, "stt_api_key", "sk-test")
    monkeypatch.setattr(settings, "stt_api_url", "")
    yield


def _rejecting_then_ok_client(reject_code="unsupported_language"):
    """First call refuses the language; the second succeeds without it."""
    bad = MagicMock()
    bad.status_code = 400
    bad.text = '{"error":{"code":"%s"}}' % reject_code
    bad.json = MagicMock(return_value={"error": {"code": reject_code}})
    bad.raise_for_status = MagicMock()

    good = MagicMock()
    good.status_code = 200
    good.text = ""
    good.json = MagicMock(return_value={"text": "আমার গাড়িতে শব্দ হচ্ছে"})
    good.raise_for_status = MagicMock()

    post = AsyncMock(side_effect=[bad, good])
    cm = AsyncMock()
    cm.__aenter__.return_value.post = post
    cm.__aexit__.return_value = False
    return cm, post


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
    async def test_odia_is_offered_then_dropped_when_refused(self, openai_provider):
        """
        This used to assert Odia was never named, from a hand-written list of
        what Whisper supports. That list was the bug -- it also claimed Bengali,
        which OpenAI refuses. The provider is now asked and its answer believed,
        so Odia is offered once and dropped when refused.
        """
        from services import stt
        stt._REFUSED_LANGUAGES.clear()

        cm, post = _rejecting_then_ok_client()
        with patch("httpx.AsyncClient", return_value=cm):
            await transcribe(WEBM, "audio/webm", "or-IN")

        assert post.call_args_list[0].kwargs["data"]["language"] == "or"
        assert "language" not in post.call_args_list[1].kwargs["data"]

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


class TestAutoDetectedLanguageSuite:
    """
    Bengali was never recognised, and neither was any other Indian language,
    whenever the driver chose "detect my language" on Android.

    The conversation's first pass named the language as en-IN, because that is
    what the language signal holds before anything has been detected. Whisper
    obeys a language it is given: told English, it TRANSLITERATES Bengali or
    Tamil speech into Latin script rather than refusing. The client then decides
    the language by looking for Indian codepoints in the transcript
    (detectLanguageFromText), finds none, and concludes English. Auto-detect
    could not escape English no matter what was said into it.

    Nothing failed anywhere. The transcript came back, the conversation
    continued, and the language was simply always wrong.

    So the detecting pass asks for no language at all and lets Whisper identify
    it, which returns the driver's own script and lets the existing detection
    work as designed.
    """

    @pytest.mark.asyncio
    async def test_auto_sends_no_language_at_all(self, openai_provider):
        cm, post = _capturing_client()
        with patch("httpx.AsyncClient", return_value=cm):
            await transcribe(WEBM, "audio/webm", "auto")

        assert "language" not in post.call_args.kwargs["data"], (
            "naming a language makes Whisper transliterate instead of detect"
        )

    @pytest.mark.asyncio
    async def test_auto_returns_the_script_the_speaker_used(self, openai_provider):
        # The whole point: Bengali audio comes back as Bengali characters, so
        # the client's script check can identify it.
        cm, _ = _capturing_client({"text": "আমার গাড়িতে শব্দ হচ্ছে"})
        with patch("httpx.AsyncClient", return_value=cm):
            r = await transcribe(WEBM, "audio/webm", "auto")

        assert r["text"] == "আমার গাড়িতে শব্দ হচ্ছে"

    @pytest.mark.asyncio
    async def test_bengali_named_explicitly_is_still_named(self, openai_provider):
        # Once the language IS known, telling Whisper is more accurate than
        # making it guess again. bn is a language Whisper has.
        cm, post = _capturing_client()
        with patch("httpx.AsyncClient", return_value=cm):
            await transcribe(WEBM, "audio/webm", "bn-IN")

        assert post.call_args.kwargs["data"]["language"] == "bn"

    @pytest.mark.asyncio
    async def test_auto_is_not_mistaken_for_an_unknown_locale(self, openai_provider):
        # "auto" must not fall through the unknown-locale branch to English --
        # that is exactly the bug, reintroduced by a different route.
        cm, post = _capturing_client()
        with patch("httpx.AsyncClient", return_value=cm):
            await transcribe(WEBM, "audio/webm", "auto")

        assert post.call_args.kwargs["data"].get("language") != "en"


class TestRefusedLanguageIsLearnedSuite:
    """
    Bengali speech input never worked, and the app blamed the driver for it.

    Measured on Render, with bn-IN chosen from the picker:

        400 {"error":{"message":"Language 'bn' is not supported.",
             "code":"unsupported_language"}}
        POST /diagnosis/stt HTTP/1.1" 422 Unprocessable Entity

    which the app renders as "No speech was recognised. Please speak clearly
    and try again." The audio was never examined; the provider refused the
    language before listening.

    The cause was a hand-written list of languages Whisper "supports", written
    from assumption rather than from the vendor. It contained "bn". A guessed
    list cannot stay right -- the set belongs to the provider and can change --
    and every wrong entry silently costs one language its voice input.

    So the provider is asked, and its refusal is believed: the clip goes again
    with no language named, and detection takes over. The refusal is remembered
    so the extra round trip is paid once per language per process.
    """

    def setup_method(self):
        from services import stt
        stt._REFUSED_LANGUAGES.clear()

    @pytest.mark.asyncio
    async def test_a_refused_language_is_retried_without_one(self, openai_provider):
        cm, post = _rejecting_then_ok_client()
        with patch("httpx.AsyncClient", return_value=cm):
            r = await transcribe(WEBM, "audio/webm", "bn-IN")

        assert post.call_count == 2, "the refusal must be retried, not surfaced"
        assert "language" not in post.call_args_list[1].kwargs["data"]
        assert r["text"] == "আমার গাড়িতে শব্দ হচ্ছে"

    @pytest.mark.asyncio
    async def test_the_first_attempt_still_names_the_language(self, openai_provider):
        # Being told is more accurate when the provider accepts it, so the
        # naming is not abandoned -- only recovered from.
        cm, post = _rejecting_then_ok_client()
        with patch("httpx.AsyncClient", return_value=cm):
            await transcribe(WEBM, "audio/webm", "bn-IN")

        assert post.call_args_list[0].kwargs["data"]["language"] == "bn"

    @pytest.mark.asyncio
    async def test_a_refusal_is_remembered(self, openai_provider):
        # Otherwise every Bengali utterance pays two round trips for ever.
        cm, _ = _rejecting_then_ok_client()
        with patch("httpx.AsyncClient", return_value=cm):
            await transcribe(WEBM, "audio/webm", "bn-IN")

        cm2, post2 = _capturing_client({"text": "আবার"})
        with patch("httpx.AsyncClient", return_value=cm2):
            await transcribe(WEBM, "audio/webm", "bn-IN")

        assert post2.call_count == 1
        assert "language" not in post2.call_args.kwargs["data"]

    @pytest.mark.asyncio
    async def test_an_unreadable_file_is_not_retried(self, openai_provider):
        # A 400 that is not about the language means the audio itself was
        # rejected. Sending it again without a language just fails twice.
        cm, post = _rejecting_then_ok_client(reject_code="invalid_file_format")
        with patch("httpx.AsyncClient", return_value=cm):
            with pytest.raises(STTError):
                await transcribe(WEBM, "audio/webm", "bn-IN")

        assert post.call_count == 1

    @pytest.mark.asyncio
    async def test_an_accepted_language_costs_one_call(self, openai_provider):
        # Hindi is accepted, so nothing about this path gets slower.
        cm, post = _capturing_client({"text": "ठीक है"})
        with patch("httpx.AsyncClient", return_value=cm):
            await transcribe(WEBM, "audio/webm", "hi-IN")

        assert post.call_count == 1
        assert post.call_args.kwargs["data"]["language"] == "hi"
