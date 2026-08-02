"""Tests for WAVE 3 NSFW and license plate detection."""
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from uuid import uuid4
from sqlalchemy.ext.asyncio import AsyncSession

from models.vehicle_media import VehicleMedia
from services.safety_detection import detect_nsfw, detect_license_plate, ensure_models_loaded


@pytest.mark.asyncio
async def test_detect_nsfw_safe_image():
    """Test NSFW detection on a safe image."""
    test_image = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100

    with patch("services.safety_detection._get_nsfw_model") as mock_model:
        mock_encoder = MagicMock()
        mock_encoder.encode.return_value = [0.1] * 1
        mock_model.return_value = mock_encoder

        result = await detect_nsfw(test_image)
        assert 0.0 <= result <= 1.0


@pytest.mark.asyncio
async def test_detect_nsfw_failure():
    """Test graceful degradation on NSFW detection failure."""
    with patch("services.safety_detection._get_nsfw_model") as mock_model:
        mock_model.side_effect = Exception("Model unavailable")

        result = await detect_nsfw(b"invalid data")
        assert result is None


@pytest.mark.asyncio
async def test_detect_license_plate_detected():
    """Test license plate detection when present."""
    test_image = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100

    with patch("services.safety_detection._get_yolo_model") as mock_model:
        mock_yolo = MagicMock()
        mock_result = MagicMock()
        mock_box = [100, 50, 200, 100]  # x1, y1, x2, y2
        mock_result.boxes.xyxy.cpu().numpy.return_value = [mock_box]
        mock_result.boxes.conf.cpu().numpy.return_value = [0.95]
        mock_yolo.return_value = [mock_result]
        mock_model.return_value = mock_yolo

        result = await detect_license_plate(test_image)
        assert result["detected"] is True
        assert result["confidence"] == 0.95
        assert len(result["bbox"]) == 4


@pytest.mark.asyncio
async def test_detect_license_plate_not_detected():
    """Test license plate detection when not present."""
    with patch("services.safety_detection._get_yolo_model") as mock_model:
        mock_yolo = MagicMock()
        mock_result = MagicMock()
        mock_result.boxes.conf.cpu().numpy.return_value = []
        mock_yolo.return_value = [mock_result]
        mock_model.return_value = mock_yolo

        result = await detect_license_plate(b"image without plate")
        assert result["detected"] is False
        assert result["confidence"] == 0.0


@pytest.mark.asyncio
async def test_detect_license_plate_failure():
    """Test graceful degradation on license plate detection failure."""
    with patch("services.safety_detection._get_yolo_model") as mock_model:
        mock_model.side_effect = Exception("YOLO model unavailable")

        result = await detect_license_plate(b"invalid data")
        assert result == {}


def test_ensure_models_loaded_success():
    """Test successful model pre-loading."""
    with patch("services.safety_detection._get_nsfw_model") as mock_nsfw:
        with patch("services.safety_detection._get_yolo_model") as mock_yolo:
            mock_nsfw.return_value = MagicMock()
            mock_yolo.return_value = MagicMock()

            result = ensure_models_loaded()
            assert result is True


def test_ensure_models_loaded_partial_failure():
    """Test model loading with partial failure."""
    with patch("services.safety_detection._get_nsfw_model") as mock_nsfw:
        with patch("services.safety_detection._get_yolo_model") as mock_yolo:
            mock_nsfw.return_value = MagicMock()
            mock_yolo.side_effect = Exception("CUDA unavailable")

            result = ensure_models_loaded()
            assert result is False


@pytest.mark.asyncio
async def test_safety_results_endpoint(client, db_session: AsyncSession):
    """Test safety detection results retrieval endpoint."""
    media = VehicleMedia(
        id=uuid4(),
        storage_key="test.jpg",
        source_pdf_name="test.pdf",
        nsfw_score=0.1,
        license_plate_detected=True,
        license_plate_bbox=[100, 50, 200, 100],
        safety_metadata={"license_plate_confidence": 0.95},
    )
    db_session.add(media)
    await db_session.commit()

    response = client.get(
        f"/media-admin/{media.id}/safety",
        headers={"Authorization": f"Bearer {client.admin_token}"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["nsfw_score"] == 0.1
    assert data["license_plate_detected"] is True
    assert data["license_plate_bbox"] == [100, 50, 200, 100]


@pytest.mark.asyncio
async def test_safety_results_not_found(client):
    """Test safety endpoint with non-existent media."""
    from uuid import uuid4
    fake_id = uuid4()
    response = client.get(
        f"/media-admin/{fake_id}/safety",
        headers={"Authorization": f"Bearer {client.admin_token}"}
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_nsfw_threshold_flagging():
    """Test that high NSFW scores are properly flagged."""
    high_nsfw_image = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100

    with patch("services.safety_detection._get_nsfw_model") as mock_model:
        mock_encoder = MagicMock()
        mock_encoder.encode.return_value = [0.9]  # High NSFW score
        mock_model.return_value = mock_encoder

        result = await detect_nsfw(high_nsfw_image)
        assert result > 0.5  # Exceeds threshold
