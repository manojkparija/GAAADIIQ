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

    files = {"file": ("audio", audio, content_type or "application/octet-stream")}
    data = {"model": settings.stt_model, "language": _ISO_639_1.get(language, "en")}

    async with httpx.AsyncClient(timeout=settings.stt_timeout_seconds) as client:
        resp = await client.post(
            f"{base.rstrip('/')}/audio/transcriptions",
            headers=headers, files=files, data=data,
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
