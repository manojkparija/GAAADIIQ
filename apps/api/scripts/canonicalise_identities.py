#!/usr/bin/env python
"""Bring existing catalogue and media rows onto one spelling per manufacturer.

New writes are canonicalised at the point they are made (routers/cars.py,
routers/media_admin.py). This is for what is already stored — the rows that
produced:

    cars  | Maruti        | SPRESSO  | 2020
    cars  | Maruti Suzuki | S-Presso | 2026

Photographs find their car by matching make + model + year exactly, so those
two are different vehicles and neither can see the other's gallery.

Dry run by default. Nothing is written until `--apply` is passed, because this
edits the key that images are matched on and getting it wrong detaches
galleries rather than merely renaming things.

    python scripts/canonicalise_identities.py                    # report
    python scripts/canonicalise_identities.py --apply            # write

Model names are reported, never rewritten: "SPRESSO" and "S-Presso" may be the
same car or may not, and the tool that guesses wrong files a photograph against
the wrong vehicle. Merging those is a human decision, and the report gives the
SQL to do it.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine  # noqa: E402

from core.config import settings  # noqa: E402
from models.car import Car  # noqa: E402
from models.vehicle_media import VehicleMedia  # noqa: E402
from services import vehicle_identity  # noqa: E402


async def _rename_makes(db: AsyncSession, apply: bool) -> int:
    """Rewrite every make to its canonical spelling."""
    changed = 0
    for table, label in ((Car, "cars"), (VehicleMedia, "vehicle_media")):
        rows = (await db.execute(select(table))).scalars().all()
        for row in rows:
            canonical = vehicle_identity.canonical_make(row.make)
            if canonical and canonical != row.make:
                print(f"  {label}: {row.make!r} -> {canonical!r}")
                if apply:
                    row.make = canonical
                changed += 1
    return changed


async def _report_model_variants(db: AsyncSession) -> None:
    """List model names that differ only in spelling, for a human to resolve."""
    seen: dict[tuple[str, str], set[str]] = defaultdict(set)
    for table in (Car, VehicleMedia):
        rows = (await db.execute(select(table))).scalars().all()
        for row in rows:
            make = vehicle_identity.canonical_make(row.make)
            if not make or not row.model:
                continue
            key = (make, vehicle_identity.canonical_model(row.model).lower().replace("-", "").replace(" ", ""))
            seen[key].add(row.model.strip())

    clashes = {k: v for k, v in seen.items() if len(v) > 1}
    if not clashes:
        print("\nNo model names differ only by spelling.")
        return

    print("\nModel names that look like the same car spelled differently.")
    print("Not changed automatically — pick one and merge deliberately:\n")
    for (make, _), spellings in sorted(clashes.items()):
        options = sorted(spellings)
        print(f"  {make}: {' | '.join(repr(s) for s in options)}")
        keep, *rest = options
        for drop in rest:
            print(f"    UPDATE cars SET model = '{keep}' "
                  f"WHERE make = '{make}' AND model = '{drop}';")
            print(f"    UPDATE vehicle_media SET model = '{keep}' "
                  f"WHERE make = '{make}' AND model = '{drop}';")


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true",
                        help="write the changes (default is a dry run)")
    args = parser.parse_args()

    engine = create_async_engine(settings.async_database_url)
    async with AsyncSession(engine) as db:
        print("Manufacturer spellings:" if args.apply else "Manufacturer spellings (dry run):")
        changed = await _rename_makes(db, args.apply)
        if changed == 0:
            print("  every make is already canonical.")

        await _report_model_variants(db)

        if args.apply and changed:
            await db.commit()
            print(f"\nCommitted {changed} make change(s).")
        elif changed:
            print(f"\n{changed} make change(s) would be made. Re-run with --apply.")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
