"""OCR extraction using Tesseract."""
import logging
import re
from io import BytesIO

logger = logging.getLogger(__name__)


async def ocr_image_bytes(data: bytes, timeout: int = 30) -> dict:
    """
    Extract text and entities from image using Tesseract.

    Returns {text, confidence, entities, blocks} or empty dict if unavailable.
    """
    try:
        import pytesseract
        from PIL import Image

        image = Image.open(BytesIO(data))

        config = f"--timeout {timeout}"
        text = pytesseract.image_to_string(image, config=config)

        if not text.strip():
            return {"text": "", "confidence": 0.0, "entities": {}, "blocks": []}

        data_dict = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)

        confidence_scores = [
            int(c) for c in data_dict.get("confidence", []) if int(c) > 0
        ]
        avg_confidence = (
            sum(confidence_scores) / len(confidence_scores)
            if confidence_scores
            else 0.0
        )

        blocks = []
        for i, conf in enumerate(data_dict.get("confidence", [])):
            if int(conf) > 0:
                blocks.append(
                    {
                        "text": data_dict["text"][i],
                        "confidence": int(conf),
                        "x": data_dict["left"][i],
                        "y": data_dict["top"][i],
                        "w": data_dict["width"][i],
                        "h": data_dict["height"][i],
                    }
                )

        entities = _extract_entities(text)

        return {
            "text": text,
            "confidence": avg_confidence / 100.0,
            "entities": entities,
            "blocks": blocks,
        }
    except Exception as e:
        logger.warning(f"OCR extraction failed: {e}")
        return {"text": "", "confidence": 0.0, "entities": {}, "blocks": []}


def _extract_entities(text: str) -> dict:
    """Extract make, model, year, price from OCR text via regex."""
    entities = {}

    year_match = re.search(r"\b(19|20)\d{2}\b", text)
    if year_match:
        entities["year"] = int(year_match.group(0))

    price_match = re.search(
        r"(?:₹|Rs\.?|INR)\s*([0-9,]+(?:\.[0-9]{2})?)", text, re.IGNORECASE
    )
    if price_match:
        price_str = price_match.group(1).replace(",", "")
        try:
            entities["price_inr"] = int(float(price_str))
        except ValueError:
            pass

    lines = text.split("\n")
    for line in lines[:5]:
        line_clean = line.strip()
        if len(line_clean) > 0 and len(line_clean) < 100:
            if "make" not in entities:
                entities["make"] = line_clean
            elif "model" not in entities and len(line_clean) > 2:
                entities["model"] = line_clean
                break

    return entities
