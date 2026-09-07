#!/usr/bin/env python3
"""Which plate does each brand logo need to be visible on?

WHY THIS EXISTS

The brand grid on /new-cars rendered its logos straight onto the dark glass
card, and thirteen of them were invisible in dark mode — reported with a
screenshot circling Toyota, Kia, Lexus, Mini and Jaguar.

The home page had already solved this with the --logo-chip token: a white chip
in both themes, because "every logo in the set was designed to sit on" a light
ground. Measuring the actual pixels shows that note is only two thirds true.
The set is mixed polarity: some marks are dark artwork on transparent (Audi,
Toyota, Nissan), and some are light or silver artwork on transparent (Genesis,
Lexus, Volvo, Renault) plus two yellow ones (Ferrari, Lotus). A single white
chip fixes the first group and breaks the second, which is worse than the bug
being fixed — the second group is legible today in the theme the report came
from.

So the plate is chosen per logo, and this script is what chooses it. Run it
after adding or replacing any file in src/assets/brand-logos/ and paste the
result into src/app/data/brand-logo-plates.ts.

    python3 scripts/measure_brand_logo_plates.py

WHAT IS MEASURED, AND WHY NOT MEAN BRIGHTNESS

The first attempt averaged each logo's opaque pixels and compared that one
colour against the background. It ranked Lexus and Mini as comfortably visible
on the dark card when the screenshot shows them as barely-there grey outlines:
an average flattens a thin mid-grey mark and a solid one into the same number.

What is measured instead is the fraction of the mark that clears 3:1 against
the plate — WCAG's threshold for a graphical object. A logo that is 100% above
it reads cleanly; one at 0.00 is a silhouette in the background colour.
"""

from __future__ import annotations

import glob
import os

from PIL import Image

# The two candidate plates. Light is --logo-chip; dark is --logo-chip-dark,
# which is --navy so the chip disappears into the card and only the mark shows.
LIGHT_PLATE = (255, 255, 255)
DARK_PLATE = (11, 18, 32)

# Below this fraction of the mark clearing 3:1, call the logo invisible.
VISIBLE_FRACTION = 0.5

LOGO_DIR = os.path.join(
    os.path.dirname(__file__), "..", "apps", "gaadiiq-angular", "src", "assets", "brand-logos"
)


def _luminance(colour: tuple[int, int, int]) -> float:
    def channel(v: int) -> float:
        s = v / 255
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4

    r, g, b = colour
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast_ratio(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    la, lb = _luminance(a) + 0.05, _luminance(b) + 0.05
    return max(la, lb) / min(la, lb)


def visible_fraction(pixels: list[tuple[int, int, int, int]], plate: tuple[int, int, int]) -> float:
    """How much of the mark clears 3:1 against `plate`."""
    return sum(1 for p in pixels if contrast_ratio(p[:3], plate) >= 3.0) / len(pixels)


def main() -> None:
    rows = []
    for path in sorted(glob.glob(os.path.join(LOGO_DIR, "*.png"))):
        slug = os.path.basename(path)[: -len(".png")]
        # Resized to the size the grid actually paints, so a mark is weighted
        # the way it is seen rather than by its source resolution.
        image = Image.open(path).convert("RGBA").resize((64, 44))
        opaque = [p for p in image.getdata() if p[3] > 128]
        if not opaque:
            continue
        rows.append((slug, visible_fraction(opaque, LIGHT_PLATE), visible_fraction(opaque, DARK_PLATE)))

    rows.sort(key=lambda r: r[1])

    print(f"{'slug':20}{'on light':>9}{'on dark':>9}   plate")
    needs_dark = []
    for slug, on_light, on_dark in rows:
        # Light is the default, matching the home page. A logo only moves to
        # the dark plate when the light one actually fails it AND the dark one
        # is better — not merely because the dark one scores higher, which
        # would move marks like BMW that are perfectly readable either way.
        dark = on_light < VISIBLE_FRACTION and on_dark > on_light
        if dark:
            needs_dark.append(slug)
        print(f"{slug:20}{on_light:9.2f}{on_dark:9.2f}   {'dark' if dark else 'light'}")

    print("\nPaste into src/app/data/brand-logo-plates.ts:\n")
    print("export const DARK_PLATE_SLUGS = new Set([")
    for slug in sorted(needs_dark):
        print(f"  '{slug}',")
    print("]);")


if __name__ == "__main__":
    main()
