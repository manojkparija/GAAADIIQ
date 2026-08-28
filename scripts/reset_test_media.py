#!/usr/bin/env python3
"""
Cut the catalogue down to a handful of models, for a repeatable e2e run.

    # See what would go, change nothing (the default)
    python scripts/reset_test_media.py

    # Remove the images
    python scripts/reset_test_media.py --apply

    # Remove the images AND the catalogue rows, leaving only the kept models
    python scripts/reset_test_media.py --apply --include-cars

WHY A SCRIPT AND NOT PASTED SQL

Three tables hold images and they have to be emptied in a particular order,
because `vehicle_media_versions.media_id` has no ON DELETE CASCADE — deleting
vehicle_media first fails on a foreign key. Getting that order wrong by hand
produces a half-finished reset that looks like a bad delete.

WHAT THIS CANNOT DO

Some images are not in the database at all. A catalogue card resolves its
picture in three steps (cars-data.service.ts:316):

    apiImgs (from vehicle_media)  ->  localImagesFor(make, model)  ->  placeholder

The middle one is a set of SVGs bundled into the Angular app under assets/ and
matched by make+model. No SQL removes those: they ship in the build. A model
with a local asset keeps showing a picture after a complete database wipe,
which looks exactly like the delete having failed. It has not.

Nor does this touch Supabase Storage. Rows go, objects stay. That matters for
re-upload tests: vehicle_media.storage_key is UNIQUE, so re-uploading bytes
that produce the same key still collides with the leftover object even though
its row is gone.
"""
import argparse
import asyncio
import os
import sys

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine

DEFAULT_KEEP = ["S-Presso", "Fronx", "e Vitara", "Grand Vitara"]


def normalise(names: list[str]) -> list[str]:
    """Match the way the SQL compares: trimmed and lower-cased."""
    return [n.strip().lower() for n in names if n.strip()]


