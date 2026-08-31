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
from services.stt import _ALTERNATE_MODELS, STTError, _bare_mime, transcribe

WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 64


@pytest.fixture
def openai_provider(monkeypatch):
    monkeypatch.setattr(settings, "stt_provider", "openai")
    monkeypatch.setattr(settings, "stt_api_key", "sk-test")
    monkeypatch.setattr(settings, "stt_api_url", "")
    # Pinned, not inherited: STT_MODEL is an environment variable, and which
    # model is answering decides which languages are accepted. Leaving it to
    # the default would make these tests pass or fail on Render's config.
    monkeypatch.setattr(settings, "stt_model", "whisper-1")
    yield


@pytest.fixture
def gpt4o_provider(openai_provider, monkeypatch):
    """The narrow-coverage model Render is free to be configured with."""
    monkeypatch.setattr(settings, "stt_model", "gpt-4o-transcribe")
    yield


#: How many models a refused language is offered to before detection: the
#: configured one plus every alternate. A test that wants to reach detection
#: has to exhaust all of them.
ALL_MODELS = 1 + len([m for m in _ALTERNATE_MODELS if m != "whisper-1"])


def _rejecting_then_ok_client(reject_code="unsupported_language", rejections=1):
    """`rejections` calls refuse the language; the next one succeeds."""
    def _bad():
        bad = MagicMock()
        bad.status_code = 400
        bad.text = '{"error":{"code":"%s"}}' % reject_code
        bad.json = MagicMock(return_value={"error": {"code": reject_code}})
        bad.raise_for_status = MagicMock()
        return bad

    good = MagicMock()
    good.status_code = 200
    good.text = ""
    good.json = MagicMock(return_value={"text": "আমার গাড়িতে শব্দ হচ্ছে"})
    good.raise_for_status = MagicMock()

    post = AsyncMock(side_effect=[_bad() for _ in range(rejections)] + [good])
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
        stt._REFUSED.clear()

        cm, post = _rejecting_then_ok_client(rejections=ALL_MODELS)
        with patch("httpx.AsyncClient", return_value=cm):
            await transcribe(WEBM, "audio/webm", "or-IN")

        assert post.call_args_list[0].kwargs["data"]["language"] == "or"
        assert "language" not in post.call_args_list[-1].kwargs["data"]

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
        stt._REFUSED.clear()

    @pytest.mark.asyncio
    async def test_a_refused_language_is_retried_without_one(self, openai_provider):
        cm, post = _rejecting_then_ok_client(rejections=ALL_MODELS)
        with patch("httpx.AsyncClient", return_value=cm):
            r = await transcribe(WEBM, "audio/webm", "bn-IN")

        assert post.call_count == ALL_MODELS + 1, "the refusal must be retried"
        assert "language" not in post.call_args_list[-1].kwargs["data"]
        assert r["text"] == "আমার গাড়িতে শব্দ হচ্ছে"

    @pytest.mark.asyncio
    async def test_the_first_attempt_still_names_the_language(self, openai_provider):
        # Being told is more accurate when the provider accepts it, so the
        # naming is not abandoned -- only recovered from.
        cm, post = _rejecting_then_ok_client(rejections=ALL_MODELS)
        with patch("httpx.AsyncClient", return_value=cm):
            await transcribe(WEBM, "audio/webm", "bn-IN")

        assert post.call_args_list[0].kwargs["data"]["language"] == "bn"

    @pytest.mark.asyncio
    async def test_a_refusal_is_remembered(self, openai_provider):
        # Otherwise every Bengali utterance pays two round trips for ever.
        cm, _ = _rejecting_then_ok_client(rejections=ALL_MODELS)
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


