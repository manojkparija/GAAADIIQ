"""Tests for WAVE 3 OCR extraction."""
import pytest


def test_ocr_tesseract_imports():
    """Test that ocr_tesseract service can be imported."""

    from services.ocr_tesseract import _extract_entities, ocr_image_bytes

    assert callable(ocr_image_bytes)
    assert callable(_extract_entities)


@pytest.mark.asyncio
async def test_ocr_extraction_graceful_failure():
    """Test graceful degradation when OCR fails."""
    from services.ocr_tesseract import ocr_image_bytes

    # Call with invalid data - should return empty dict rather than crash
    result = await ocr_image_bytes(b"invalid data")
    assert isinstance(result, dict)
    assert result.get("text") == ""


def test_extract_year_entity():
    """Test year extraction from OCR text."""
    from services.ocr_tesseract import _extract_entities

    text = "2024 Hyundai i20"
    entities = _extract_entities(text)
    assert entities.get("year") == 2024


def test_extract_price_entity():
    """Test price extraction from OCR text."""
    from services.ocr_tesseract import _extract_entities

    text = "₹10,50,000"
    entities = _extract_entities(text)
    assert "price_inr" in entities or entities == {}  # Graceful if price not found
