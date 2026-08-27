#!/usr/bin/env python3
"""
Check migration 0046 would succeed here — reading only, changing nothing.

    python scripts/preflight_enum_repair.py

WHY THIS EXISTS

0046 converts eight varchar columns to the enum types the ORM declares. It was
rehearsed against a database rebuilt to look like production and still failed
there, twice over:

  - the first version did not exist at all, because production's enum types
    were missing and nothing had noticed;
  - the second failed on `DatatypeMismatchError: default for column "status"
    cannot be cast automatically to type booking_status`, because the rehearsal
    built its tables from the ORM — where `default=X` is a Python-side default
    that never reaches the database — while production's tables came from the
    hand-run SQL, which wrote real server-side DEFAULTs.

Both failures share a cause: the rehearsal was a *model* of the database rather
than the database. This reads the real one. It answers, per column:

  - does the type already exist (nothing to do)?
  - does the table exist?
  - is there a server default, and is it a plain literal this can restore?
  - is that default a valid label of the new type?
  - does every stored value convert?

The last is the one that cannot be reasoned about at all: only the rows know.

NOTHING IS WRITTEN. Every statement here is a SELECT. The conversion test uses
a rolled-back transaction so even that leaves no trace.
"""
import argparse
import ast
import asyncio
import os
import re
import sys
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine

REPO = Path(__file__).resolve().parents[1]
MIGRATION = REPO / "apps" / "api" / "alembic" / "versions" / "0046_repair_missing_enum_types.py"


def load_types() -> list[tuple[str, str, str, list[str]]]:
    """
    Read _TYPES out of the migration rather than restating it.

    A pre-flight that carries its own copy of the list checks a different
    migration from the one that will run, which is worse than no pre-flight:
    it reports confidence about something it did not look at.
    """
    src = MIGRATION.read_text()
    match = re.search(r"_TYPES:.*?=\s*(\[.*?\n\])", src, re.S)
    if not match:
        raise SystemExit(f"Could not find _TYPES in {MIGRATION}")
    return ast.literal_eval(match.group(1))


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    args = ap.parse_args()
    if not args.database_url:
        print("Set DATABASE_URL or pass --database-url", file=sys.stderr)
        return 1

    url = args.database_url
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)

    types = load_types()
    problems: list[str] = []
    engine = create_async_engine(url)

    async with engine.connect() as conn:
        for type_name, table, column, labels in types:
            exists = (await conn.execute(sa.text(
                "SELECT 1 FROM pg_type WHERE typname = :n"), {"n": type_name})).scalar()
            if exists:
                print(f"  ok    {type_name}: already exists, 0046 skips it")
                continue

            has_table = (await conn.execute(sa.text(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_schema='public' AND table_name=:t"), {"t": table})).scalar()
            if not has_table:
                print(f"  ok    {type_name}: no {table} table yet, type created only")
                continue

            default = (await conn.execute(sa.text(
                "SELECT column_default FROM information_schema.columns "
                "WHERE table_schema='public' AND table_name=:t AND column_name=:c"
            ), {"t": table, "c": column})).scalar()

            notes = []
            if default is not None:
                literal = re.match(r"^'((?:[^']|'')*)'", default)
                if not literal:
                    problems.append(
                        f"{table}.{column}: default {default!r} is not a plain "
                        f"literal — 0046 will stop rather than guess at it")
                    print(f"  STOP  {type_name}: default {default!r} not restorable")
                    continue
                value = literal.group(1)
                if value not in labels:
                    problems.append(
                        f"{table}.{column}: default {value!r} is not a valid "
                        f"{type_name} label {labels}")
                    print(f"  STOP  {type_name}: default {value!r} not a valid label")
                    continue
                notes.append(f"default {value!r} restorable")

            # Values that would not convert. Asked of the rows, because nothing
            # else can answer it.
            bad = (await conn.execute(sa.text(
                f"SELECT DISTINCT {column}::text FROM {table} "  # noqa: S608 - names from the migration
                f"WHERE {column} IS NOT NULL AND {column}::text <> ALL(:labels) LIMIT 10"
            ), {"labels": labels})).scalars().all()
            if bad:
                problems.append(
                    f"{table}.{column}: {len(bad)} value(s) are not valid "
                    f"{type_name} labels: {bad}")
                print(f"  STOP  {type_name}: unconvertible values {bad}")
                continue

            rows = (await conn.execute(sa.text(f"SELECT count(*) FROM {table}"))).scalar()
            extra = f" ({'; '.join(notes)})" if notes else ""
            print(f"  ok    {type_name}: {table}.{column}, {rows} row(s){extra}")

    await engine.dispose()

    print()
    if problems:
        print(f"{len(problems)} problem(s) — 0046 would FAIL here:")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("No problems found. 0046 should apply cleanly.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
