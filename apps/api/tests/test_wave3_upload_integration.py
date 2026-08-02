"""Integration tests for WAVE 3 upload pipeline with ML fields."""
import pytest
from uuid import uuid4
from sqlalchemy import select

from models.vehicle_media import VehicleMedia


@pytest.mark.asyncio
async def test_ml_fields_optional_in_database(db_session):
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

    # Verify all ML fields are properly nullable
    assert refreshed.embedding_vector is None
    assert refreshed.ocr_text is None
    assert refreshed.ocr_confidence is None
    assert refreshed.ocr_entities is None
    assert refreshed.nsfw_score is None
    assert refreshed.license_plate_detected is None
    assert refreshed.license_plate_bbox is None
    assert refreshed.safety_metadata is None


@pytest.mark.asyncio
async def test_ml_fields_can_be_set(db_session):
    """Test that ML fields can be set and retrieved."""
    media = VehicleMedia(
        id=uuid4(),
        storage_key="test.jpg",
        source_pdf_name="test.pdf",
        embedding_vector=[0.1, 0.2, 0.3],
        ocr_text="Sample text",
        ocr_confidence=0.95,
        ocr_entities={"year": 2024},
        nsfw_score=0.05,
        license_plate_detected=True,
        license_plate_bbox=[100, 50, 200, 100],
        safety_metadata={"confidence": 0.9},
    )
    db_session.add(media)
    await db_session.commit()

    refreshed = (await db_session.execute(
        select(VehicleMedia).where(VehicleMedia.id == media.id)
    )).scalar_one()

    # Verify all ML fields persist correctly
    assert refreshed.embedding_vector == [0.1, 0.2, 0.3]
    assert refreshed.ocr_text == "Sample text"
    assert refreshed.ocr_confidence == 0.95
    assert refreshed.ocr_entities == {"year": 2024}
    assert refreshed.nsfw_score == 0.05
    assert refreshed.license_plate_detected is True
    assert refreshed.license_plate_bbox == [100, 50, 200, 100]
    assert refreshed.safety_metadata == {"confidence": 0.9}
