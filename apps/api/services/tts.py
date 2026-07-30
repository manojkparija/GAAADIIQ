"""
Optional server-side text-to-speech (BR-API-02).

The browser's speechSynthesis is the default and is sufficient on most
platforms. This exists for the cases where it is not: Android WebViews with no
Indian-language voices installed, where a report in Hindi would otherwise be
read aloud by an English voice or not at all.

Disabled unless TTS_PROVIDER is set. The client treats a 503 as "use
speechSynthesis", so the fallback path is the normal path.
"""
from __future__ import annotations

import base64
import logging

import httpx

from core.config import settings

logger = logging.getLogger("gaadiiq.tts")


class TTSError(RuntimeError):
    """Raised when synthesis fails."""


class TTSUnavailable(TTSError):
    """Raised when no provider is configured."""


# Voice names per provider. Indian-language coverage differs between vendors;
# an unmapped language falls back to the vendor's default for that locale.
_GOOGLE_VOICES = {
    "en-IN": "en-IN-Wavenet-A", "hi-IN": "hi-IN-Wavenet-A",
    "bn-IN": "bn-IN-Wavenet-A", "ta-IN": "ta-IN-Wavenet-A",
    "te-IN": "te-IN-Standard-A", "kn-IN": "kn-IN-Wavenet-A",
    "ml-IN": "ml-IN-Wavenet-A", "mr-IN": "mr-IN-Wavenet-A",
    "gu-IN": "gu-IN-Wavenet-A", "pa-IN": "pa-IN-Wavenet-A",
}

_AZURE_VOICES = {
    "en-IN": "en-IN-NeerjaNeural", "hi-IN": "hi-IN-SwaraNeural",
    "bn-IN": "bn-IN-TanishaaNeural", "ta-IN": "ta-IN-PallaviNeural",
    "te-IN": "te-IN-ShrutiNeural", "kn-IN": "kn-IN-SapnaNeural",
    "ml-IN": "ml-IN-SobhanaNeural", "mr-IN": "mr-IN-AarohiNeural",
    "gu-IN": "gu-IN-DhwaniNeural", "pa-IN": "pa-IN-OjasNeural",
}


def tts_enabled() -> bool:
    return (settings.tts_provider or "none").lower() != "none"


def _escape_ssml(text: str) -> str:
    """Escape XML metacharacters so report text cannot break the SSML document."""
    return (
        text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&apos;")
    )


async def synthesize(text: str, language: str = "en-IN") -> dict:
    """
    Synthesize `text`, returning {audio_base64, content_type, provider, voice}.

    Raises TTSUnavailable when no provider is configured, TTSError on failure.
    """
    provider = (settings.tts_provider or "none").lower()
    if provider == "none":
        raise TTSUnavailable("Server-side speech synthesis is not configured.")

    text = (text or "").strip()
    if not text:
        raise TTSError("Nothing to speak.")
    if len(text) > settings.tts_max_chars:
        text = text[: settings.tts_max_chars]

    try:
        if provider == "google":
            audio_b64, voice = await _google(text, language)
            content_type = "audio/mpeg"
        elif provider == "azure":
            audio_b64, voice = await _azure(text, language)
            content_type = "audio/mpeg"
        else:
            raise TTSUnavailable(f"Unknown TTS provider: {provider}")
    except (TTSError, TTSUnavailable):
        raise
    except httpx.TimeoutException as exc:
        raise TTSError("Speech synthesis timed out.") from exc
    except Exception as exc:
        logger.warning("TTS provider %s failed: %s", provider, exc)
        raise TTSError("Speech synthesis failed.") from exc

    return {
        "audio_base64": audio_b64,
        "content_type": content_type,
        "provider": provider,
        "voice": voice,
        "language": language,
    }


async def _google(text: str, language: str) -> tuple[str, str]:
    if not settings.tts_api_key:
        raise TTSUnavailable("Google TTS requires TTS_API_KEY.")

    voice = _GOOGLE_VOICES.get(language, "")
    url = settings.tts_api_url or "https://texttospeech.googleapis.com/v1/text:synthesize"
    voice_cfg: dict = {"languageCode": language}
    if voice:
        voice_cfg["name"] = voice

    payload = {
        "input": {"text": text},
        "voice": voice_cfg,
        # Slightly slow — this is safety guidance, often heard while driving.
        "audioConfig": {"audioEncoding": "MP3", "speakingRate": 0.92},
    }

    async with httpx.AsyncClient(timeout=settings.tts_timeout_seconds) as client:
        resp = await client.post(url, params={"key": settings.tts_api_key}, json=payload)
        resp.raise_for_status()
        body = resp.json()

    audio = body.get("audioContent")
    if not audio:
        raise TTSError("No audio returned.")
    return audio, voice or language


async def _azure(text: str, language: str) -> tuple[str, str]:
    if not settings.tts_api_key or not settings.tts_api_url:
        raise TTSUnavailable("Azure TTS requires TTS_API_KEY and TTS_API_URL.")

    voice = _AZURE_VOICES.get(language, _AZURE_VOICES["en-IN"])
    ssml = (
        f"<speak version='1.0' xml:lang='{language}'>"
        f"<voice xml:lang='{language}' name='{voice}'>"
        f"<prosody rate='-8%'>{_escape_ssml(text)}</prosody>"
        f"</voice></speak>"
    )
    headers = {
        "Ocp-Apim-Subscription-Key": settings.tts_api_key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-16khz-32kbitrate-mono-mp3",
    }

    async with httpx.AsyncClient(timeout=settings.tts_timeout_seconds) as client:
        resp = await client.post(settings.tts_api_url, headers=headers, content=ssml.encode())
        resp.raise_for_status()
        audio_bytes = resp.content

    if not audio_bytes:
        raise TTSError("No audio returned.")
    return base64.b64encode(audio_bytes).decode("ascii"), voice
