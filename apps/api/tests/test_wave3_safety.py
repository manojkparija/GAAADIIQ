"""Tests for WAVE 3 NSFW and license plate detection."""
import pytest


def test_safety_detection_imports():
    """Test that safety_detection service can be imported."""

    from services.safety_detection import (
        detect_license_plate,
        detect_nsfw,
        ensure_models_loaded,
    )

    assert callable(detect_nsfw)
    assert callable(detect_license_plate)
    assert callable(ensure_models_loaded)


@pytest.mark.asyncio
async def test_detect_nsfw_graceful_failure():
    """Test graceful degradation when NSFW detection fails."""
    from services.safety_detection import detect_nsfw

    # Call with invalid data - should return None rather than crash
    result = await detect_nsfw(b"invalid data")
    assert result is None or isinstance(result, float)


@pytest.mark.asyncio
async def test_detect_license_plate_graceful_failure():
    """Test graceful degradation when license plate detection fails."""
    from services.safety_detection import detect_license_plate

    # Call with invalid data - should return empty dict rather than crash
    result = await detect_license_plate(b"invalid data")
    assert isinstance(result, dict)
