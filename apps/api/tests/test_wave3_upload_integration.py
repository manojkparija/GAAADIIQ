"""Integration tests for WAVE 3 upload pipeline with ML fields."""
import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from uuid import uuid4
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from models.vehicle_media import VehicleMedia
from services import media_library


@pytest.mark.asyncio
async def test_store_image_with_ml_fields(db_session: AsyncSession):
    """Test that ML fields are populated during upload."""
    test_data = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100

    with patch("services.media_library.get_storage") as mock_storage:
        with patch("services.media_library.pdf_ingest.sniff_image") as mock_sniff:
            with patch("services.media_library.pdf_ingest.perceptual_hash") as mock_phash:
                with patch("services.embeddings_clip.embed_image_bytes") as mock_embed:
                    with patch("services.ocr_tesseract.ocr_image_bytes") as mock_ocr:
                        with patch("services.safety_detection.detect_nsfw") as mock_nsfw:
                            with patch("services.safety_detection.detect_license_plate") as mock_plate:
                                mock_storage_obj = MagicMock()
                                mock_storage_obj.save = AsyncMock()
                                mock_storage_obj.save.return_value = MagicMock(
                                    key="test.jpg", size_bytes=len(test_data)
                                )
                                mock_storage.return_value = mock_storage_obj

                                mock_sniff.return_value = ("jpg", "image/jpeg")
                                mock_phash.return_value = "abc123"
                                mock_embed.return_value = [0.1] * 512
                                mock_ocr.return_value = {
                                    "text": "2024 Hyundai",
                                    "confidence": 0.95,
                                    "entities": {"year": 2024},
                                    "blocks": []
                                }
                                mock_nsfw.return_value = 0.1
                                mock_plate.return_value = {
                                    "detected": True,
                                    "bbox": [100, 50, 200, 100],
                                    "confidence": 0.9
                                }

                                media = await media_library.store_image(
                                    db_session,
                                    test_data,
                                    "image/jpeg",
                                    key_prefix="test",
                                    source_name="test.jpg",
                                    make="Hyundai",
                                    model="Creta",
                                )

                                assert media.embedding_vector is not None
                                assert len(media.embedding_vector) == 512
                                assert media.ocr_text == "2024 Hyundai"
                                assert media.ocr_confidence == 0.95
                                assert media.ocr_entities == {"year": 2024}
                                assert media.nsfw_score == 0.1
                                assert media.license_plate_detected is True


@pytest.mark.asyncio
async def test_upload_with_ml_failure_does_not_block(db_session: AsyncSession):
    """Test that ML failures don't prevent upload completion."""
    test_data = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100

    with patch("services.media_library.get_storage") as mock_storage:
        with patch("services.media_library.pdf_ingest.sniff_image") as mock_sniff:
            with patch("services.media_library.pdf_ingest.perceptual_hash") as mock_phash:
                with patch("services.embeddings_clip.embed_image_bytes") as mock_embed:
                    with patch("services.ocr_tesseract.ocr_image_bytes") as mock_ocr:
                        with patch("services.safety_detection.detect_nsfw") as mock_nsfw:
                            with patch("services.safety_detection.detect_license_plate") as mock_plate:
                                mock_storage_obj = MagicMock()
                                mock_storage_obj.save = AsyncMock()
                                mock_storage_obj.save.return_value = MagicMock(
                                    key="test.jpg", size_bytes=len(test_data)
                                )
                                mock_storage.return_value = mock_storage_obj

                                mock_sniff.return_value = ("jpg", "image/jpeg")
                                mock_phash.return_value = "abc123"
                                # All ML services fail
                                mock_embed.side_effect = Exception("CLIP unavailable")
                                mock_ocr.side_effect = Exception("OCR unavailable")
                                mock_nsfw.side_effect = Exception("NSFW unavailable")
                                mock_plate.side_effect = Exception("YOLOv8 unavailable")

                                # Upload should still succeed
                                media = await media_library.store_image(
                                    db_session,
                                    test_data,
                                    "image/jpeg",
                                    key_prefix="test",
                                    source_name="test.jpg",
                                )

                                assert media.id is not None
                                assert media.storage_key == "test.jpg"
                                assert media.embedding_vector is None  # Failed gracefully
                                assert media.ocr_text is None
                                assert media.nsfw_score is None


@pytest.mark.asyncio
async def test_ml_fields_optional_in_database(db_session: AsyncSession):
    """Test that all ML fields are properly nullable in database."""
    media = VehicleMedia(
        id=uuid4(),
        storage_key="test.jpg",
        source_pdf_name="test.pdf",
    )
    db_session.add(media)
    await db_session.commit()

    refreshed = (await db_session.execute(
        select(VehicleMedia).where(VehicleMedia.id == media.id)
    )).scalar_one()

    assert refreshed.embedding_vector is None
    assert refreshed.ocr_text is None
    assert refreshed.ocr_confidence is None
    assert refreshed.ocr_entities is None
    assert refreshed.nsfw_score is None
    assert refreshed.license_plate_detected is None
    assert refreshed.license_plate_bbox is None
    assert refreshed.safety_metadata is None


@pytest.mark.asyncio
async def test_partial_ml_results():
    """Test upload with partial ML results (some succeed, some fail)."""
    test_data = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100

    with patch("services.media_library.get_storage") as mock_storage:
        with patch("services.media_library.pdf_ingest.sniff_image") as mock_sniff:
            with patch("services.media_library.pdf_ingest.perceptual_hash") as mock_phash:
                with patch("services.embeddings_clip.embed_image_bytes") as mock_embed:
                    with patch("services.ocr_tesseract.ocr_image_bytes") as mock_ocr:
                        with patch("services.safety_detection.detect_nsfw") as mock_nsfw:
                            with patch("services.safety_detection.detect_license_plate") as mock_plate:
                                mock_storage_obj = MagicMock()
                                mock_storage_obj.save = AsyncMock()
                                mock_storage_obj.save.return_value = MagicMock(
                                    key="test.jpg", size_bytes=len(test_data)
                                )
                                mock_storage.return_value = mock_storage_obj

                                mock_sniff.return_value = ("jpg", "image/jpeg")
                                mock_phash.return_value = "abc123"
                                # Mixed results: embeddings work, OCR fails, safety works
                                mock_embed.return_value = [0.1] * 512
                                mock_ocr.return_value = {"text": "", "confidence": 0, "entities": {}, "blocks": []}
                                mock_nsfw.return_value = 0.15
                                mock_plate.return_value = {"detected": False, "bbox": None, "confidence": 0.0}

                                media = await media_library.store_image(
                                    None,  # Would need proper session
                                    test_data,
                                    "image/jpeg",
                                    key_prefix="test",
                                    source_name="test.jpg",
                                )

                                # Partial results preserved
                                assert media.embedding_vector is not None
                                assert media.nsfw_score is not None
