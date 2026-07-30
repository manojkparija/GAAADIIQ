"""
Read what a filename already tells us about a vehicle image.

Photography arriving from a manufacturer or an agency is named, not tagged:
`Tata_Nexon_FearlessPlus_Front_2025.webp` carries the make, model, variant,
angle and year that an admin would otherwise retype for every one of two
hundred files. Reading it back is the difference between a usable bulk upload
and an afternoon of data entry.

This only ever *suggests*. Nothing here is authoritative — the admin sees what
was parsed and corrects it before saving, because filenames are inconsistent
and a wrong make silently attached to three hundred images is far more
expensive than a blank field.

Deliberately no AI. A filename is short, structured and cheap to parse, and a
vision call per file would be slower, costlier and less predictable than
matching against the makes we already know.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from models.vehicle_media import ImageCategory

logger = logging.getLogger("gaadiiq.filename_metadata")

# Indian-market makes, longest first so "Maruti Suzuki" wins over "Suzuki" and
# "Land Rover" over "Rover". Matching is on a normalised, separator-stripped
# form, so "MarutiSuzuki", "maruti-suzuki" and "MARUTI_SUZUKI" all hit.
_MAKES = [
    "Maruti Suzuki", "Mercedes Benz", "Aston Martin", "Rolls Royce", "Land Rover",
    "Force Motors", "OLA Electric", "Alfa Romeo",
    "Mahindra", "Hyundai", "Volkswagen", "Lamborghini", "Mitsubishi", "Chevrolet",
    "Maserati", "Bentley", "Porsche", "Ferrari", "McLaren", "Citroen", "Renault",
    "Nissan", "Toyota", "Suzuki", "Genesis", "Lexus", "Jaguar", "Skoda", "Honda",
    "Datsun", "Isuzu", "Volvo", "Tesla", "Lotus", "Jeep", "Audi", "Mini", "Kia",
    "Tata", "Fiat", "BMW", "MG", "BYD", "VinFast",
]

# Angle/category words as they appear in real filenames, mapped to the
# catalogue's vocabulary. Longest first for the same reason as makes:
# "front_quarter" must not be consumed by "front".
_CATEGORY_WORDS: list[tuple[str, ImageCategory]] = [
    ("frontquarter", ImageCategory.front_quarter),
    ("front34", ImageCategory.front_quarter),
    ("frontthreequarter", ImageCategory.front_quarter),
    ("rearquarter", ImageCategory.rear_quarter),
    ("rear34", ImageCategory.rear_quarter),
    ("rearthreequarter", ImageCategory.rear_quarter),
    ("interiordashboard", ImageCategory.interior_dashboard),
    ("dashboard", ImageCategory.interior_dashboard),
    ("dash", ImageCategory.interior_dashboard),
    ("infotainment", ImageCategory.infotainment),
    ("touchscreen", ImageCategory.infotainment),
    ("steering", ImageCategory.steering),
    ("bootspace", ImageCategory.boot_space),
    ("boot", ImageCategory.boot_space),
    ("enginebay", ImageCategory.engine_bay),
    ("engine", ImageCategory.engine_bay),
    ("sunroof", ImageCategory.sunroof),
    ("accessories", ImageCategory.accessories),
    ("accessory", ImageCategory.accessories),
    ("safety", ImageCategory.safety),
    ("gallery", ImageCategory.gallery),
    ("360", ImageCategory.three_sixty),
    ("wheels", ImageCategory.wheels),
    ("wheel", ImageCategory.wheels),
    ("alloy", ImageCategory.wheels),
    ("seats", ImageCategory.seats),
    ("seat", ImageCategory.seats),
    ("leftside", ImageCategory.exterior_left),
    ("rightside", ImageCategory.exterior_right),
    ("left", ImageCategory.exterior_left),
    ("right", ImageCategory.exterior_right),
    ("front", ImageCategory.exterior_front),
    ("rear", ImageCategory.exterior_rear),
    ("back", ImageCategory.exterior_rear),
    ("interior", ImageCategory.interior_dashboard),
]

# 1990 rather than 1900: a four-digit number below this in a car filename is a
# model name or a resolution, not a model year.
_YEAR = re.compile(r"(?<!\d)(19[9]\d|20[0-4]\d)(?!\d)")

_COLOURS = [
    "white", "black", "silver", "grey", "gray", "red", "blue", "green",
    "yellow", "orange", "brown", "beige", "gold", "bronze", "maroon",
]


@dataclass
class FilenameMetadata:
    """What the filename suggested. Every field may be None."""
    make: str | None = None
    model: str | None = None
    variant: str | None = None
    model_year: int | None = None
    image_category: ImageCategory | None = None
    colour: str | None = None

    def as_dict(self) -> dict:
        return {
            "make": self.make,
            "model": self.model,
            "variant": self.variant,
            "model_year": self.model_year,
            "image_category": self.image_category.value if self.image_category else None,
            "colour": self.colour,
        }


def _normalise(text: str) -> str:
    """Lowercase, strip separators — so all the ways of writing a name collapse."""
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _split_words(stem: str) -> list[str]:
    """
    Filename into words, splitting on separators and camelCase.

    camelCase matters because `TataNexonFearlessPlus.webp` is as common as the
    underscore form, and treating it as one token would find nothing.

    A trailing year is also split off (`Front2025` → `Front`, `2025`), but only
    a year: splitting every letter/digit boundary would tear `xuv700` and `i20`
    in half, and those digits are part of the model name.
    """
    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", stem)
    words = [w for w in re.split(r"[\s_\-.]+", spaced) if w]

    out: list[str] = []
    for word in words:
        match = re.fullmatch(r"(.*[A-Za-z])(19[9]\d|20[0-4]\d)", word)
        if match:
            out.extend([match.group(1), match.group(2)])
        else:
            out.append(word)
    return out


def _for_display(word: str) -> str:
    """
    Capitalise a word only when the filename gave no casing of its own.

    `nexon` becomes `Nexon`, while `ZXi`, `AX7` and `DCA` keep the casing they
    were written with — title-casing those would turn a variant code into
    something that matches nothing.
    """
    return word.capitalize() if word.islower() else word


def parse(filename: str) -> FilenameMetadata:
    """
    Best-effort metadata from a filename. Never raises, never guesses wildly.

    Fields it cannot establish are left None rather than filled with a plausible
    default: a blank the admin notices is better than a wrong value they don't.
    """
    result = FilenameMetadata()
    if not filename:
        return result

    stem = re.sub(r"\.[a-z0-9]{2,5}$", "", filename.strip(), flags=re.I)
    if not stem:
        return result

    words = _split_words(stem)
    norm = [_normalise(w) for w in words]
    # Which words have been claimed by make / category / colour / year, so the
    # leftovers really are only the model and variant.
    claimed = [False] * len(words)

    def claim_run(target: str) -> int | None:
        """
        Index of the first word of the consecutive run spelling `target`.

        Matching a run of whole words rather than a substring of the whole name
        is what stops "MG" being found inside "IMG_20240513" and filing a camera
        snapshot under a manufacturer.
        """
        for start in range(len(norm)):
            if claimed[start]:
                continue
            joined = ""
            for end in range(start, len(norm)):
                if claimed[end]:
                    break
                joined += norm[end]
                if joined == target:
                    for i in range(start, end + 1):
                        claimed[i] = True
                    return start
                if not target.startswith(joined):
                    break
        return None

    # Make first — it anchors where the model name starts. Longest first, so
    # "Maruti Suzuki" is preferred over the "Suzuki" inside it.
    for make in _MAKES:
        if claim_run(_normalise(make)) is not None:
            result.make = make
            break

    for index, word in enumerate(words):
        if not claimed[index] and _YEAR.fullmatch(word):
            result.model_year = int(word)
            claimed[index] = True
            break

    for target, category in _CATEGORY_WORDS:
        if claim_run(target) is not None:
            result.image_category = category
            break

    for colour in _COLOURS:
        if claim_run(colour) is not None:
            result.colour = colour.capitalize()
            break

    # Whatever is left, in filename order, is the model then the variant.
    leftover = [
        words[i] for i in range(len(words))
        if not claimed[i] and norm[i] and not norm[i].isdigit()
    ]

    if leftover:
        result.model = _for_display(leftover[0])
        if len(leftover) > 1:
            # Everything after the model is the variant: "Fearless Plus DCA"
            # is three words and truncating it to one would misfile the image.
            result.variant = " ".join(_for_display(w) for w in leftover[1:])

    return result
