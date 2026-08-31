"""
Server-side speech-to-text (BR-API-01).

Fallback transcription for clients without a usable Web Speech API — Android
WebViews, Safari, and Firefox. The browser path stays primary where available;
this only runs when the client reports it cannot transcribe locally.

Provider is chosen with STT_PROVIDER. Every provider is reached over plain
HTTP through httpx, so tests mock a single seam rather than vendor SDKs.

    none    — disabled; the endpoint reports 503 (default)
    whisper — self-hosted Whisper / faster-whisper exposing an OpenAI-ish route
    openai  — OpenAI audio transcriptions
    google  — Google Cloud Speech-to-Text v1 (base64 JSON)
    azure   — Azure Cognitive Services short-audio REST
"""
from __future__ import annotations

import base64
import logging
import re

import httpx

from core.config import settings

logger = logging.getLogger("gaadiiq.stt")


class STTError(RuntimeError):
    """Raised when transcription cannot be completed."""


class STTUnavailable(STTError):
    """Raised when no provider is configured."""


# Map our BCP-47 UI codes to what each vendor expects.
_AZURE_LOCALES = {
    "en-IN", "hi-IN", "bn-IN", "ta-IN", "te-IN", "kn-IN",
    "ml-IN", "mr-IN", "gu-IN", "pa-IN",
}

# Whisper/OpenAI take an ISO-639-1 code, not a locale.
_ISO_639_1 = {
    "en-IN": "en", "hi-IN": "hi", "bn-IN": "bn", "ta-IN": "ta", "te-IN": "te",
    "kn-IN": "kn", "ml-IN": "ml", "mr-IN": "mr", "gu-IN": "gu", "pa-IN": "pa",
    "or-IN": "or",
}

#: Ask the provider to identify the language itself, rather than being told.
#:
#: The voice conversation offers "detect my language", and its first pass used
#: to be sent as English. Whisper obeys a language it is given: told "en", it
#: transliterates Bengali or Tamil speech into Latin script, so the script
#: detection that decides the language saw no Indian codepoints and answered
#: English every time. Auto-detect could never leave English on Android.
AUTO_LANGUAGE = "auto"

#: (model, language) pairs the provider has REFUSED, learned from its own
#: error rather than assumed.
#:
#: This was a hand-written allow-list of what Whisper "supports", keyed on the
#: language alone. Both parts were wrong.
#:
#: The list was wrong because it contained "bn" while the API answered
#:
#:   400 {"error":{"message":"Language 'bn' is not supported.",
#:        "code":"unsupported_language"}}
#:
#: The key was wrong because that refusal is not a property of the language.
#: It is a property of the MODEL: the gpt-4o transcribe models take a far
#: shorter language list than whisper-1, which does accept Bengali. STT_MODEL
#: is an environment variable, so which model is answering is not visible in
#: this file — see ALLOWED_ORIGINS in the backlog for the same trap.
#:
#: Remembering the pair is what lets the retry below try a DIFFERENT model
#: rather than giving up on the language.
_REFUSED: set[tuple[str, str]] = set()

#: What Whisper calls each of our languages in a verbose_json response. It
#: reports a detected language by its English NAME ("bengali"), not by its ISO
#: code, so the detection fallback below needs this to tell whether what came
#: back is what the driver asked for.
_WHISPER_LANGUAGE_NAMES = {
    "en": "english", "hi": "hindi", "bn": "bengali", "ta": "tamil",
    "te": "telugu", "kn": "kannada", "ml": "malayalam", "mr": "marathi",
    "gu": "gujarati", "pa": "punjabi", "or": "odia",
}

#: Other transcription models to offer a refused language to, in order.
#:
#: This was a single "widest-coverage model", set to whisper-1 because the
#: gpt-4o models are documented as taking a shorter language list. That was
#: another guess of the same kind as the allow-list before it, and Render
#: showed it wrong from the other side: STT_MODEL is unset there, so whisper-1
#: is ALREADY the model in use, and whisper-1 is what refused Bengali. A
#: fallback to the model you are on cannot do anything.
#:
#: Which model has the wider list for a given language is the vendor's to know,
#: not ours to assume. So a refusal simply asks the other models we have,
#: keeps whichever accepts it, and remembers the rest. Nothing here claims to
#: know the answer in advance.
_ALTERNATE_MODELS = ("whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe")