class TestARefusedLanguageTriesAnotherModelSuite:
    """
    Bengali speech came back as TELUGU.

    Reported after the refusal-learning fix shipped, and visible in the same
    Render log that showed the fix working:

        POST .../audio/transcriptions "HTTP/1.1 400 Bad Request"
        [gaadiiq.stt] STT provider openai does not accept 'bn';
                      retrying with detection
        POST .../audio/transcriptions "HTTP/1.1 200 OK"

    The retry succeeded, so nothing looked wrong anywhere -- and the transcript
    was in the wrong language. Dropping the language hands the choice to
    Whisper's detector, which has no "not sure" answer: a few seconds of
    Bengali is confidently returned as Telugu, Assamese or Hindi, all
    neighbours in its embedding space. A wrong language reported as success is
    worse than the 422 it replaced, because the conversation then continues in
    it.

    The missed cause was that the refusal is not a property of the language.
    whisper-1 accepts Bengali; the gpt-4o transcribe models take a much shorter
    list. STT_MODEL is an environment variable, so which model answers is not
    visible from the code -- the ALLOWED_ORIGINS trap again.

    So a refused language now asks a WIDER MODEL before it stops naming a
    language at all.
    """

    def setup_method(self):
        from services import stt
        stt._REFUSED.clear()

    @pytest.mark.asyncio
    async def test_a_refused_language_is_retried_on_a_wider_model(self, gpt4o_provider):
        # The fix. The language survives the retry; only the model changes.
        cm, post = _rejecting_then_ok_client()
        with patch("httpx.AsyncClient", return_value=cm):
            r = await transcribe(WEBM, "audio/webm", "bn-IN")

        first, second = post.call_args_list
        assert first.kwargs["data"]["model"] == "gpt-4o-transcribe"
        assert second.kwargs["data"]["model"] == "whisper-1"
        assert second.kwargs["data"]["language"] == "bn", (
            "dropping the language here is what returned Telugu"
        )
        assert r["text"] == "আমার গাড়িতে শব্দ হচ্ছে"

    @pytest.mark.asyncio
    async def test_detection_is_not_reached_while_a_model_will_take_it(
        self, gpt4o_provider
    ):
        cm, post = _rejecting_then_ok_client()
        with patch("httpx.AsyncClient", return_value=cm):
            await transcribe(WEBM, "audio/webm", "bn-IN")

        assert post.call_count == 2
        assert all("language" in c.kwargs["data"] for c in post.call_args_list)

    @pytest.mark.asyncio
    async def test_the_narrow_model_is_not_asked_again_for_that_language(
        self, gpt4o_provider
    ):
        # The refusal is remembered per (model, language), so Bengali goes
        # straight to whisper-1 on the next utterance -- one call, not two.
        cm, _ = _rejecting_then_ok_client()
        with patch("httpx.AsyncClient", return_value=cm):
            await transcribe(WEBM, "audio/webm", "bn-IN")

        cm2, post2 = _capturing_client({"text": "আবার"})
        with patch("httpx.AsyncClient", return_value=cm2):
            await transcribe(WEBM, "audio/webm", "bn-IN")

        assert post2.call_count == 1
        assert post2.call_args.kwargs["data"]["model"] == "whisper-1"
        assert post2.call_args.kwargs["data"]["language"] == "bn"

    @pytest.mark.asyncio
    async def test_other_languages_still_use_the_configured_model(self, gpt4o_provider):
        # Only the refused pair moves. Hindi must not lose the faster model
        # because Bengali needed the slower one.
        from services import stt
        stt._REFUSED.add(("gpt-4o-transcribe", "bn"))

        cm, post = _capturing_client({"text": "ठीक है"})
        with patch("httpx.AsyncClient", return_value=cm):
            await transcribe(WEBM, "audio/webm", "hi-IN")

        assert post.call_args.kwargs["data"]["model"] == "gpt-4o-transcribe"

    @pytest.mark.asyncio
    async def test_detection_remains_the_last_resort(self, openai_provider):
        # Odia: whisper-1 IS the wide model and it has no Odia, so there is no
        # other model to ask and detection is all that is left. Still better
        # than telling the driver their speech was unclear.
        cm, post = _rejecting_then_ok_client(rejections=ALL_MODELS)
        with patch("httpx.AsyncClient", return_value=cm):
            await transcribe(WEBM, "audio/webm", "or-IN")

        assert post.call_count == ALL_MODELS + 1
        assert post.call_args_list[0].kwargs["data"]["language"] == "or"
        assert "language" not in post.call_args_list[-1].kwargs["data"]

    @pytest.mark.asyncio
    async def test_an_unreadable_file_never_reaches_the_model_retry(self, gpt4o_provider):
        # A 400 about the container is not about the language. Retrying it on
        # another model just fails twice and doubles the latency of a failure.
        cm, post = _rejecting_then_ok_client(reject_code="invalid_file_format")
        with patch("httpx.AsyncClient", return_value=cm):
            with pytest.raises(STTError):
                await transcribe(WEBM, "audio/webm", "bn-IN")

        assert post.call_count == 1

    @pytest.mark.asyncio
    async def test_auto_detect_is_untouched_by_any_of_this(self, gpt4o_provider):
        # "detect my language" names no language, so there is nothing to refuse
        # and nothing to retry.
        cm, post = _capturing_client()
        with patch("httpx.AsyncClient", return_value=cm):
            await transcribe(WEBM, "audio/webm", "auto")

        assert post.call_count == 1
        assert "language" not in post.call_args.kwargs["data"]


