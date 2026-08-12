"""
The single place this service talks to Gemini.

WHY THIS EXISTS

Before this module, five call sites across four services each built their own
Gemini request: services/diagnosis.py, services/pdf_ingest.py,
services/resale_forecast.py and two in services/variant_research.py. Every one
of them put the API key in the URL — four as `params={"key": ...}` and one
interpolated straight into the URL string.

A key in a URL is a key in your logs. Request URLs turn up in httpx exception
messages, in stack traces, and in any proxy or platform access log between here
and Google. Nothing had to go wrong for the key to be written down somewhere it
should not be. Gemini accepts `x-goog-api-key` as a header, which keeps the
secret out of the URL entirely, and that is what this module uses.

The scattering cost more than the key exposure, though. With five call sites
there was no single place to enforce a timeout, retry a 429, decide which model
answers, or record that a call happened at all — and it showed: only the
brochure path handled rate limits, so the other three surfaced Google
throttling as an unexplained failure.

Everything that reaches Gemini goes through `generate_text`. If you find
yourself writing `httpx.post` against generativelanguage.googleapis.com
somewhere else, that is the bug this module exists to prevent.
"""

import asyncio
import base64
import logging

import httpx

from core.config import settings

logger = logging.getLogger(__name__)

# Three attempts, backing off, capped. A brochure upload produced 429 against
# Google's free tier while the key and model were both fine, so a burst is
# worth absorbing — but a caller is holding a request open while we wait, and
# a longer wait belongs to them, not to a held connection.
_RETRY_ATTEMPTS = 3
_MAX_RETRY_WAIT = 20.0


class GeminiError(RuntimeError):
    """Any failure to get a usable answer out of Gemini."""


class RateLimited(RuntimeError):
    """
    A provider throttled us rather than failing.

    Worth its own type because it needs a different response from every other
    error: an invalid key or an unreachable host will not fix itself, but a
    rate limit clears on its own, and telling an operator to check their key
    when Google is simply metering them sends them to the wrong place.

    Deliberately not a GeminiError. services/pdf_ingest.py raises this same
    class when Groq throttles the vision fallback, so it has to mean "a
    provider is metering us" rather than "Gemini failed"; routers/brochures.py
    catches it without caring which provider was in play.
    """


class GeminiUnavailable(GeminiError):
    """No API key is configured, so there is nothing to call."""


class GeminiEmptyResponse(GeminiError):
    """
    Gemini answered, but with no text.

    Raised rather than returned as an empty string. An empty answer that looks
    like a successful one is how a caller ends up storing a blank spec sheet
    and treating it as researched.
    """


def is_available() -> bool:
    """Whether a Gemini call can be attempted at all."""
    return bool(settings.gemini_api_key)


def _endpoint() -> str:
    return (
        f"{settings.gemini_api_url.rstrip('/')}/models/"
        f"{settings.gemini_model}:generateContent"
    )


async def _post_retrying_429(do_post, timeout: float, caller: str) -> httpx.Response:
    """
    Run `do_post(client)`, retrying a 429 and honouring Retry-After.

    Raises RateLimited once the attempts are spent, so callers can report
    "throttled" rather than folding it in with unreachable hosts and bad keys.
    """
    last_retry_after = 0.0

    for attempt in range(1, _RETRY_ATTEMPTS + 1):
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await do_post(client)

            if resp.status_code != 429:
                resp.raise_for_status()
                return resp

            try:
                last_retry_after = float(resp.headers.get("retry-after", "") or 0)
            except ValueError:
                last_retry_after = 0.0
            wait = min(last_retry_after or 2.0**attempt, _MAX_RETRY_WAIT)

        if attempt == _RETRY_ATTEMPTS:
            break

        logger.info(
            "Gemini rate-limited on %s (attempt %d/%d), waiting %.1fs",
            caller, attempt, _RETRY_ATTEMPTS, wait,
        )
        await asyncio.sleep(wait)

    raise RateLimited(
        f"Gemini rate limit not cleared after {_RETRY_ATTEMPTS} attempts"
        + (f" (last Retry-After: {last_retry_after:.0f}s)" if last_retry_after else "")
    )


async def generate_text(
    prompt: str,
    *,
    caller: str,
    temperature: float = 0.0,
    json_response: bool = True,
    images: list[bytes] | None = None,
    max_output_tokens: int | None = None,
    timeout: float | None = None,
) -> str:
    """
    Send one prompt to Gemini and return its text.

    `caller` names the feature making the call — it goes in the logs, and it is
    the difference between "Gemini is throttling us" and knowing which feature
    to turn off. It is required for that reason.

    `images` are PNG bytes shown alongside the prompt, for the brochure pages
    that are artwork with no text layer.

    Raises GeminiUnavailable, RateLimited, GeminiEmptyResponse, or whatever
    httpx raises for transport and status failures. Never returns "".
    """
    if not is_available():
        raise GeminiUnavailable("GEMINI_API_KEY is not set")

    parts: list[dict] = [{"text": prompt}]
    for png in images or []:
        parts.append(
            {
                "inline_data": {
                    "mime_type": "image/png",
                    "data": base64.b64encode(png).decode("ascii"),
                }
            }
        )

    generation_config: dict = {"temperature": temperature}
    if json_response:
        generation_config["responseMimeType"] = "application/json"
    if max_output_tokens is not None:
        generation_config["maxOutputTokens"] = max_output_tokens

    payload = {"contents": [{"parts": parts}], "generationConfig": generation_config}

    # The key rides in a header, never in the URL or query string. This is the
    # whole point of the module: `str(request.url)` must stay safe to log.
    headers = {"x-goog-api-key": settings.gemini_api_key}
    url = _endpoint()

    async def post(client: httpx.AsyncClient) -> httpx.Response:
        return await client.post(url, json=payload, headers=headers)

    effective_timeout = timeout if timeout is not None else settings.gemini_timeout_seconds
    resp = await _post_retrying_429(post, effective_timeout, caller)
    body = resp.json()

    candidates = body.get("candidates") or []
    if not candidates:
        # A blocked prompt comes back as zero candidates with a reason, and
        # "no candidates" alone sends an operator looking for a network fault.
        reason = (body.get("promptFeedback") or {}).get("blockReason")
        raise GeminiEmptyResponse(
            f"Gemini returned no candidates for {caller}"
            + (f" (blocked: {reason})" if reason else "")
        )

    # Every part, not just the first: a long answer arrives split across parts,
    # and taking parts[0] silently truncates it at whatever boundary Gemini
    # happened to choose.
    answer_parts = (candidates[0].get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in answer_parts).strip()
    if not text:
        raise GeminiEmptyResponse(f"Gemini returned empty text for {caller}")
    return text
