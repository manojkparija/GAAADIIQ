"""
Identify a dashboard warning light from an uploaded image, without a vision model.

Why this exists
---------------
The diagnosis pipeline could only read an uploaded photo by sending it to a
vision model on Ollama. When that model is not installed the image contributed
nothing at all, so a picture of a lit battery telltale — the single most common
thing an owner photographs — produced no diagnosis.

This module identifies the symbol from the image itself using Pillow only:
colour, and a handful of shape statistics of the glyph. It is deliberately
modest about what geometry can prove:

  - Colour is the reliable signal, and it carries the urgency that matters
    most: a red telltale means stop driving, amber means service soon. We
    report colour with high confidence.
  - Shape narrows the field but rarely settles it. We return a ranked list of
    candidates with scores, and only call a match "confident" when the leader
    is clearly ahead of the runner-up.

It is not a replacement for a vision model on a photograph of a whole
dashboard, and it does not pretend to be — see `identify_warning_light`'s
confidence contract. It is very good at the icon-like crops users actually
upload.
"""
from __future__ import annotations

import io
import json
import logging
from collections import deque
from functools import lru_cache
from pathlib import Path
from typing import Any

logger = logging.getLogger("gaadiiq.warning_lights")

_CATALOGUE_PATH = Path(__file__).parent.parent / "data" / "warning_lights.json"

# Working resolution. Large enough to keep the symbol's holes intact, small
# enough that the flood fill stays cheap.
_GRID = 96

# The leader must beat the runner-up by this much for a single-name claim.
_DECISIVE_MARGIN = 0.12


@lru_cache(maxsize=1)
def _catalogue() -> list[dict]:
    try:
        return json.loads(_CATALOGUE_PATH.read_text())["lights"]
    except Exception as exc:  # pragma: no cover - only on a broken deploy
        logger.warning("Could not load warning light catalogue: %s", exc)
        return []


def _classify_colour(r: int, g: int, b: int) -> str:
    """
    Name the ink colour of the glyph.

    Red versus amber is the distinction that decides whether the driver should
    stop now or book a service, so it is worth doing carefully rather than by
    hue angle alone — dashboard reds photograph orange under warm light.
    """
    mx, mn = max(r, g, b), min(r, g, b)
    if mx < 45:
        return "dark"
    if mx - mn < 28:
        return "white" if mx > 150 else "grey"

    if r == mx:
        # Distinguish red from amber by how much green is present.
        green_ratio = (g - mn) / max(1, mx - mn)
        if green_ratio < 0.42:
            return "red"
        return "amber" if green_ratio < 0.85 else "yellow"
    if g == mx:
        return "green"
    return "blue"


def _extract_glyph(img: Any) -> dict | None:
    """
    Separate the symbol from its background and measure it.

    Returns None when the image has no discernible symbol — a blank or evenly
    textured photo — so callers can say "nothing identified" instead of
    scoring noise against the catalogue.
    """
    from PIL import Image

    # Resize into a _GRID box preserving the aspect ratio. Squashing to a
    # square would destroy the very feature that tells a wide battery symbol
    # from a tall thermometer.
    img = img.convert("RGB")
    w0, h0 = img.size
    scale = _GRID / max(w0, h0)
    img = img.resize((max(1, round(w0 * scale)), max(1, round(h0 * scale))), Image.LANCZOS)
    grid_w, grid_h = img.size
    px = img.load()

    # Background is whatever dominates the border ring. Dashboard shots are
    # dark-on-dark; icon crops are usually light. Sampling the border rather
    # than assuming either one keeps both cases working.
    border: list[tuple[int, int, int]] = []
    for i in range(grid_w):
        border.extend([px[i, 0], px[i, grid_h - 1]])
    for j in range(grid_h):
        border.extend([px[0, j], px[grid_w - 1, j]])
    br = sum(c[0] for c in border) // len(border)
    bg = sum(c[1] for c in border) // len(border)
    bb = sum(c[2] for c in border) // len(border)

    mask = [[False] * grid_w for _ in range(grid_h)]
    ink: list[tuple[int, int, int]] = []
    for y in range(grid_h):
        for x in range(grid_w):
            r, g, b = px[x, y]
            # Manhattan distance from the background colour. Cheap, and stable
            # against the JPEG ringing around a bright telltale.
            if abs(r - br) + abs(g - bg) + abs(b - bb) > 110:
                mask[y][x] = True
                ink.append((r, g, b))

    if len(ink) < 40:
        return None

    xs = [x for y in range(grid_h) for x in range(grid_w) if mask[y][x]]
    ys = [y for y in range(grid_h) for x in range(grid_w) if mask[y][x]]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    w, h = (x1 - x0 + 1), (y1 - y0 + 1)
    if w < 6 or h < 6:
        return None

    mean = (
        sum(c[0] for c in ink) // len(ink),
        sum(c[1] for c in ink) // len(ink),
        sum(c[2] for c in ink) // len(ink),
    )

    return {
        "colour": _classify_colour(*mean),
        "aspect": w / h,
        "fill": len(ink) / (w * h),
        "holes": _count_holes(mask, x0, x1, y0, y1),
        "symmetry": _symmetry(mask, x0, x1, y0, y1),
        "ink_rgb": mean,
    }


