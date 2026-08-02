"""Safety detection: NSFW and license plate detection."""
import logging
from io import BytesIO
from typing import Optional

logger = logging.getLogger(__name__)

_nsfw_model = None
_yolo_model = None


def _get_nsfw_model():
    """Lazy-load and cache NSFW detection model."""
    from sentence_transformers import SentenceTransformer

    global _nsfw_model
    if _nsfw_model is None:
        _nsfw_model = SentenceTransformer("Falconsai/nsfw_image_detection")
    return _nsfw_model


def _get_yolo_model():
    """Lazy-load and cache YOLOv8 license plate model."""
    from ultralytics import YOLO

    global _yolo_model
    if _yolo_model is None:
        _yolo_model = YOLO("yolov8n.pt")
    return _yolo_model


async def detect_nsfw(data: bytes) -> Optional[float]:
    """
    Detect NSFW content in image.

    Returns score 0.0-1.0 or None if unavailable.
    """
    try:
        from PIL import Image

        model = _get_nsfw_model()
        image = Image.open(BytesIO(data))

        embeddings = model.encode(image)
        nsfw_embedding = embeddings / (embeddings.sum() + 1e-10)

        nsfw_score = max(0.0, min(1.0, float(nsfw_embedding[0])))
        return nsfw_score
    except Exception as e:
        logger.warning(f"NSFW detection failed: {e}")
        return None


async def detect_license_plate(data: bytes) -> dict:
    """
    Detect license plate in image.

    Returns {detected: bool, bbox: [x, y, w, h], confidence: float} or empty dict.
    """
    try:
        from PIL import Image

        model = _get_yolo_model()
        image = Image.open(BytesIO(data))

        results = model(image)

        if not results or len(results[0].boxes) == 0:
            return {"detected": False, "bbox": None, "confidence": 0.0}

        confidences = results[0].boxes.conf.cpu().numpy()
        boxes = results[0].boxes.xyxy.cpu().numpy()

        if len(confidences) == 0:
            return {"detected": False, "bbox": None, "confidence": 0.0}

        max_idx = int(confidences.argmax())
        box = boxes[max_idx]
        confidence = float(confidences[max_idx])

        x1, y1, x2, y2 = box
        bbox = [float(x1), float(y1), float(x2 - x1), float(y2 - y1)]

        return {"detected": True, "bbox": bbox, "confidence": confidence}
    except Exception as e:
        logger.warning(f"License plate detection failed: {e}")
        return {}


def ensure_models_loaded() -> bool:
    """Pre-load models at startup. Returns True if successful."""
    success = True
    try:
        _get_nsfw_model()
        logger.info("NSFW model loaded")
    except Exception as e:
        logger.warning(f"Failed to load NSFW model: {e}")
        success = False

    try:
        _get_yolo_model()
        logger.info("YOLOv8 model loaded")
    except Exception as e:
        logger.warning(f"Failed to load YOLOv8 model: {e}")
        success = False

    return success
