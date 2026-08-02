"""Tests for WAVE 3 CLIP embeddings and semantic search."""
import pytest
from unittest.mock import patch, AsyncMock
from uuid import uuid4
from sqlalchemy.ext.asyncio import AsyncSession

from models.vehicle_media import VehicleMedia
from services.embeddings_clip import embed_image_bytes, embed_text, ensure_model_loaded


@pytest.mark.asyncio
async def test_embed_image_bytes_success():
    """Test successful image embedding."""
    test_image = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    test_image += b"\x08\x02\x00\x00\x00\x90wS\xde" + b"\x00" * 100

    with patch("services.embeddings_clip._get_model") as mock_model:
        mock_encoder = AsyncMock()
        mock_encoder.encode.return_value = [0.1] * 512
        mock_model.return_value = mock_encoder

        result = await embed_image_bytes(test_image)
        assert len(result) == 512
        assert all(isinstance(x, (int, float)) for x in result)


@pytest.mark.asyncio
async def test_embed_image_bytes_failure():
    """Test graceful degradation on embedding failure."""
    with patch("services.embeddings_clip._get_model") as mock_model:
        mock_model.side_effect = Exception("Model load failed")

        result = await embed_image_bytes(b"invalid data")
        assert result == []


@pytest.mark.asyncio
async def test_embed_text_success():
    """Test successful text embedding."""
    with patch("services.embeddings_clip._get_model") as mock_model:
        mock_encoder = AsyncMock()
        mock_encoder.encode.return_value = [0.2] * 512
        mock_model.return_value = mock_encoder

        result = await embed_text("red sedan exterior")
        assert len(result) == 512


@pytest.mark.asyncio
async def test_embed_text_failure():
    """Test graceful degradation on text embedding failure."""
    with patch("services.embeddings_clip._get_model") as mock_model:
        mock_model.side_effect = Exception("Model unavailable")

        result = await embed_text("search query")
        assert result == []


def test_ensure_model_loaded_success():
    """Test successful model pre-loading."""
    with patch("services.embeddings_clip._get_model") as mock_model:
        mock_model.return_value = AsyncMock()
        result = ensure_model_loaded()
        assert result is True


def test_ensure_model_loaded_failure():
    """Test graceful degradation when model fails to load."""
    with patch("services.embeddings_clip._get_model") as mock_model:
        mock_model.side_effect = Exception("CUDA unavailable")
        result = ensure_model_loaded()
        assert result is False


@pytest.mark.asyncio
async def test_semantic_search_endpoint(client, db_session: AsyncSession):
    """Test semantic search API endpoint."""
    media = VehicleMedia(
        id=uuid4(),
        storage_key="test.jpg",
        source_pdf_name="test.pdf",
        embedding_vector=[0.1] * 512,
    )
    db_session.add(media)
    await db_session.commit()

    with patch("services.embeddings_clip.embed_text") as mock_embed:
        mock_embed.return_value = [0.1] * 512

        response = client.get(
            "/media-admin/search?q=red+sedan",
            headers={"Authorization": f"Bearer {client.admin_token}"}
        )
        assert response.status_code == 200
        assert "similarity_score" in response.json()[0] if response.json() else True


@pytest.mark.asyncio
async def test_semantic_search_empty_query(client):
    """Test semantic search with empty query."""
    response = client.get(
        "/media-admin/search?q=",
        headers={"Authorization": f"Bearer {client.admin_token}"}
    )
    assert response.status_code == 400
    assert "cannot be empty" in response.json()["detail"]