def _count_holes(mask: list[list[bool]], x0: int, x1: int, y0: int, y1: int) -> int:
    """
    Count background regions fully enclosed by the symbol.

    This is the feature that separates a battery (a box with marks inside it)
    from an oil can or a thermometer. Holes are found by flooding the
    background inward from the bounding box edge: whatever background is left
    unreached is enclosed.
    """
    w, h = x1 - x0 + 1, y1 - y0 + 1
    seen = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    for i in range(w):
        for j in (0, h - 1):
            if not mask[y0 + j][x0 + i] and not seen[j][i]:
                seen[j][i] = True
                q.append((i, j))
    for j in range(h):
        for i in (0, w - 1):
            if not mask[y0 + j][x0 + i] and not seen[j][i]:
                seen[j][i] = True
                q.append((i, j))

    while q:
        i, j = q.popleft()
        for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ni, nj = i + di, j + dj
            if 0 <= ni < w and 0 <= nj < h and not seen[nj][ni] and not mask[y0 + nj][x0 + ni]:
                seen[nj][ni] = True
                q.append((ni, nj))

    holes = 0
    for j in range(h):
        for i in range(w):
            if not mask[y0 + j][x0 + i] and not seen[j][i]:
                holes += 1
                seen[j][i] = True
                q.append((i, j))
                while q:
                    a, b = q.popleft()
                    for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        na, nb = a + di, b + dj
                        if (
                            0 <= na < w and 0 <= nb < h
                            and not seen[nb][na] and not mask[y0 + nb][x0 + na]
                        ):
                            seen[nb][na] = True
                            q.append((na, nb))
    return holes


