"""
A switched-off shortcut must not read as a fact about the car.

Reported: "Draft trims with AI" did nothing, and the screen said

    Nothing new found. Trims already recorded are left alone.

research_variants returned [] for three different situations — no API key,
a failed call, and a model with nothing to add — and the screen reported all
three with that one sentence. Two of them are broken shortcuts, and calling
them "nothing found" tells the admin the car has no other trims, which is a
claim nobody checked.

The same shape has now appeared three times in this codebase: the listing
form's "Please try again", the review queue's "That decision could not be
saved", and this. In each, a failure was reported as an ordinary result.
"""
import pytest

from services import variant_research


class _Gateway:
    """Stands in for gemini_gateway, without a network."""

    def __init__(self, *, available=True, text=None, raises=None):
        self._available = available
        self._text = text
        self._raises = raises
        self.called = False

    def is_available(self):
        return self._available

    async def generate_text(self, *_args, **_kwargs):
        self.called = True
        if self._raises:
            raise self._raises
        return self._text


@pytest.fixture
def gateway(monkeypatch):
    def _install(**kwargs):
        gw = _Gateway(**kwargs)
        monkeypatch.setattr(variant_research, "gemini_gateway", gw)
        return gw
    return _install


@pytest.mark.asyncio
async def test_no_api_key_is_unavailable_not_empty(gateway):
    gw = gateway(available=False)

    out = await variant_research.research_variants_detailed("Maruti Suzuki", "e Vitara", 2026)

    assert out.unavailable is True
    assert out.ok is False
    assert out.drafts == []
    # The distinction that matters: nobody asked the model anything, so
    # nothing was learned about this car either way.
    assert gw.called is False


@pytest.mark.asyncio
async def test_a_failed_call_carries_the_providers_own_words(gateway):
    gateway(raises=RuntimeError("API key not valid. Please pass a valid API key."))

    out = await variant_research.research_variants_detailed("Maruti Suzuki", "e Vitara", 2026)

    assert out.unavailable is False
    assert out.ok is False
    # "API key not valid" and "quota exceeded" need different actions, so the
    # message is passed through rather than summarised as "research failed".
    assert "API key not valid" in out.error
    assert "RuntimeError" in out.error


@pytest.mark.asyncio
async def test_an_empty_answer_is_a_real_result(gateway):
    gateway(text='{"variants": []}')

    out = await variant_research.research_variants_detailed("Maruti Suzuki", "e Vitara", 2026)

    assert out.ok is True
    assert out.unavailable is False
    assert out.error is None
    assert out.drafts == []


@pytest.mark.asyncio
async def test_drafts_come_back_when_the_model_answers(gateway):
    # The shape _clean expects: an object with a "variants" list, not a bare
    # array. A bare array cleans to [] and would have made this test pass for
    # the wrong reason.
    gateway(text='{"variants": [{"name": "Delta", "ex_showroom_price": 1799000}]}')

    out = await variant_research.research_variants_detailed("Maruti Suzuki", "e Vitara", 2026)

    assert out.ok is True
    assert len(out.drafts) == 1
    assert out.drafts[0]["name"] == "Delta"
    assert out.drafts[0]["ex_showroom_price"] == 1799000


@pytest.mark.asyncio
async def test_malformed_json_is_a_failure_not_an_empty_result(gateway):
    # A model that answers with prose instead of JSON has failed at the task.
    # Reported as "nothing found" it looks like a settled fact about the car.
    gateway(text="I could not find reliable trim information for this model.")

    out = await variant_research.research_variants_detailed("Maruti Suzuki", "e Vitara", 2026)

    assert out.ok is False
    assert out.error is not None


@pytest.mark.asyncio
async def test_the_old_signature_still_returns_plain_drafts(gateway):
    # Three call sites use it and have nothing useful to say about failure.
    gateway(text='{"variants": [{"name": "Delta", "ex_showroom_price": 1799000}]}')

    drafts = await variant_research.research_variants("Maruti Suzuki", "e Vitara", 2026)

    assert isinstance(drafts, list)
    assert drafts[0]["name"] == "Delta"


@pytest.mark.asyncio
async def test_the_old_signature_still_swallows_failure(gateway):
    # It must keep never raising: those callers are not prepared for it.
    gateway(raises=RuntimeError("quota exceeded"))

    assert await variant_research.research_variants("M", "X", 2026) == []
