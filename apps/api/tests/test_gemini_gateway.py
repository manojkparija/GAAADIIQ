"""
Tests for the single Gemini choke point.

The first test here is the reason the module exists. Every Gemini call used to
put the API key in the URL, where it leaks into exception messages and access
logs without anything having to go wrong. That is not a property you can eyeball
once and trust afterwards, because the next person to add a call site will copy
whatever the last one did — so it is asserted.
"""
import base64

import httpx
import pytest

from services import gemini_gateway


class _Response:
    """Minimal httpx.Response stand-in."""

    def __init__(self, payload: dict, status_code: int = 200, headers: dict | None = None):
        self._payload = payload
        self.status_code = status_code
        self.headers = headers or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                f"{self.status_code}", request=None, response=None
            )

    def json(self):
        return self._payload


def _client_returning(*responses, captured: dict | None = None):
    """An httpx.AsyncClient factory yielding the given responses in order."""
    queue = list(responses)

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, json=None, headers=None, **kwargs):
            if captured is not None:
                captured["url"] = url
                captured["headers"] = headers or {}
                captured["payload"] = json or {}
            return queue.pop(0) if len(queue) > 1 else queue[0]

    return lambda **kw: FakeClient()


def _ok(text: str = '{"ok": true}') -> _Response:
    return _Response({"candidates": [{"content": {"parts": [{"text": text}]}}]})


@pytest.mark.asyncio
async def test_api_key_travels_in_a_header_and_never_in_the_url(monkeypatch):
    """
    The whole point of the gateway.

    A key in the URL ends up in httpx error messages, stack traces and proxy
    access logs. This asserts the request URL is safe to log verbatim.
    """
    monkeypatch.setattr(gemini_gateway.settings, "gemini_api_key", "SECRET-KEY-123")
    captured: dict = {}
    monkeypatch.setattr(
        gemini_gateway.httpx, "AsyncClient", _client_returning(_ok(), captured=captured)
    )

    await gemini_gateway.generate_text("hello", caller="test")

    assert "SECRET-KEY-123" not in captured["url"]
    assert "key=" not in captured["url"]
    assert captured["headers"]["x-goog-api-key"] == "SECRET-KEY-123"


@pytest.mark.asyncio
async def test_missing_key_raises_rather_than_calling_out(monkeypatch):
    monkeypatch.setattr(gemini_gateway.settings, "gemini_api_key", "")

    def explode(**kw):  # pragma: no cover — must never be reached
        raise AssertionError("attempted an HTTP call with no key configured")

    monkeypatch.setattr(gemini_gateway.httpx, "AsyncClient", explode)

    with pytest.raises(gemini_gateway.GeminiUnavailable):
        await gemini_gateway.generate_text("hello", caller="test")


@pytest.mark.asyncio
async def test_every_text_part_is_returned_not_just_the_first(monkeypatch):
    """
    A long answer arrives split across parts.

    services/pdf_ingest.py previously read parts[0] only, which truncates a
    brochure's spec dump at whatever boundary Gemini happened to pick — and
    produces a short answer that looks complete.
    """
    monkeypatch.setattr(gemini_gateway.settings, "gemini_api_key", "k")
    split = _Response(
        {"candidates": [{"content": {"parts": [{"text": "one "}, {"text": "two"}]}}]}
    )
    monkeypatch.setattr(gemini_gateway.httpx, "AsyncClient", _client_returning(split))

    assert await gemini_gateway.generate_text("p", caller="test") == "one two"


@pytest.mark.asyncio
async def test_empty_text_raises_rather_than_returning_blank(monkeypatch):
    """An empty answer that looks successful is how a blank spec sheet gets stored."""
    monkeypatch.setattr(gemini_gateway.settings, "gemini_api_key", "k")
    blank = _Response({"candidates": [{"content": {"parts": [{"text": "  "}]}}]})
    monkeypatch.setattr(gemini_gateway.httpx, "AsyncClient", _client_returning(blank))

    with pytest.raises(gemini_gateway.GeminiEmptyResponse):
        await gemini_gateway.generate_text("p", caller="test")