class TestDetectedLanguageIsCheckedSuite:
    """
    Bengali speech was transcribed as Telugu and reported as a success.

    When no model will take the language, the clip goes up with none named and
    Whisper detects. Its detector has no "not sure" answer: given a few seconds
    of Bengali it returns Telugu, in Telugu script, with no error anywhere. The
    conversation then continued in Telugu.

    The detector cannot be made right from here. It can be checked: the
    detection request asks for verbose_json, which names the language it chose,
    and a transcript in a language the driver did not ask for is refused rather
    than passed off as theirs. A name we do not recognise is treated as unknown,
    not as a mismatch -- guessing in the other direction is the same error.
    """

    def setup_method(self):
        from services import stt
        stt._REFUSED.clear()

    @staticmethod
    def _detecting_client(detected: str, text: str = "నా కారు"):
        def _bad():
            bad = MagicMock()
            bad.status_code = 400
            bad.text = ""
            bad.json = MagicMock(return_value={"error": {"code": "unsupported_language"}})
            bad.raise_for_status = MagicMock()
            return bad

        good = MagicMock()
        good.status_code = 200
        good.text = ""
        good.json = MagicMock(return_value={"text": text, "language": detected})
        good.raise_for_status = MagicMock()

        post = AsyncMock(side_effect=[_bad() for _ in range(ALL_MODELS)] + [good])
        cm = AsyncMock()
        cm.__aenter__.return_value.post = post
        cm.__aexit__.return_value = False
        return cm, post

    @pytest.mark.asyncio
    async def test_the_detection_request_asks_which_language_it_chose(
        self, openai_provider
    ):
        cm, post = self._detecting_client("bengali")
        with patch("httpx.AsyncClient", return_value=cm):
            await transcribe(WEBM, "audio/webm", "bn-IN")

        assert post.call_args_list[-1].kwargs["data"]["response_format"] == "verbose_json"

    @pytest.mark.asyncio
    async def test_telugu_for_a_bengali_request_is_refused(self, openai_provider):
        # The reported bug, in one assertion.
        cm, _ = self._detecting_client("telugu")
        with patch("httpx.AsyncClient", return_value=cm):
            with pytest.raises(STTError) as exc:
                await transcribe(WEBM, "audio/webm", "bn-IN")

        assert "Telugu" in str(exc.value), "the driver is told what it heard"

    @pytest.mark.asyncio
    async def test_the_message_does_not_blame_the_speaker(self, openai_provider):
        # "Please speak clearly" for a language the provider cannot take is the
        # failure this whole area keeps repeating.
        cm, _ = self._detecting_client("telugu")
        with patch("httpx.AsyncClient", return_value=cm):
            with pytest.raises(STTError) as exc:
                await transcribe(WEBM, "audio/webm", "bn-IN")

        assert "clearly" not in str(exc.value).lower()

    @pytest.mark.asyncio
    async def test_a_correct_detection_is_kept(self, openai_provider):
        # Detection is not always wrong. When it agrees, the transcript stands.
        cm, _ = self._detecting_client("bengali", text="আমার গাড়িতে শব্দ হচ্ছে")
        with patch("httpx.AsyncClient", return_value=cm):
            r = await transcribe(WEBM, "audio/webm", "bn-IN")

        assert r["text"] == "আমার গাড়িতে শব্দ হচ্ছে"

    @pytest.mark.asyncio
    async def test_an_unrecognised_name_is_not_treated_as_a_mismatch(
        self, openai_provider
    ):
        # Whisper knows languages we do not list. Not knowing is not evidence.
        cm, _ = self._detecting_client("assamese", text="কিবা এটা")
        with patch("httpx.AsyncClient", return_value=cm):
            r = await transcribe(WEBM, "audio/webm", "bn-IN")

        assert r["text"] == "কিবা এটা"

    @pytest.mark.asyncio
    async def test_a_model_that_accepts_the_language_is_never_second_guessed(
        self, openai_provider
    ):
        # No detection happened, so there is nothing to check and no
        # verbose_json to ask for.
        cm, post = _capturing_client({"text": "ठीक है"})
        with patch("httpx.AsyncClient", return_value=cm):
            await transcribe(WEBM, "audio/webm", "hi-IN")

        assert "response_format" not in post.call_args.kwargs["data"]

    @pytest.mark.asyncio
    async def test_auto_detect_is_never_refused(self, openai_provider):
        # "Detect my language" means whatever it detects IS the answer. There
        # is nothing to compare it against.
        cm, post = _capturing_client({"text": "আমার গাড়িতে শব্দ হচ্ছে"})
        with patch("httpx.AsyncClient", return_value=cm):
            r = await transcribe(WEBM, "audio/webm", "auto")

        assert r["text"] == "আমার গাড়িতে শব্দ হচ্ছে"
        assert "response_format" not in post.call_args.kwargs["data"]


