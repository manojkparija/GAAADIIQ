#!/usr/bin/env python3
"""
Put model names in the catalogue so the admin dropdowns offer them.

    python scripts/seed_catalogue_models.py --year 2026 --dry-run
    python scripts/seed_catalogue_models.py --year 2026

WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT

The upload screen's Manufacturer and Model pickers are built from
/cars/catalogue/options, which reads the distinct make/model/year already in
the `cars` table. A model no row mentions is not offered, which is why several
manufacturers look half-empty.

So this inserts one bare row per (make, model, year): make, model and year are
the only NOT NULL columns on Car, and they are the three the picker and the
image join actually use.

It sets NO PRICE, and that is the point rather than an omission:

  - New Cars renders priced models only (priced_only=true), so an imported row
    is invisible to buyers until a person prices it. A list that has not been
    verified yet cannot mislead anyone from here.
  - A price is a figure a buyer budgets against. Nothing in this repo invents
    one — see services/credit_bureau.py and the insurer-premium work for the
    same rule applied elsewhere.

It also sets no body type, fuel, transmission or specs. Those are per-variant
facts, they would be guesses at this level, and a blank an admin notices beats
a wrong value they do not.

IDEMPOTENT, AND NON-DESTRUCTIVE

A row matching make + model + year (case-insensitively, trimmed) is left
completely alone — not updated, not re-priced, not touched. Run it twice and
the second run reports every model as already present. That matters because
the obvious failure mode of a seed script is overwriting curated data on a
re-run.

SPELLING IS LOAD-BEARING

Images resolve onto catalogue cars by make + model + year, all three exact
(services/media_library.py). A model spelled differently here than on the
upload form silently detaches its gallery with no error. --dry-run prints what
would be created so the spellings can be read before anything is written.
"""
import argparse
import asyncio
import csv
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "apps" / "api"))

import sqlalchemy as sa  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

DEFAULT_CSV = Path(__file__).resolve().parent / "data" / "indian_car_models.csv"


def read_models(path: Path) -> list[tuple[str, str]]:
    """(make, model) pairs, skipping comments, the header and blank lines."""
    pairs: list[tuple[str, str]] = []
    with path.open() as fh:
        rows = csv.reader(line for line in fh if not line.lstrip().startswith("#"))
        for row in rows:
            if len(row) < 2:
                continue
            make, model = row[0].strip(), row[1].strip()
            if not make or not model or make.lower() == "make":
                continue
            pairs.append((make, model))
    return pairs


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--year", type=int, required=True,
                    help="Model year to file these under. One row per model.")
    ap.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    ap.add_argument("--dry-run", action="store_true",
                    help="Print what would be created and write nothing.")
    ap.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    args = ap.parse_args()

    pairs = read_models(args.csv)
    if not pairs:
        print(f"No models read from {args.csv}", file=sys.stderr)
        return 1

    if not args.database_url:
        print("Set DATABASE_URL or pass --database-url", file=sys.stderr)
        return 1

    url = args.database_url
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)

    engine = create_async_engine(url)
    created, existing = [], []

    async with engine.begin() as conn:
        for make, model in pairs:
            # Matched the way the rest of the codebase matches a vehicle:
            # trimmed and case-insensitive, so "Grand Vitara " and
            # "grand vitara" do not become second rows for the same car.
            found = (await conn.execute(sa.text(
                "SELECT 1 FROM cars "
                "WHERE lower(trim(make)) = :make AND lower(trim(model)) = :model "
                "  AND year = :year LIMIT 1"
            ), {"make": make.lower(), "model": model.lower(), "year": args.year})).scalar()

            if found:
                existing.append(f"{make} {model}")
                continue

            created.append(f"{make} {model}")
            if not args.dry_run:
                await conn.execute(sa.text(
                    "INSERT INTO cars (id, make, model, year, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :make, :model, :year, now(), now())"
                ), {"make": make, "model": model, "year": args.year})

    await engine.dispose()

    verb = "would create" if args.dry_run else "created"
    print(f"{len(existing)} already in the catalogue, {verb} {len(created)}.")
    for name in created:
        print(f"  + {name} {args.year}")
    if args.dry_run and created:
        print("\nRead those spellings before running without --dry-run: an image "
              "gallery attaches by make + model + year, all three exact.")
    if not args.dry_run and created:
        print("\nNone of these carry a price, so New Cars will not show them "
              "until one is set. Price them under /admin/pricing or /admin/variants.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
