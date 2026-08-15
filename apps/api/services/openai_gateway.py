"""
The single place this service talks to OpenAI.

WHY THIS EXISTS

Same reason as `services/gemini_gateway.py`, and deliberately the same shape:
one module owns the timeout, the 429 policy, the model choice, and the record
that a call happened. If you find yourself writing `httpx.post` against
api.openai.com somewhere else, that is the bug this module exists to prevent.

WHY OPENAI AT ALL, GIVEN GEMINI IS ALREADY HERE

The diagnosis ladder had a hole in it. Below the knowledge base the free tier
went to Ollama, and `OLLAMA_BASE_URL` is not set in any deployed environment —
so a free-tier user whose symptom missed the knowledge base fell all the way
through to `_heuristic_fallback`, which is a floor rather than a finding. Gemini
was reserved for the premium tier, so the capacity was there and unreachable.

GPT-4o now answers first for every tier, with Gemini behind it. Two providers
in series is not redundancy for its own sake: they fail independently. An
OpenAI outage, an exhausted quota or a single malformed response no longer ends
with a driver being told less than we know.

THE KEY

OpenAI authenticates with a bearer token in a header, so unlike the Gemini
migration there is no URL-versus-header decision to get wrong. The rule is the
same anyway: `str(request.url)` must stay safe to log.
"""

import asyncio
import base64
import logging

import httpx

from core.config import settings

# Reused rather than redefined. `RateLimited` is documented in gemini_gateway
# as meaning "a provider is metering us" — not "Gemini failed" — and
# routers/brochures.py already catches it without caring which provider was in
# play. A second, parallel class would quietly break those handlers.
from services.gemini_gateway import RateLimited

logger = logging.getLogger(__name__)

# Matches gemini_gateway: a burst is worth absorbing, but a caller is holding a
# request open while we wait, and a longer wait belongs to them.
_RETRY_ATTEMPTS = 3
_MAX_RETRY_WAIT = 20.0


class OpenAIError(RuntimeError):
    """Any failure to get a usable answer out of OpenAI."""


class OpenAIUnavailable(OpenAIError):
    """No API key is configured, so there is nothing to call."""


class OpenAIEmptyResponse(OpenAIError):
    """
    OpenAI answered, but with no text.

    Raised rather than returned as an empty string, for the same reason as the
    Gemini equivalent: an empty answer that looks like a successful one is how
    a caller ends up storing a blank diagnosis and treating it as an answer.
    """


def is_available() -> bool:
    """Whether an OpenAI call can be attempted at all."""
    return bool(settings.openai_api_key)


def _endpoint() -> str:
    return f"{settings.openai_api_url.rstrip('/')}/chat/completions"


async def _post_retrying_429(do_post, timeout: float, caller: str) -> httpx.Response:
    """
    Run `do_post(client)`, retrying a 429 and honouring Retry-After.

    Raises RateLimited once the attempts are spent, so a caller can report
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
            "OpenAI rate-limited on %s (attempt %d/%d), waiting %.1fs",
            caller, attempt, _RETRY_ATTEMPTS, wait,
        )
        await asyncio.sleep(wait)

    raise RateLimited(
        f"OpenAI rate limit not cleared after {_RETRY_ATTEMPTS} attempts"
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
    Send one prompt to GPT-4o and return its text.

    The signature matches `gemini_gateway.generate_text` deliberately, so a
    caller can try one and fall back to the other without adapting arguments.

    `caller` names the feature making the call — it goes in the logs, and it is
    the difference between "OpenAI is throttling us" and knowing which feature
    to turn off. It is required for that reason.

    `images` are PNG bytes sent alongside the prompt as data URLs, for the
    dashboard-light and damage photos the diagnosis flow accepts.

    Raises OpenAIUnavailable, RateLimited, OpenAIEmptyResponse, or whatever
    httpx raises for transport and status failures. Never returns "".
    """
    if not is_available():
        raise OpenAIUnavailable("OPENAI_API_KEY is not set")

    # A text-only turn stays a plain string. The multimodal array form is only
    # used when there are images, because the two are not interchangeable for
    # every model and the string form is the better-supported path.
    content: str | list[dict]
    if images:
        content = [{"type": "text", "text": prompt}]
        for png in images:
            encoded = base64.b64encode(png).decode("ascii")
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{encoded}"},
                }
            )
    else:
        content = prompt

    payload: dict = {
        "model": settings.openai_model,
        "messages": [{"role": "user", "content": content}],
        "temperature": temperature,
    }
    if json_response:
        # Guarantees syntactically valid JSON. It does NOT guarantee the shape
        # the caller wants, so callers still validate what they parse.
        payload["response_format"] = {"type": "json_object"}
    if max_output_tokens is not None:
        payload["max_tokens"] = max_output_tokens

    headers = {"Authorization": f"Bearer {settings.openai_api_key}"}
    url = _endpoint()

    async def post(client: httpx.AsyncClient) -> httpx.Response:
        return await client.post(url, json=payload, headers=headers)

    effective_timeout = timeout if timeout is not None else settings.openai_timeout_seconds
    resp = await _post_retrying_429(post, effective_timeout, caller)
    body = resp.json()

    choices = body.get("choices") or []
    if not choices:
        raise OpenAIEmptyResponse(f"OpenAI returned no choices for {caller}")

    message = choices[0].get("message") or {}
    text = (message.get("content") or "").strip()
    if not text:
        # A content filter returns a choice with empty content and a reason.
        # "no text" alone sends an operator looking for a network fault.
        reason = choices[0].get("finish_reason")
        raise OpenAIEmptyResponse(
            f"OpenAI returned empty text for {caller}"
            + (f" (finish_reason: {reason})" if reason else "")
        )
    return text