class TestTheModelRenderActuallyRunsSuite:
    """
    STT_MODEL is unset on Render, so the whisper-1 default is what answers --
    and whisper-1 is the model that refused Bengali.

    The first version of the model retry fell back to "the widest-coverage
    model", hardcoded to whisper-1 because the gpt-4o models are documented
    with a shorter language list. On this deployment that fallback was a no-op:
    it retried onto the model it was already using. The guess was not wrong
    about the documentation, it was wrong about which model was in play, which
    is exactly what an environment variable hides.

    So no model is designated the wide one. A refusal is offered to the others
    and whichever accepts it is used.
    """

    def setup_method(self):
        from services import stt
        stt._REFUSED.clear()

    @pytest.mark.asyncio
    async def test_the_default_is_still_whisper_1(self):
        # If this changes, the reasoning above stops describing production.
        from core.config import Settings

        assert Settings.model_fields["stt_model"].default == "whisper-1"

    @pytest.mark.asyncio
    async def test_whisper_refusing_bengali_reaches_another_model(self, openai_provider):
        # The case on Render today, which the previous fix could not help.
        cm, post = _rejecting_then_ok_client(rejections=1)
        with patch("httpx.AsyncClient", return_value=cm):
            r = await transcribe(WEBM, "audio/webm", "bn-IN")

        first, second = post.call_args_list
        assert first.kwargs["data"]["model"] == "whisper-1"
        assert second.kwargs["data"]["model"] != "whisper-1", (
            "falling back to the model already in use cannot do anything"
        )
        assert second.kwargs["data"]["language"] == "bn"
        assert r["text"] == "আমার গাড়িতে শব্দ হচ্ছে"

    @pytest.mark.asyncio
    async def test_no_model_is_assumed_to_be_the_widest(self, openai_provider):
        # Every alternate is offered before detection is reached. Which vendor
        # model covers which language is not ours to predict.
        cm, post = _rejecting_then_ok_client(rejections=ALL_MODELS)
        with patch("httpx.AsyncClient", return_value=cm):
            await transcribe(WEBM, "audio/webm", "bn-IN")

        tried = [c.kwargs["data"]["model"] for c in post.call_args_list[:ALL_MODELS]]
        assert len(set(tried)) == ALL_MODELS, "each model is asked once, not repeated"

    @pytest.mark.asyncio
    async def test_the_extra_round_trips_are_paid_once(self, openai_provider):
        # Otherwise every Bengali utterance walks the whole model list again.
        cm, _ = _rejecting_then_ok_client(rejections=1)
        with patch("httpx.AsyncClient", return_value=cm):
            await transcribe(WEBM, "audio/webm", "bn-IN")

        cm2, post2 = _capturing_client({"text": "আবার"})
        with patch("httpx.AsyncClient", return_value=cm2):
            await transcribe(WEBM, "audio/webm", "bn-IN")

        assert post2.call_count == 1
        assert post2.call_args.kwargs["data"]["language"] == "bn", (
            "the language survives -- that is the whole point over detection"
        )


