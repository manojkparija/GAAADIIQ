#!/usr/bin/env python3
"""
Upload Maruti Suzuki Swift Dzire brochure images to GAADIIQ.

Usage:
  python upload_dzire_images.py --api-url https://api.gaadiiq.com \
      --email admin@gaadiiq.com --password <pass> \
      --images-dir /path/to/dzire_rgb

The script:
  1. Authenticates and gets a Bearer token
  2. Uploads each image to POST /upload/image
  3. Prints a manifest of all uploaded URLs with metadata
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import requests

# ── Image manifest ────────────────────────────────────────────────────────────
# Derived from ArenaDzireBrochure.pdf (pages 1–6)
# Variants in this brochure: LXi MT | VXi MT | VXi AMT | VXi CNG MT |
#   ZXi MT | ZXi AMT | ZXi CNG MT | ZXi+ MT | ZXi+ AMT
# Since brochure photos show the top-spec ZXi+ externally and interior
# features apply across variants, images are mapped to "All Variants".

IMAGES: list[dict] = [
    # ── Page 1 — Cover ────────────────────────────────────────────────────
    {
        "file": "img-000.jpg",
        "page": 1,
        "order": 1,
        "category": "Exterior",
        "description": "Cover shot – Swift Dzire 3/4 front view (Gallant Red)",
        "variants": ["All"],
        "color": "Gallant Red",
    },

    # ── Page 2 — Exterior Features ────────────────────────────────────────
    {
        "file": "img-004.jpg",
        "page": 2,
        "order": 2,
        "category": "Exterior",
        "description": "Exterior feature page – Swift Dzire rear-3/4 view",
        "variants": ["All"],
        "color": "Gallant Red",
    },
    {
        "file": "img-008.jpg",
        "page": 2,
        "order": 3,
        "category": "Exterior",
        "description": "Front fascia / bold grille",
        "variants": ["All"],
        "color": None,
    },
    {
        "file": "img-009.jpg",
        "page": 2,
        "order": 4,
        "category": "Exterior",
        "description": "LED projector headlamps with DRLs",
        "variants": ["ZXi MT", "ZXi AMT", "ZXi CNG MT", "ZXi+ MT", "ZXi+ AMT"],
        "color": None,
    },
    {
        "file": "img-010.jpg",
        "page": 2,
        "order": 5,
        "category": "Exterior",
        "description": "16-inch alloy wheels",
        "variants": ["ZXi+ MT", "ZXi+ AMT"],
        "color": None,
    },
    {
        "file": "img-011.jpg",
        "page": 2,
        "order": 6,
        "category": "Exterior",
        "description": "Shark fin antenna / rear spoiler",
        "variants": ["All"],
        "color": None,
    },
    {
        "file": "img-012.jpg",
        "page": 2,
        "order": 7,
        "category": "Exterior",
        "description": "LED tail lamps",
        "variants": ["ZXi MT", "ZXi AMT", "ZXi CNG MT", "ZXi+ MT", "ZXi+ AMT"],
        "color": None,
    },
    {
        "file": "img-013.jpg",
        "page": 2,
        "order": 8,
        "category": "Exterior",
        "description": "Body-coloured ORVM with turn indicators",
        "variants": ["VXi MT", "VXi AMT", "VXi CNG MT", "ZXi MT", "ZXi AMT", "ZXi CNG MT", "ZXi+ MT", "ZXi+ AMT"],
        "color": None,
    },

    # ── Page 3 — Interior Features ────────────────────────────────────────
    {
        "file": "img-014.jpg",
        "page": 3,
        "order": 9,
        "category": "Interior",
        "description": "Interior feature page – cabin overview",
        "variants": ["All"],
        "color": None,
    },
    {
        "file": "img-021.jpg",
        "page": 3,
        "order": 10,
        "category": "Interior",
        "description": "Smart sunroof",
        "variants": ["ZXi+ MT", "ZXi+ AMT"],
        "color": None,
    },
    {
        "file": "img-022.jpg",
        "page": 3,
        "order": 11,
        "category": "Interior",
        "description": "Dual-tone dashboard / automatic climate control",
        "variants": ["ZXi MT", "ZXi AMT", "ZXi CNG MT", "ZXi+ MT", "ZXi+ AMT"],
        "color": None,
    },
    {
        "file": "img-023.jpg",
        "page": 3,
        "order": 12,
        "category": "Interior",
        "description": "Rear AC vent",
        "variants": ["ZXi MT", "ZXi AMT", "ZXi CNG MT", "ZXi+ MT", "ZXi+ AMT"],
        "color": None,
    },
    {
        "file": "img-024.jpg",
        "page": 3,
        "order": 13,
        "category": "Interior",
        "description": "Rear passenger cabin / seat comfort",
        "variants": ["All"],
        "color": None,
    },
    {
        "file": "img-025.jpg",
        "page": 3,
        "order": 14,
        "category": "Interior",
        "description": "Cruise control stalk",
        "variants": ["ZXi MT", "ZXi AMT", "ZXi CNG MT", "ZXi+ MT", "ZXi+ AMT"],
        "color": None,
    },
    {
        "file": "img-026.jpg",
        "page": 3,
        "order": 15,
        "category": "Interior",
        "description": "Infotainment / SmartPlay Pro+ touchscreen",
        "variants": ["ZXi MT", "ZXi AMT", "ZXi CNG MT", "ZXi+ MT", "ZXi+ AMT"],
        "color": None,
    },

    # ── Page 4 — Technology & Safety ─────────────────────────────────────
    {
        "file": "img-027.jpg",
        "page": 4,
        "order": 16,
        "category": "Features",
        "description": "Technology & safety feature page overview",
        "variants": ["All"],
        "color": None,
    },
    {
        "file": "img-034.jpg",
        "page": 4,
        "order": 17,
        "category": "Safety",
        "description": "6 airbags",
        "variants": ["ZXi+ MT", "ZXi+ AMT"],
        "color": None,
    },
    {
        "file": "img-035.jpg",
        "page": 4,
        "order": 18,
        "category": "Features",
        "description": "360-degree surround-view camera",
        "variants": ["ZXi+ MT", "ZXi+ AMT"],
        "color": None,
    },
    {
        "file": "img-036.jpg",
        "page": 4,
        "order": 19,
        "category": "Safety",
        "description": "High-strength steel structure / TECT body",
        "variants": ["All"],
        "color": None,
    },
    {
        "file": "img-037.jpg",
        "page": 4,
        "order": 20,
        "category": "Features",
        "description": "AGS (Auto Gear Shift) / AMT gear selector",
        "variants": ["VXi AMT", "ZXi AMT", "ZXi+ AMT"],
        "color": None,
    },
    {
        "file": "img-038.jpg",
        "page": 4,
        "order": 21,
        "category": "Features",
        "description": "Wireless smartphone charger",
        "variants": ["ZXi+ MT", "ZXi+ AMT"],
        "color": None,
    },
    {
        "file": "img-039.jpg",
        "page": 4,
        "order": 22,
        "category": "Features",
        "description": "Suzuki Connect telematics",
        "variants": ["ZXi MT", "ZXi AMT", "ZXi CNG MT", "ZXi+ MT", "ZXi+ AMT"],
        "color": None,
    },

    # ── Page 5 — Color swatches ───────────────────────────────────────────
    {
        "file": "img-040.jpg",
        "page": 5,
        "order": 23,
        "category": "Colors",
        "description": "Color swatch – Gallant Red",
        "variants": ["LXi MT", "VXi MT", "VXi AMT", "VXi CNG MT", "ZXi MT", "ZXi AMT", "ZXi CNG MT", "ZXi+ MT", "ZXi+ AMT"],
        "color": "Gallant Red",
    },
    {
        "file": "img-041.jpg",
        "page": 5,
        "order": 24,
        "category": "Colors",
        "description": "Color swatch – Alluring Blue",
        "variants": ["LXi MT", "VXi MT", "VXi AMT", "VXi CNG MT", "ZXi MT", "ZXi AMT", "ZXi CNG MT", "ZXi+ MT", "ZXi+ AMT"],
        "color": "Alluring Blue",
    },
    {
        "file": "img-042.jpg",
        "page": 5,
        "order": 25,
        "category": "Colors",
        "description": "Color swatch – Nutmeg Brown",
        "variants": ["LXi MT", "VXi MT", "VXi AMT", "VXi CNG MT", "ZXi MT", "ZXi AMT", "ZXi CNG MT", "ZXi+ MT", "ZXi+ AMT"],
        "color": "Nutmeg Brown",
    },
    {
        "file": "img-043.jpg",
        "page": 5,
        "order": 26,
        "category": "Colors",
        "description": "Color swatch – Bluish Black",
        "variants": ["LXi MT", "VXi MT", "VXi AMT", "VXi CNG MT", "ZXi MT", "ZXi AMT", "ZXi CNG MT", "ZXi+ MT", "ZXi+ AMT"],
        "color": "Bluish Black",
    },
    {
        "file": "img-044.jpg",
        "page": 5,
        "order": 27,
        "category": "Colors",
        "description": "Color swatch – Arctic White",
        "variants": ["LXi MT", "VXi MT", "VXi AMT", "VXi CNG MT", "ZXi MT", "ZXi AMT", "ZXi CNG MT", "ZXi+ MT", "ZXi+ AMT"],
        "color": "Arctic White",
    },
    {
        "file": "img-045.jpg",
        "page": 5,
        "order": 28,
        "category": "Colors",
        "description": "Color swatch – Magma Grey",
        "variants": ["LXi MT", "VXi MT", "VXi AMT", "VXi CNG MT", "ZXi MT", "ZXi AMT", "ZXi CNG MT", "ZXi+ MT", "ZXi+ AMT"],
        "color": "Magma Grey",
    },
    {
        "file": "img-046.jpg",
        "page": 5,
        "order": 29,
        "category": "Colors",
        "description": "Color swatch – Splendid Silver",
        "variants": ["LXi MT", "VXi MT", "VXi AMT", "VXi CNG MT", "ZXi MT", "ZXi AMT", "ZXi CNG MT", "ZXi+ MT", "ZXi+ AMT"],
        "color": "Splendid Silver",
    },

    # ── Page 6 — Back cover ───────────────────────────────────────────────
    {
        "file": "img-047.jpg",
        "page": 6,
        "order": 30,
        "category": "Exterior",
        "description": "Back cover – Swift Dzire lineup overview",
        "variants": ["All"],
        "color": None,
    },
]


def login(api_url: str, email: str, password: str) -> str:
    url = f"{api_url}/auth/login"
    resp = requests.post(url, json={"email": email, "password": password}, timeout=15)
    if resp.status_code != 200:
        raise SystemExit(
            f"Login failed — HTTP {resp.status_code}\n"
            f"URL: {url}\n"
            f"Response: {resp.text[:500]}"
        )
    try:
        data = resp.json()
    except Exception:
        raise SystemExit(
            f"Login response is not JSON (wrong API URL?)\n"
            f"URL: {url}\n"
            f"Response: {resp.text[:500]}"
        )
    if "access_token" not in data:
        raise SystemExit(f"No access_token in response: {data}")
    return data["access_token"]


def upload_image(api_url: str, token: str, image_path: Path) -> str:
    with open(image_path, "rb") as f:
        resp = requests.post(
            f"{api_url}/upload/image",
            headers={"Authorization": f"Bearer {token}"},
            files={"file": (image_path.name, f, "image/jpeg")},
            timeout=60,
        )
    resp.raise_for_status()
    return resp.json()["url"]


def main():
    parser = argparse.ArgumentParser(description="Upload Dzire brochure images to GAADIIQ")
    parser.add_argument("--api-url", required=True, help="Base API URL, e.g. https://api.gaadiiq.com")
    parser.add_argument("--email", required=True, help="Dealer/admin email")
    parser.add_argument("--password", required=True, help="Password")
    parser.add_argument("--images-dir", required=True, help="Directory with converted RGB images")
    parser.add_argument("--output", default="dzire_upload_manifest.json", help="Output manifest JSON path")
    parser.add_argument("--dry-run", action="store_true", help="List images without uploading")
    args = parser.parse_args()

    images_dir = Path(args.images_dir)
    results = []

    if args.dry_run:
        print(f"DRY RUN — {len(IMAGES)} images to upload:\n")
        for img in IMAGES:
            path = images_dir / img["file"]
            exists = "✓" if path.exists() else "✗ MISSING"
            print(f"  [{exists}] {img['file']:20s}  Page {img['page']}  "
                  f"{img['category']:10s}  {img['description']}")
        return

    print(f"Logging in to {args.api_url} …")
    token = login(args.api_url, args.email, args.password)
    print("  ✓ Authenticated\n")

    for i, img in enumerate(IMAGES, 1):
        path = images_dir / img["file"]
        if not path.exists():
            print(f"  [{i:02d}/{len(IMAGES)}] SKIP (missing) {img['file']}")
            continue

        try:
            url = upload_image(args.api_url, token, path)
            result = {**img, "url": url, "status": "ok"}
            results.append(result)
            print(f"  [{i:02d}/{len(IMAGES)}] ✓  {img['file']:20s}  {img['category']:10s}  {url}")
        except Exception as exc:
            result = {**img, "url": None, "status": f"error: {exc}"}
            results.append(result)
            print(f"  [{i:02d}/{len(IMAGES)}] ✗  {img['file']:20s}  ERROR: {exc}")

        time.sleep(0.3)  # polite pacing

    # Write manifest
    manifest = {
        "manufacturer": "Maruti Suzuki",
        "model": "Swift Dzire",
        "model_year": 2024,
        "source": "ArenaDzireBrochure.pdf",
        "total_images": len(IMAGES),
        "uploaded": sum(1 for r in results if r.get("status") == "ok"),
        "failed": sum(1 for r in results if r.get("status", "").startswith("error")),
        "categories": {
            "Exterior": sum(1 for r in results if r.get("category") == "Exterior"),
            "Interior": sum(1 for r in results if r.get("category") == "Interior"),
            "Features": sum(1 for r in results if r.get("category") == "Features"),
            "Safety": sum(1 for r in results if r.get("category") == "Safety"),
            "Colors": sum(1 for r in results if r.get("category") == "Colors"),
        },
        "images": results,
    }

    with open(args.output, "w") as f:
        json.dump(manifest, f, indent=2, default=str)

    print(f"\n{'='*60}")
    print(f"  Uploaded : {manifest['uploaded']}/{manifest['total_images']}")
    print(f"  Failed   : {manifest['failed']}")
    print(f"  Manifest : {args.output}")
    print(f"  Categories: {manifest['categories']}")


if __name__ == "__main__":
    main()