async def counts(conn, keep: list[str]) -> dict[str, int]:
    """What is there now, split into kept and doomed."""
    out: dict[str, int] = {}

    out["car_images_total"] = (await conn.execute(
        sa.text("SELECT count(*) FROM public.car_images"))).scalar() or 0
    out["car_images_doomed"] = (await conn.execute(sa.text("""
        SELECT count(*) FROM public.car_images i
         WHERE NOT EXISTS (
           SELECT 1 FROM public.cars c
            WHERE c.id = i.car_id
              AND lower(btrim(c.model)) = ANY(:keep))
    """), {"keep": keep})).scalar() or 0

    out["vehicle_media_total"] = (await conn.execute(
        sa.text("SELECT count(*) FROM public.vehicle_media"))).scalar() or 0
    out["vehicle_media_doomed"] = (await conn.execute(sa.text("""
        SELECT count(*) FROM public.vehicle_media
         WHERE NOT (lower(btrim(coalesce(model, ''))) = ANY(:keep))
    """), {"keep": keep})).scalar() or 0

    out["cars_total"] = (await conn.execute(
        sa.text("SELECT count(*) FROM public.cars"))).scalar() or 0
    out["cars_doomed"] = (await conn.execute(sa.text("""
        SELECT count(*) FROM public.cars
         WHERE NOT (lower(btrim(model)) = ANY(:keep))
    """), {"keep": keep})).scalar() or 0

    # Listings block a car's deletion: listings.car_id has no ON DELETE, so
    # the delete raises rather than cascading. Counted separately because
    # removing someone's advert is a bigger act than removing a catalogue row,
    # and the operator should see the number before agreeing to it.
    out["listings_blocking"] = (await conn.execute(sa.text("""
        SELECT count(*) FROM public.listings l
         WHERE EXISTS (
           SELECT 1 FROM public.cars c
            WHERE c.id = l.car_id
              AND NOT (lower(btrim(c.model)) = ANY(:keep)))
    """), {"keep": keep})).scalar() or 0

    return out


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    ap.add_argument("--keep", default=",".join(DEFAULT_KEEP),
                    help=f"Comma-separated models to keep. Default: {', '.join(DEFAULT_KEEP)}")
    ap.add_argument("--include-cars", action="store_true",
                    help="Also delete the catalogue rows, not just their images. "
                         "Deletes the listings that point at them, which would "
                         "otherwise block it.")
    ap.add_argument("--apply", action="store_true",
                    help="Actually delete. Without this nothing is written.")
    args = ap.parse_args()

    if not args.database_url:
        print("Set DATABASE_URL or pass --database-url", file=sys.stderr)
        return 1

    keep = normalise(args.keep.split(","))
    if not keep:
        print("--keep is empty; refusing to delete everything", file=sys.stderr)
        return 1

    url = args.database_url
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)

    engine = create_async_engine(url)
    async with engine.begin() as conn:
        before = await counts(conn, keep)

        print(f"keeping: {', '.join(keep)}\n")
        print(f"  car_images      {before['car_images_doomed']:>5} of "
              f"{before['car_images_total']:>5} would go")
        print(f"  vehicle_media   {before['vehicle_media_doomed']:>5} of "
              f"{before['vehicle_media_total']:>5} would go")
        if args.include_cars:
            print(f"  cars            {before['cars_doomed']:>5} of "
                  f"{before['cars_total']:>5} would go")
            print(f"  listings        {before['listings_blocking']:>5} would go with them "
                  f"(they block the car delete)")
        else:
            print(f"  cars            {before['cars_total']:>5} kept "
                  f"(pass --include-cars to remove {before['cars_doomed']})")

        if not args.apply:
            print("\nNothing written. Re-run with --apply.")
            await engine.dispose()
            return 0

        # Order matters. vehicle_media_versions.media_id has no ON DELETE
        # CASCADE, so vehicle_media cannot go first. vehicle_media_audit and
        # listing_media do cascade and need no statement.
        await conn.execute(sa.text("""
            DELETE FROM public.car_images i
             WHERE NOT EXISTS (
               SELECT 1 FROM public.cars c
                WHERE c.id = i.car_id
                  AND lower(btrim(c.model)) = ANY(:keep))
        """), {"keep": keep})

        await conn.execute(sa.text("""
            DELETE FROM public.vehicle_media_versions v
             WHERE EXISTS (
               SELECT 1 FROM public.vehicle_media m
                WHERE m.id = v.media_id
                  AND NOT (lower(btrim(coalesce(m.model, ''))) = ANY(:keep)))
        """), {"keep": keep})

        await conn.execute(sa.text("""
            DELETE FROM public.vehicle_media
             WHERE NOT (lower(btrim(coalesce(model, ''))) = ANY(:keep))
        """), {"keep": keep})

        if args.include_cars:
            # Listings first, for the same reason as versions above: the
            # foreign key has no ON DELETE, so the car delete raises while
            # they exist.
            await conn.execute(sa.text("""
                DELETE FROM public.listings l
                 WHERE EXISTS (
                   SELECT 1 FROM public.cars c
                    WHERE c.id = l.car_id
                      AND NOT (lower(btrim(c.model)) = ANY(:keep)))
            """), {"keep": keep})

            await conn.execute(sa.text("""
                DELETE FROM public.cars
                 WHERE NOT (lower(btrim(model)) = ANY(:keep))
            """), {"keep": keep})

        after = await counts(conn, keep)

    await engine.dispose()

    # Report what is left, not what was asked for. A delete that ran and
    # changed nothing reads identically to one that worked, and this whole
    # exercise started with a screen that could not tell those apart.
    print("\nafter:")
    print(f"  car_images      {after['car_images_total']:>5}")
    print(f"  vehicle_media   {after['vehicle_media_total']:>5}")
    print(f"  cars            {after['cars_total']:>5}")

    leftover = after["car_images_doomed"] + after["vehicle_media_doomed"]
    if args.include_cars:
        leftover += after["cars_doomed"]
    if leftover:
        print(f"\n{leftover} row(s) that should have gone are still there. "
              f"Something refused the delete — check for a foreign key or a "
              f"row-level security policy.")
        return 1

    print("\nRemember: models with a bundled SVG under assets/ keep showing a "
          "picture regardless. That is the app, not the database.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