class TestARefusalWearingADifferentCodeSuite:
    """
    Odia worked, then stopped working, and the regression was mine.

    Measured on Render after the model-retry shipped:

        [gaadiiq.stt] STT model whisper-1 does not accept 'or'
        POST .../audio/transcriptions "HTTP/1.1 400 Bad Request"
        {"error":{"message":"Language code 'or' is not recognized...",
                  "param":"language","code":"invalid_value"}}
        [gaadiiq.stt] STT provider openai failed: Client error '400 Bad Request'
        "POST /diagnosis/stt HTTP/1.1" 422 Unprocessable Entity

    whisper-1 refuses Odia as "unsupported_language", so the retry correctly
    moved on. The next model refuses the SAME language as "invalid_value", and
    the check only knew the first code — so the second refusal was read as a
    broken request rather than a refused language, the fallback to detection
    never ran, and Odia returned 422 for a language that had worked the day
    before.

    Enumerating vendor error codes is the same guess as the hand-written
    language allow-list that started all of this. The API names the parameter
    it rejected; that is what gets believed.
    """

    def setup_method(self):
        from services import stt
        stt._REFUSED.clear()

    @staticmethod
    def _client(*bodies):
        """One response per body; a 200 body ends the sequence."""
        responses = []
        for body in bodies:
            r = MagicMock()
            r.status_code = 200 if "text" in body else 400
            r.text = ""
            r.json = MagicMock(return_value=body)
            r.raise_for_status = MagicMock()
            responses.append(r)
        post = AsyncMock(side_effect=responses)
        cm = AsyncMock()
        cm.__aenter__.return_value.post = post
        cm.__aexit__.return_value = False
        return cm, post

    UNSUPPORTED = {"error": {"code": "unsupported_language"}}
    INVALID_VALUE = {
        "error": {
            "message": "Language code 'or' is not recognized.",
            "param": "language",
            "code": "invalid_value",
        }
    }
    OK = {"text": "ମୋ ଗାଡ଼ିରୁ ଶବ୍ଦ ଆସୁଛି", "language": "odia"}

    @pytest.mark.asyncio
    async def test_invalid_value_on_the_language_is_a_refusal(self, openai_provider):
        # The regression, in one assertion: the second model's refusal must be
        # recognised so the run continues instead of 422-ing.
        from services.stt import _is_unsupported_language

        resp = MagicMock()
        resp.status_code = 400
        resp.json = MagicMock(return_value=self.INVALID_VALUE)

        assert _is_unsupported_language(resp) is True

    @pytest.mark.asyncio
    async def test_odia_still_reaches_detection_and_transcribes(self, openai_provider):
        # End to end: every model refuses, in two different dialects of "no",
        # and the clip is still transcribed by detection.
        cm, post = self._client(
            self.UNSUPPORTED,      # whisper-1
            self.INVALID_VALUE,    # gpt-4o-transcribe
            self.INVALID_VALUE,    # gpt-4o-mini-transcribe
            self.OK,               # detection, no language named
        )
        with patch("httpx.AsyncClient", return_value=cm):
            r = await transcribe(WEBM, "audio/webm", "or-IN")

        assert r["text"] == "ମୋ ଗାଡ଼ିରୁ ଶବ୍ଦ ଆସୁଛି"
        assert "language" not in post.call_args_list[-1].kwargs["data"]

    @pytest.mark.asyncio
    async def test_a_broken_container_is_still_not_retried(self, openai_provider):
        # The guard that keeps this from retrying everything: a 400 about the
        # FILE is not about the language, and asking another model just fails
        # again more slowly.
        cm, post = self._client(
            {"error": {"code": "invalid_value", "param": "file"}},
            self.OK,
        )
        with patch("httpx.AsyncClient", return_value=cm):
            with pytest.raises(STTError):
                await transcribe(WEBM, "audio/webm", "or-IN")

        assert post.call_count == 1

    @pytest.mark.asyncio
    async def test_a_400_with_no_error_body_is_not_a_language_refusal(self, openai_provider):
        from services.stt import _is_unsupported_language

        resp = MagicMock()
        resp.status_code = 400
        resp.json = MagicMock(return_value={})

        assert _is_unsupported_language(resp) is False

    @pytest.mark.asyncio
    async def test_a_non_400_is_never_a_language_refusal(self, openai_provider):
        # A 500 or a 429 says nothing about the language and must not consume
        # a model from the candidate list.
        from services.stt import _is_unsupported_language

        resp = MagicMock()
        resp.status_code = 500
        resp.json = MagicMock(return_value={"error": {"param": "language"}})

        assert _is_unsupported_language(resp) is False

    @pytest.mark.asyncio
    async def test_bengali_is_unaffected(self, openai_provider):
        # The language this whole sequence was fixed for must keep working.
        cm, post = self._client(
            self.UNSUPPORTED,
            {"text": "আমার গাড়িতে শব্দ হচ্ছে"},
        )
        with patch("httpx.AsyncClient", return_value=cm):
            r = await transcribe(WEBM, "audio/webm", "bn-IN")

        assert r["text"] == "আমার গাড়িতে শব্দ হচ্ছে"
        assert post.call_args_list[-1].kwargs["data"]["language"] == "bn", (
            "the second model accepted it, so the language is still named"
        )