@pytest.mark.asyncio
async def test_a_blocked_prompt_says_so(monkeypatch):
    """"No candidates" alone sends an operator hunting for a network fault."""
    monkeypatch.setattr(gemini_gateway.settings, "gemini_api_key", "k")
    blocked = _Response({"candidates": [], "promptFeedback": {"blockReason": "SAFETY"}})
    monkeypatch.setattr(gemini_gateway.httpx, "AsyncClient", _client_returning(blocked))

    with pytest.raises(gemini_gateway.GeminiEmptyResponse, match="SAFETY"):
        await gemini_gateway.generate_text("p", caller="test")


@pytest.mark.asyncio
async def test_a_429_is_retried_then_surfaces_as_rate_limited(monkeypatch):
    """
    Throttling needs its own type.

    An invalid key will not fix itself; a rate limit will. Reporting them alike
    sends an operator to recheck a key that was correct all along.
    """
    monkeypatch.setattr(gemini_gateway.settings, "gemini_api_key", "k")
    monkeypatch.setattr(gemini_gateway.asyncio, "sleep", _no_sleep)
    throttled = _Response({}, status_code=429, headers={"retry-after": "1"})
    monkeypatch.setattr(
        gemini_gateway.httpx, "AsyncClient", _client_returning(throttled, throttled)
    )

    with pytest.raises(gemini_gateway.RateLimited):
        await gemini_gateway.generate_text("p", caller="test")


@pytest.mark.asyncio
async def test_a_429_that_clears_returns_the_answer(monkeypatch):
    monkeypatch.setattr(gemini_gateway.settings, "gemini_api_key", "k")
    monkeypatch.setattr(gemini_gateway.asyncio, "sleep", _no_sleep)
    throttled = _Response({}, status_code=429)
    monkeypatch.setattr(
        gemini_gateway.httpx,
        "AsyncClient",
        _client_returning(throttled, _ok("recovered")),
    )

    assert await gemini_gateway.generate_text("p", caller="test") == "recovered"


@pytest.mark.asyncio
async def test_images_are_sent_as_inline_base64_alongside_the_prompt(monkeypatch):
    """
    Brochure pages are frequently artwork with no text layer.

    The prompt must stay the prompt: base64 belongs in inline_data, not smuggled
    into the text part.
    """
    monkeypatch.setattr(gemini_gateway.settings, "gemini_api_key", "k")
    captured: dict = {}
    monkeypatch.setattr(
        gemini_gateway.httpx, "AsyncClient", _client_returning(_ok(), captured=captured)
    )

    await gemini_gateway.generate_text(
        "read this", caller="test", images=[b"\x89PNG-one", b"\x89PNG-two"]
    )

    parts = captured["payload"]["contents"][0]["parts"]
    assert parts[0] == {"text": "read this"}
    assert [p["inline_data"]["data"] for p in parts[1:]] == [
        base64.b64encode(b"\x89PNG-one").decode("ascii"),
        base64.b64encode(b"\x89PNG-two").decode("ascii"),
    ]


@pytest.mark.asyncio
async def test_json_response_is_opt_out(monkeypatch):
    """
    The brochure path asks for prose and parses it itself.

    Sending responseMimeType=application/json on that path would change what
    the model returns, so it has to be switchable rather than always on.
    """
    monkeypatch.setattr(gemini_gateway.settings, "gemini_api_key", "k")
    captured: dict = {}
    monkeypatch.setattr(
        gemini_gateway.httpx, "AsyncClient", _client_returning(_ok(), captured=captured)
    )

    await gemini_gateway.generate_text("p", caller="test", json_response=False)
    assert "responseMimeType" not in captured["payload"]["generationConfig"]

    await gemini_gateway.generate_text("p", caller="test", json_response=True)
    assert captured["payload"]["generationConfig"]["responseMimeType"] == "application/json"


async def _no_sleep(_seconds):
    """Retry backoff, minus the waiting."""
    return None