#: Container extension per mime, for the multipart filename. OpenAI reads the
#: format from the extension; anything not listed here falls back to .webm,
#: which is what every Android WebView MediaRecorder produces.
_EXTENSIONS = {
    "audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mpeg": ".mp3",
    "audio/mp4": ".mp4", "audio/wav": ".wav", "audio/x-wav": ".wav",
    "audio/aac": ".m4a", "audio/3gpp": ".mp4",
}


def _is_unsupported_language(resp: httpx.Response) -> bool:
    """
    Did the provider refuse the language itself, rather than the audio?

    Matched on what the API says was wrong, not on the status alone: a 400 can
    also mean an unreadable container, and retrying that on another model would
    just fail twice.

    Two signals, because ONE WAS NOT ENOUGH and Odia proved it. This used to
    match the error code "unsupported_language" only. whisper-1 refuses Odia
    that way, so the retry moved to the next model — which refuses the same
    language differently:

        400 {"error":{"message":"Language code 'or' is not recognized...",
             "param":"language","code":"invalid_value"}}

    That is the identical situation wearing a different code, and not
    recognising it meant the second refusal was treated as a broken request:
    the driver got 422 "No speech was recognised" for a language that had
    worked the day before. Enumerating vendor error codes is the same guess as
    the language allow-list this all started with, so `param` is trusted too —
    the API naming `language` as the offending parameter IS the answer,
    whatever it calls the code.
    """
    if resp.status_code != 400:
        return False
    try:
        error = resp.json().get("error", {}) or {}
    except Exception:
        return False
    return (
        error.get("code") == "unsupported_language"
        or error.get("param") == "language"
    )


def _bare_mime(content_type: str) -> str:
    """
    Drop codec parameters: "audio/webm;codecs=opus" → "audio/webm".

    MediaRecorder reports the codec it chose, and the vendors do not accept the
    parameterised form even where they accept the container.
    """
    return (content_type or "").split(";")[0].strip().lower()


def stt_enabled() -> bool:
    return (settings.stt_provider or "none").lower() != "none"


def estimate_duration_seconds(audio: bytes, content_type: str) -> float | None:
    """
    Best-effort duration for the BR-IR-04 60-second cap.

    Only WAV carries a reliably parseable duration without decoding, so this
    returns None for compressed formats rather than guessing. Callers must
    treat None as "unknown", not "within limit" — the byte-size cap is the
    backstop for formats we cannot measure here.
    """
    if content_type in ("audio/wav", "audio/x-wav") and len(audio) > 44:
        if audio[:4] == b"RIFF" and audio[8:12] == b"WAVE":
            try:
                byte_rate = int.from_bytes(audio[28:32], "little")
                if byte_rate > 0:
                    return len(audio[44:]) / byte_rate
            except Exception:  # pragma: no cover — malformed header
                return None
    return None


