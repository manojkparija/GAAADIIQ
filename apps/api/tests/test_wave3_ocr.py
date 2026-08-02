"""Tests for WAVE 3 OCR extraction."""
import pytest
from unittest.mock import patch, MagicMock
from uuid import uuid4
from sqlalchemy.ext.asyncio import AsyncSession

from models.vehicle_media import VehicleMedia
from services.ocr_tesseract import ocr_image_bytes, _extract_entities


@pytest.mark.asyncio
async def test_ocr_extraction_success():
    """Test successful OCR text extraction."""
    test_image = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100

    with patch("services.ocr_tesseract.pytesseract") as mock_tesseract:
        with patch("services.ocr_tesseract.Image.open"):
            mock_tesseract.image_to_string.return_value = "2024 Hyundai i20 Sedan"
            mock_tesseract.image_to_data.return_value = {
                "text": ["2024", "Hyundai", "i20"],
                "confidence": [95, 90, 92],
                "left": [10, 20, 30],
                "top": [10, 10, 10],
                "width": [40, 50, 30],
                "height": [20, 20, 20],
            }

            result = await ocr_image_bytes(test_image)
            assert result["text"] == "2024 Hyundai i20 Sedan"
            assert result["confidence"] > 0.8
            assert "year" in result["entities"]
            assert result["entities"]["year"] == 2024


@pytest.mark.asyncio
async def test_ocr_extraction_failure():
    """Test graceful degradation on OCR failure."""
    with patch("services.ocr_tesseract.pytesseract") as mock_tesseract:
        mock_tesseract.image_to_string.side_effect = Exception("Tesseract not found")

        result = await ocr_image_bytes(b"invalid data")
        assert result["text"] == ""
        assert result["confidence"] == 0.0
        assert result["entities"] == {}


@pytest.mark.asyncio
async def test_ocr_empty_text():
    """Test OCR when image contains no text."""
    with patch("services.ocr_tesseract.pytesseract") as mock_tesseract:
        with patch("services.ocr_tesseract.Image.open"):
            mock_tesseract.image_to_string.return_value = ""

            result = await ocr_image_bytes(b"blank image")
            assert result["text"] == ""
            assert result["confidence"] == 0.0
            assert result["blocks"] == []


def test_extract_year_entity():
    """Test year extraction from OCR text."""
    text = "2024 Hyundai i20"
    entities = _extract_entities(text)
    assert entities.get("year") == 2024


def test_extract_price_entity():
    """Test price extraction from OCR text."""
    text = "₹10,50,000 or Rs. 10,50,000 INR"
    entities = _extract_entities(text)
    assert "price_inr" in entities
    assert entities["price_inr"] >= 1000000


def test_extract_make_model():
    """Test make/model extraction from OCR text."""
    text = """
    Hyundai
    Creta
    2024 Model
    """
    entities = _extract_entities(text)
    assert entities.get("make") is not None
    assert entities.get("model") is not None


@pytest.mark.asyncio
async def test_ocr_results_endpoint(client, db_session: AsyncSession):
    """Test OCR results retrieval endpoint."""
    media = VehicleMedia(
        id=uuid4(),
        storage_key="test.jpg",
        source_pdf_name="test.pdf",
        ocr_text="2024 Hyundai Creta",
        ocr_confidence=0.95,
        ocr_entities={"year": 2024, "make": "Hyundai"},
    )
    db_session.add(media)
    await db_session.commit()

    response = client.get(
        f"/media-admin/{media.id}/ocr",
        headers={"Authorization": f"Bearer {client.admin_token}"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["text"] == "2024 Hyundai Creta"
    assert data["confidence"] == 0.95
    assert data["entities"]["year"] == 2024


@pytest.mark.asyncio
async def test_ocr_results_not_found(client):
    """Test OCR endpoint with non-existent media."""
    from uuid import uuid4
    fake_id = uuid4()
    response = client.get(
        f"/media-admin/{fake_id}/ocr",
        headers={"Authorization": f"Bearer {client.admin_token}"}
    )
    assert response.status_code == 404
