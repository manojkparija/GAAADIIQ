"""
OpenAI gateway, and the diagnosis ladder that now runs through it.

The ladder tests matter more than the transport ones. The reason GPT-4o was
added is that the free tier had no reachable model and fell through to the
heuristic; a test that only proves "GPT-4o can be called" would pass while that
hole was still open. What is pinned here is the *order*, and that each rung is
reached when the one above it fails.
"""

import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from core.config import settings
from services import openai_gateway
from services.diagnosis import run_diagnosis
from services.gemini_gateway import RateLimited


def _response(status_code: int = 200, body: dict | None = None, headers: dict | None = None):
    return httpx.Response(
        status_code,
        json=body if body is not None else {},
        headers=headers or {},
        request=httpx.Request("POST", "https://api.openai.com/v1/chat/completions"),
    )


def _completion(text: str, finish_reason: str = "stop") -> dict:
    return {"choices": [{"message": {"content": text}, "finish_reason": finish_reason}]}


class _Client:
    """Stand-in for httpx.AsyncClient that returns queued responses in order."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.requests: list[dict] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def post(self, url, **kwargs):
        self.requests.append({"url": url, **kwargs})
        return self._responses.pop(0)


def _patched_client(*responses):
    client = _Client(responses)
    return patch("httpx.AsyncClient", return_value=client), client


@pytest.fixture
def openai_key():
    original = settings.openai_api_key
    settings.openai_api_key = "sk-test"
    yield
    settings.openai_api_key = original


# ── Transport ────────────────────────────────────────────────────────────────

class TestOpenAIGatewaySuite:
    @pytest.mark.asyncio
    async def test_returns_the_message_text(self, openai_key):
        ctx, _ = _patched_client(_response(body=_completion('{"ok": true}')))
        with ctx:
            assert await openai_gateway.generate_text("hi", caller="test") == '{"ok": true}'

    @pytest.mark.asyncio
    async def test_the_key_never_appears_in_the_url(self, openai_key):
        # The whole reason a gateway module exists. A key in a URL is a key in
        # your logs — it turns up in httpx exception messages and proxy logs.
        ctx, client = _patched_client(_response(body=_completion("{}")))
        with ctx:
            await openai_gateway.generate_text("hi", caller="test")
        sent = client.requests[0]
        assert "sk-test" not in sent["url"]
        assert sent["headers"]["Authorization"] == "Bearer sk-test"

    @pytest.mark.asyncio
    async def test_raises_rather_than_returning_an_empty_answer(self, openai_key):
        # An empty answer that looks successful is how a blank diagnosis gets
        # stored and treated as a finding.
        ctx, _ = _patched_client(_response(body=_completion("   ", finish_reason="content_filter")))
        with ctx:
            with pytest.raises(openai_gateway.OpenAIEmptyResponse) as exc:
                await openai_gateway.generate_text("hi", caller="test")
        assert "content_filter" in str(exc.value)

    @pytest.mark.asyncio
    async def test_raises_when_no_choices_come_back(self, openai_key):
        ctx, _ = _patched_client(_response(body={"choices": []}))
        with ctx:
            with pytest.raises(openai_gateway.OpenAIEmptyResponse):
                await openai_gateway.generate_text("hi", caller="test")

    @pytest.mark.asyncio
    async def test_unavailable_without_a_key(self):
        original = settings.openai_api_key
        settings.openai_api_key = ""
        try:
            assert openai_gateway.is_available() is False
            with pytest.raises(openai_gateway.OpenAIUnavailable):
                await openai_gateway.generate_text("hi", caller="test")
        finally:
            settings.openai_api_key = original

    @pytest.mark.asyncio
    async def test_retries_a_429_then_succeeds(self, openai_key):
        ctx, client = _patched_client(
            _response(429, headers={"retry-after": "0"}),
            _response(body=_completion("{}")),
        )
        with ctx, patch("asyncio.sleep", new=AsyncMock()):
            assert await openai_gateway.generate_text("hi", caller="test") == "{}"
        assert len(client.requests) == 2

    @pytest.mark.asyncio
    async def test_raises_rate_limited_once_attempts_are_spent(self, openai_key):
        # RateLimited is deliberately distinct: an invalid key will not fix
        # itself, a rate limit will, and telling an operator to check their key
        # when OpenAI is simply metering them sends them to the wrong place.
        ctx, _ = _patched_client(*[_response(429, headers={"retry-after": "0"})] * 3)
        with ctx, patch("asyncio.sleep", new=AsyncMock()):
            with pytest.raises(RateLimited):
                await openai_gateway.generate_text("hi", caller="test")

    @pytest.mark.asyncio
    async def test_asks_for_json_and_sends_the_configured_model(self, openai_key):
        ctx, client = _patched_client(_response(body=_completion("{}")))
        with ctx:
            await openai_gateway.generate_text("hi", caller="test")
        payload = client.requests[0]["json"]
        assert payload["model"] == settings.openai_model
        assert payload["response_format"] == {"type": "json_object"}
        assert payload["messages"][0]["content"] == "hi"

    @pytest.mark.asyncio
    async def test_images_are_sent_as_data_urls(self, openai_key):
        ctx, client = _patched_client(_response(body=_completion("{}")))
        with ctx:
            await openai_gateway.generate_text("hi", caller="test", images=[b"\x89PNG"])
        content = client.requests[0]["json"]["messages"][0]["content"]
        assert content[0]["type"] == "text"
        assert content[1]["image_url"]["url"].startswith("data:image/png;base64,")


# ── The ladder ───────────────────────────────────────────────────────────────

_ANSWER = {
    "preliminary_diagnosis": "Worn brake pads",
    "possible_causes": [{"cause": "Pad wear", "confidence": 0.8}],
    "repair_complexity": "Moderate",
    "cost_min_inr": 3000,
    "cost_max_inr": 6000,
    "repair_time_estimate": "2 hours",
    "safe_to_drive": True,
    "risk_level": "Medium",
    "recommended_steps": ["Inspect pads"],
    "diy_fixes": [],
    "immediate_service_required": False,
    "preventive_maintenance": [],
    "analysis_confidence": 85,
}


async def _diagnose(model_tier: str = "premium"):
    return await run_diagnosis(
        model_tier=model_tier,
        manufacturer="Maruti Suzuki",
        model="Swift",
        variant=None,
        model_year=2019,
        fuel_type="Petrol",
        transmission="Manual",
        odometer_km=45000,
        problem_description="Squealing noise when I press the brake pedal",
        warning_lights=[],
        when_occurs=["braking"],
        severity="medium",
    )


class TestDiagnosisLadderOrderSuite:
    @pytest.mark.asyncio
    async def test_openai_answers_first_for_a_paid_caller(self):
        with patch("services.openai_gateway.generate_text", new=AsyncMock(return_value=json.dumps(_ANSWER))):
            with patch("services.gemini_gateway.generate_text", new=AsyncMock(side_effect=AssertionError("Gemini must not be called"))):
                result = await _diagnose("premium")
        assert result["engine"] == "openai"

    @pytest.mark.asyncio
    async def test_falls_back_to_gemini_when_openai_fails(self):
        with patch("services.openai_gateway.generate_text", new=AsyncMock(side_effect=RateLimited("429"))):
            with patch("services.gemini_gateway.generate_text", new=AsyncMock(return_value=json.dumps(_ANSWER))):
                result = await _diagnose()
        assert result["engine"] == "gemini"

    @pytest.mark.asyncio
    async def test_the_free_tier_gets_a_model_too(self):
        # The hole this work closed. The free tier used to go straight to
        # Ollama, whose host is unset in every deployed environment, so a
        # free-tier user who missed the knowledge base got the heuristic.
        #
        # It reaches Gemini, not GPT-4o: closing the hole should not also hand
        # away the paid tier's advantage, which is a pricing decision rather
        # than a bug fix.
        with patch("services.gemini_gateway.generate_text", new=AsyncMock(return_value=json.dumps(_ANSWER))):
            with patch("services.openai_gateway.generate_text", new=AsyncMock(side_effect=AssertionError("GPT-4o is the paid tier"))):
                result = await run_diagnosis(
                    manufacturer="Tata", model="Nexon", variant=None, model_year=2021,
                    fuel_type="Petrol", transmission="Manual", odometer_km=20000,
                    problem_description="Grinding noise from the front wheel when turning",
                    warning_lights=[], when_occurs=["turning"], severity="medium",
                    model_tier="free",
                )
        assert result["engine"] == "gemini"

    @pytest.mark.asyncio
    async def test_falls_all_the_way_to_the_heuristic_when_every_model_fails(self):
        with patch("services.openai_gateway.generate_text", new=AsyncMock(side_effect=Exception("down"))):
            with patch("services.gemini_gateway.generate_text", new=AsyncMock(side_effect=Exception("down"))):
                with patch("httpx.AsyncClient", side_effect=Exception("no ollama")):
                    result = await _diagnose()
        assert result["engine"] == "heuristic"
        # And it still answers. A degraded answer is not no answer.
        assert result["preliminary_diagnosis"]

    @pytest.mark.asyncio
    async def test_every_provider_failure_is_recorded_not_just_the_last(self):
        # Overwriting fallback_reason would erase why the hosted providers gave
        # way, which is the part worth knowing when the heuristic answers.
        with patch("services.openai_gateway.generate_text", new=AsyncMock(side_effect=RateLimited("429"))):
            with patch("services.gemini_gateway.generate_text", new=AsyncMock(side_effect=ValueError("bad json"))):
                with patch("httpx.AsyncClient", side_effect=Exception("no ollama")):
                    with patch("services.diagnosis.logger") as log:
                        await _diagnose()

        latency = [
            c for c in log.info.call_args_list
            if c.args and c.args[0] == "diagnosis_latency"
        ]
        reason = latency[-1].kwargs["extra"]["fallback_reason"]
        assert "openai:RateLimited" in reason
        assert "gemini:ValueError" in reason
