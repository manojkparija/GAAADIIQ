"""CLIP embeddings for semantic search."""
import logging
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)

_model: Optional["SentenceTransformer"] = None
MODEL_NAME = "sentence-transformers/clip-vit-b-32"
EMBEDDING_DIM = 512


def _get_model() -> "SentenceTransformer":
    """Lazy-load and cache CLIP model."""
    from sentence_transformers import SentenceTransformer

    global _model
    if _model is None:
        _model = SentenceTransformer(MODEL_NAME)
    return _model


async def embed_image_bytes(data: bytes) -> list[float]:
    """
    Embed image bytes using CLIP.

    Returns 512-dim normalized embedding, or empty list if unavailable.
    """
    try:
        from PIL import Image
        from io import BytesIO

        model = _get_model()
        image = Image.open(BytesIO(data))
        embedding = model.encode(image, convert_to_tensor=False)
        return embedding.tolist()
    except Exception as e:
        logger.warning(f"CLIP embedding failed: {e}")
        return []


async def embed_text(text: str) -> list[float]:
    """
    Embed search query text using CLIP.

    Returns 512-dim normalized embedding, or empty list if unavailable.
    """
    try:
        model = _get_model()
        embedding = model.encode(text, convert_to_tensor=False)
        return embedding.tolist()
    except Exception as e:
        logger.warning(f"CLIP text embedding failed: {e}")
        return []


def ensure_model_loaded() -> bool:
    """Pre-load model at startup. Returns True if successful."""
    try:
        _get_model()
        logger.info(f"CLIP model loaded: {MODEL_NAME}")
        return True
    except Exception as e:
        logger.warning(f"Failed to pre-load CLIP model: {e}")
        return False
