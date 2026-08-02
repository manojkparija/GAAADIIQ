"""Tests for WAVE 3 CLIP embeddings and semantic search."""
import pytest


def test_embeddings_clip_imports():
    """Test that embeddings_clip service can be imported."""
    from services.embeddings_clip import embed_image_bytes, embed_text, ensure_model_loaded

    assert callable(embed_image_bytes)
    assert callable(embed_text)
    assert callable(ensure_model_loaded)


@pytest.mark.asyncio
async def test_embed_image_bytes_graceful_failure():
    """Test graceful degradation when CLIP is unavailable."""
    from services.embeddings_clip import embed_image_bytes

    # Call with invalid data - should return empty list rather than crash
    result = await embed_image_bytes(b"invalid data")
    assert result == []


@pytest.mark.asyncio
async def test_embed_text_graceful_failure():
    """Test graceful degradation on text embedding failure."""
    from services.embeddings_clip import embed_text

    # Should handle errors gracefully
    result = await embed_text("")
    assert isinstance(result, list)