def _postprocess(text: str) -> str:
    """Collapse whitespace and drop bracketed annotations like [MUSIC]."""
    text = re.sub(r"\[[A-Z_ ]{2,}\]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


async def transcribe(audio: bytes, content_type: str, language: str = "en-IN") -> dict:
    """
    Transcribe `audio`, returning {text, language, provider, confidence}.

    Raises STTUnavailable when no provider is configured, STTError on failure.
    """
    provider = (settings.stt_provider or "none").lower()
    if provider == "none":
        raise STTUnavailable("Server-side speech recognition is not configured.")
    if not audio:
        raise STTError("Empty audio payload.")

    try:
        if provider in ("whisper", "openai"):
            text, confidence = await _transcribe_whisper(audio, content_type, language, provider)
        elif provider == "google":
            text, confidence = await _transcribe_google(audio, language)
        elif provider == "azure":
            text, confidence = await _transcribe_azure(audio, content_type, language)
        else:
            raise STTUnavailable(f"Unknown STT provider: {provider}")
    except (STTError, STTUnavailable):
        raise
    except httpx.TimeoutException as exc:
        raise STTError("Speech recognition timed out.") from exc
    except Exception as exc:
        logger.warning("STT provider %s failed: %s", provider, exc)
        raise STTError("Speech recognition failed.") from exc

    return {
        "text": _postprocess(text),
        "language": language,
        "provider": provider,
        "confidence": confidence,
    }


async def _transcribe_whisper(
    audio: bytes, content_type: str, language: str, provider: str
) -> tuple[str, float | None]:
    base = settings.stt_api_url or (
        "https://api.openai.com/v1" if provider == "openai" else "http://localhost:9000"
    )
    headers = {}
    if settings.stt_api_key:
        headers["Authorization"] = f"Bearer {settings.stt_api_key}"

    # The upload MUST carry a filename with a recognised extension. OpenAI
    # decides the container from the extension, not from the part's
    # Content-Type, and answers a bare "audio" with
    #
    #   400 Bad Request — Invalid file format. Supported formats: flac, m4a,
    #   mp3, mp4, mpeg, mpga, oga, ogg, wav, webm
    #
    # which reached the phone as "No speech was recognised", blaming the
    # speaker for a request that was never decodable.
    mime = _bare_mime(content_type)
    files = {
        "file": (f"audio{_EXTENSIONS.get(mime, '.webm')}", audio, mime or "application/octet-stream")
    }
    iso = "" if language == AUTO_LANGUAGE else _ISO_639_1.get(language, "en")

    detecting = False

    async def _post(model: str, language: str) -> httpx.Response:
        data: dict[str, str] = {"model": model}
        if language:
            data["language"] = language
        elif iso:
            # Detecting on behalf of a driver who DID name a language: ask for
            # the verbose form so the detected language comes back with the
            # text and can be checked against what they asked for. Not needed
            # when they chose "detect my language" — there is nothing to check
            # it against.
            data["response_format"] = "verbose_json"
        async with httpx.AsyncClient(timeout=settings.stt_timeout_seconds) as client:
            return await client.post(
                f"{base.rstrip('/')}/audio/transcriptions",
                headers=headers, files=files, data=data,
            )

    # Models worth asking for this language, in order: the configured one
    # first, then the wide-coverage one. A pair already refused is skipped
    # BEFORE the request, not merely recovered from after it — otherwise the
    # first Bengali utterance retries onto whisper-1 correctly and every one
    # after it goes back to the narrow model, loses the language, and lands in
    # detection again.
    candidates = [settings.stt_model]
    candidates += [m for m in _ALTERNATE_MODELS if m != settings.stt_model]
    attempts = [m for m in candidates if not iso or (m, iso) not in _REFUSED]

    for model in attempts:
        resp = await _post(model, iso)
        # A refused language is not a failed transcription — the audio was
        # never looked at — and the refusal belongs to the MODEL, not the
        # language. Any other 400 (an unreadable container, say) is about the
        # clip, and asking a second model would just fail twice.
        if not _is_unsupported_language(resp):
            break
        logger.info("STT model %s does not accept %r", model, iso)
        _REFUSED.add((model, iso))
    else:
        # No model will take it. Only now do we stop naming a language, and it
        # is a poor last resort: Whisper's detector has no "not sure" answer,
        # so a few seconds of Bengali came back confidently transcribed as
        # Telugu — the wrong language, reported as a success, with the rest of
        # the conversation then conducted in it. Still better than telling the
        # driver their own speech was unclear, which is what the alternative
        # sounds like to them.
        logger.warning(
            "No STT model accepts %r; falling back to detection, which may "
            "return the wrong language",
            iso,
        )
        detecting = True
        resp = await _post(candidates[0], "")

    if resp.status_code >= 400:
        # The vendor says why in the body; without it the log shows only
        # the status and every 400 looks alike.
        logger.warning(
            "STT provider %s rejected the upload: %s %s",
            provider, resp.status_code, resp.text[:500],
        )
    resp.raise_for_status()
    body = resp.json()

    text = body.get("text") or ""
    if not text:
        raise STTError("No speech detected in the recording.")

    # Bengali speech came back as Telugu. The detector had guessed a
    # neighbouring Indic language and transcribed confidently in it, so a wrong
    # language arrived as a successful transcription and the rest of the
    # conversation was conducted in it. Nothing anywhere reported a problem.
    #
    # We cannot make the detector right, but we can refuse to pass its answer
    # off as the driver's. Only a POSITIVE mismatch counts — a name we do not
    # recognise means we do not know, and guessing here would be the same
    # mistake in the other direction.
    if detecting:
        detected = str(body.get("language") or "").strip().lower()
        expected = _WHISPER_LANGUAGE_NAMES.get(iso)
        known = detected in _WHISPER_LANGUAGE_NAMES.values()
        if known and expected and detected != expected:
            logger.warning(
                "STT detected %s for a %s request; refusing the transcript",
                detected, iso,
            )
            raise STTError(
                f"Speech recognition is not available for this language on "
                f"this device — it heard {detected.title()}. Please type your "
                f"answer instead."
            )

    return text, None  # Whisper does not return a usable confidence


async def _transcribe_google(audio: bytes, language: str) -> tuple[str, float | None]:
    # Neither Google's nor Azure's short-audio call detects the language for
    # us in this shape, so "auto" falls back to the default locale there
    # rather than pretending. Whisper is the provider this feature relies on.
    if language == AUTO_LANGUAGE:
        language = "en-IN"
    if not settings.stt_api_key:
        raise STTUnavailable("Google STT requires STT_API_KEY.")

    url = settings.stt_api_url or "https://speech.googleapis.com/v1/speech:recognize"
    payload = {
        "config": {
            "languageCode": language,
            "enableAutomaticPunctuation": True,
            # Speech is the whole point here; bias the model accordingly.
            "model": "default",
        },
        "audio": {"content": base64.b64encode(audio).decode("ascii")},
    }

    async with httpx.AsyncClient(timeout=settings.stt_timeout_seconds) as client:
        resp = await client.post(url, params={"key": settings.stt_api_key}, json=payload)
        resp.raise_for_status()
        body = resp.json()

    results = body.get("results") or []
    if not results:
        raise STTError("No speech detected in the recording.")
    alt = (results[0].get("alternatives") or [{}])[0]
    text = alt.get("transcript") or ""
    if not text:
        raise STTError("No speech detected in the recording.")
    return text, alt.get("confidence")


async def _transcribe_azure(
    audio: bytes, content_type: str, language: str
) -> tuple[str, float | None]:
    if not settings.stt_api_key or not settings.stt_api_url:
        raise STTUnavailable("Azure STT requires STT_API_KEY and STT_API_URL.")

    locale = language if language in _AZURE_LOCALES else "en-IN"  # includes "auto"
    headers = {
        "Ocp-Apim-Subscription-Key": settings.stt_api_key,
        "Content-Type": content_type or "audio/wav",
        "Accept": "application/json",
    }

    async with httpx.AsyncClient(timeout=settings.stt_timeout_seconds) as client:
        resp = await client.post(
            settings.stt_api_url,
            params={"language": locale, "format": "detailed"},
            headers=headers, content=audio,
        )
        resp.raise_for_status()
        body = resp.json()

    if body.get("RecognitionStatus") not in (None, "Success"):
        raise STTError("No speech detected in the recording.")
    text = body.get("DisplayText") or ""
    if not text:
        best = (body.get("NBest") or [{}])[0]
        text = best.get("Display") or best.get("Lexical") or ""
        if not text:
            raise STTError("No speech detected in the recording.")
        return text, best.get("Confidence")
    return text, None
