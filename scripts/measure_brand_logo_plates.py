#!/usr/bin/env python3
"""Does this brand logo read on the white chip?

WHAT THIS IS NOW

A check you run on a candidate file BEFORE uploading it through
Admin → Brands, not a generator. It answers one question per logo: would this
artwork be visible on the chip the grid actually paints?

It used to emit a DARK_PLATE_SLUGS set for src/app/data/brand-logo-plates.ts,
choosing a per-brand plate. That file is gone, and the reason is worth keeping:
the list was keyed on slug and measured from the bundled files here, but
brands.service.ts resolves a logo as `logo_url ?? assets/brand-logos/<slug>.svg`
and most brands render an UPLOADED logo from Supabase storage instead. So the
plate was chosen by measuring an image the page does not display, and an admin
swapping a logo could invert its polarity with nothing able to notice. A list
that cannot see the asset it describes cannot stay right.

The grid now paints one white chip for every brand, and the requirement moved
to the artwork: supply a dark or monochrome mark. This script is how you check
one before it goes in — a score below VISIBLE_FRACTION on light means the file
will wash out, and the fix is a darker version of that logo.

NOTE ON WHAT IT CAN SEE

Only the bundled files in src/assets/brand-logos/. An uploaded logo lives in
Supabase storage and is not readable from here; to check one, download it into
that folder first (or point LOGO_DIR at wherever you have it).

WHERE IT CAME FROM

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

That per-logo plate is gone — see the top of this file. Run this on a
candidate before uploading it, and supply a darker mark if it fails.

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

# The chip the grid actually paints is LIGHT_PLATE (--logo-chip, white in both
# themes). DARK_PLATE is kept only to print a diagnostic second column: a logo
# scoring low on white and high on dark is light artwork, which tells you what
# to fix in the file. Nothing renders on it any more.
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

    print(f"{'slug':20}{'on white':>9}{'(on dark)':>10}   verdict")
    failing = []
    for slug, on_light, on_dark in rows:
        # The dark column is kept for diagnosis only. A low score on white with
        # a high one on dark says "this is light artwork" — which is the thing
        # to fix in the file, not something to work around with a second plate.
        ok = on_light >= VISIBLE_FRACTION
        if not ok:
            failing.append(slug)
        print(f"{slug:20}{on_light:9.2f}{on_dark:10.2f}   {'ok' if ok else 'TOO LIGHT'}")

    if failing:
        print(
            f"\n{len(failing)} logo(s) will wash out on the chip the grid paints:\n"
        )
        for slug in sorted(failing):
            print(f"  {slug}")
        print(
            "\nSupply a dark or monochrome version of each, then upload it through\n"
            "Admin → Brands. Do not reintroduce a per-brand dark plate: see the\n"
            "module docstring for why that could not be kept correct."
        )
    else:
        print("\nEvery logo reads on the white chip.")


if __name__ == "__main__":
    main()
