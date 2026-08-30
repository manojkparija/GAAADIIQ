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

#: The subset of the above that Whisper was actually trained on. Odia is not
#: among them, and naming it is not a degraded result but a hard refusal of the
#: whole request, measured on Render:
#:
#:   400 {"error":{"message":"Language 'or' is not supported.",
#:        "code":"unsupported_language"}}
#:
#: So an unsupported language is sent with no `language` field at all, letting
#: Whisper detect it. Detection is less accurate than being told, but it
#: transcribes; the alternative is that Odia speakers get nothing. The offered
#: language list is not narrowed — the UI still records in Odia, and the
#: browser path (which does support it) is unaffected.
_WHISPER_LANGUAGES = {"en", "hi", "bn", "ta", "te", "kn", "ml", "mr", "gu", "pa"}


#: Container extension per mime, for the multipart filename. OpenAI reads the
#: format from the extension; anything not listed here falls back to .webm,
#: which is what every Android WebView MediaRecorder produces.
_EXTENSIONS = {
    "audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mpeg": ".mp3",
    "audio/mp4": ".mp4", "audio/wav": ".wav", "audio/x-wav": ".wav",
    "audio/aac": ".m4a", "audio/3gpp": ".mp4",
}


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
    data: dict[str, str] = {"model": settings.stt_model}
    iso = _ISO_639_1.get(language, "en")
    if iso in _WHISPER_LANGUAGES:
        data["language"] = iso

    async with httpx.AsyncClient(timeout=settings.stt_timeout_seconds) as client:
        resp = await client.post(
            f"{base.rstrip('/')}/audio/transcriptions",
            headers=headers, files=files, data=data,
        )
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
    return text, None  # Whisper does not return a usable confidence


async def _transcribe_google(audio: bytes, language: str) -> tuple[str, float | None]:
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

    locale = language if language in _AZURE_LOCALES else "en-IN"
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