def _symmetry(mask: list[list[bool]], x0: int, x1: int, y0: int, y1: int) -> float:
    """Fraction of pixels that mirror across the vertical axis (1.0 = perfect)."""
    w, h = x1 - x0 + 1, y1 - y0 + 1
    same = total = 0
    for j in range(h):
        for i in range(w // 2):
            total += 1
            if mask[y0 + j][x0 + i] == mask[y0 + j][x1 - i]:
                same += 1
    return same / total if total else 0.0


def _score(glyph: dict, light: dict) -> float:
    """Score one catalogue entry against the measured glyph, 0.0–1.0."""
    score = 0.0

    # Colour carries the urgency, so it carries the most weight. Amber and
    # yellow are the same lamp under different white balance.
    want = light["colour"]
    got = glyph["colour"]
    if got == want or {got, want} == {"amber", "yellow"}:
        score += 0.46
    elif {got, want} <= {"red", "amber", "yellow"}:
        score += 0.14  # warm-on-warm: wrong lamp, but not a different family
    elif got in ("white", "grey", "dark"):
        score += 0.09  # a washed-out photo should not veto a shape match

    # Graded rather than in-range/out-of-range. With a binary test several
    # symbols whose ranges overlap all scored identically and nothing could
    # ever be identified; distance from the centre of the range breaks those
    # ties in favour of the symbol the measurement actually looks most like.
    score += 0.20 * _band(glyph["aspect"], *light["aspect"])
    score += 0.08 * _band(glyph["fill"], *light["fill"])
    # Holes are discrete and reliable — any count inside the range is equally
    # good, and a badly wrong count is strong evidence against the symbol. A
    # centre-peaked band gave a hole-rich symbol like ABS partial credit for
    # an image with one hole, which was enough to shadow the right answer.
    score += 0.14 * _band_flat(glyph["holes"], *light["holes"])

    symmetric = glyph["symmetry"] >= 0.88
    score += 0.12 if symmetric == bool(light["symmetric"]) else 0.0

    return round(score, 4)


def _band_flat(value: float, lo: float, hi: float) -> float:
    """1.0 anywhere inside [lo, hi], falling to 0.0 one unit outside it."""
    if lo <= value <= hi:
        return 1.0
    gap = lo - value if value < lo else value - hi
    return max(0.0, 1.0 - gap)


def _band(value: float, lo: float, hi: float) -> float:
    """
    1.0 at the centre of [lo, hi], tapering to 0.5 at the edges and to 0.0 one
    half-width beyond them. Keeps a near-miss ahead of a wild miss.
    """
    mid = (lo + hi) / 2
    half = max((hi - lo) / 2, 1e-6)
    d = abs(value - mid) / half
    if d <= 1.0:
        return 1.0 - 0.5 * d
    return max(0.0, 0.5 - 0.5 * (d - 1.0))


def identify_warning_light(image_bytes: bytes) -> dict:
    """
    Identify the telltale in an image.

    Returns a dict that is always safe to render:

        identified       True only when one candidate is decisively ahead.
        colour           "red" | "amber" | ... — trustworthy on its own.
        candidates       Ranked [{id, name, score, meaning, severity, ...}].
        best             The leading candidate, or None.
        confidence       0–100. Reflects the margin, not just the top score.
        urgency_note     Colour-derived advice, valid even when unidentified.

    A caller must treat `identified=False` as "we know the colour, not the
    lamp" and say so, rather than presenting the top candidate as fact.
    """
    empty = {
        "identified": False,
        "colour": None,
        "candidates": [],
        "best": None,
        "confidence": 0,
        "urgency_note": None,
        "detail": "No symbol could be isolated in the image.",
    }

    try:
        from PIL import Image

        img = Image.open(io.BytesIO(image_bytes))
        glyph = _extract_glyph(img)
    except Exception as exc:
        logger.warning("Warning-light analysis failed: %s", exc)
        return {**empty, "detail": "The image could not be read."}

    if glyph is None:
        return empty

    lights = _catalogue()
    if not lights:
        return {**empty, "colour": glyph["colour"], "detail": "Telltale catalogue unavailable."}

    ranked = sorted(
        (
            {
                "id": L["id"],
                "name": L["name"],
                "score": _score(glyph, L),
                "meaning": L["meaning"],
                "severity": L["severity"],
                "safe_to_drive": L["safe_to_drive"],
                "urgency": L["urgency"],
                "kb_id": L.get("kb_id"),
            }
            for L in lights
        ),
        key=lambda c: c["score"],
        reverse=True,
    )

    best = ranked[0]
    runner = ranked[1]["score"] if len(ranked) > 1 else 0.0
    margin = best["score"] - runner
    identified = best["score"] >= 0.65 and margin >= _DECISIVE_MARGIN

    # Confidence blends how well the leader fits with how far clear it is.
    # A high score that ties with three others is not a confident answer.
    confidence = int(min(95, best["score"] * 60 + min(margin, 0.35) * 100))

    return {
        "identified": identified,
        "colour": glyph["colour"],
        "candidates": ranked[:3],
        "best": best if identified else None,
        "confidence": confidence if identified else min(confidence, 45),
        "urgency_note": _urgency_for_colour(glyph["colour"]),
        "detail": None,
        "features": glyph,
    }


def _urgency_for_colour(colour: str) -> str | None:
    """
    Advice that holds even when the exact lamp is unknown.

    This is the part worth being certain about: the colour convention is
    standardised across every car sold in India, so it is safe to act on even
    when the symbol itself is ambiguous.
    """
    if colour == "red":
        return (
            "A red warning light means stop as soon as it is safe to do so. "
            "Continuing to drive risks serious damage or a safety failure."
        )
    if colour in ("amber", "yellow"):
        return (
            "An amber warning light means a fault has been logged. The car is "
            "usually driveable, but get it checked soon."
        )
    if colour == "green" or colour == "blue":
        return "Green and blue lamps are status indicators, not faults."
    return None
