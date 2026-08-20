"""Repair features stored as Python dict reprs

Buyers were shown

    ✓ {'feature': 'Head-Up Display'}
    ✓ {'feature': '9-inch SmartPlay Pro+ Touchscreen'}

on the Features tab. The research cleaner called str() on each item, so when
the language model returned a list of objects rather than a list of strings,
the whole dict was stringified and stored. The cleaner is fixed, but that only
stops new rows going bad — the ones already written stay wrong until something
rewrites them, and re-running research costs model calls and an admin's
attention for every affected model.

So this repairs them in place. Deliberately narrow: it rewrites a value only
when it parses as a dict literal containing exactly one usable string, and
leaves anything it cannot read confidently alone. A feature it cannot repair
stays visibly broken, which is a better outcome than one silently replaced by
a guess.

Revision ID: 0039
Revises: 0038
"""

import ast

import sqlalchemy as sa

from alembic import op

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None

# The keys the model actually used, in the order the cleaner trusts them.
_KEYS = ("feature", "name", "label", "title", "value", "text")


def _repair(value: object) -> str | None:
    """The phrase inside a dict repr, or None when it is not one or is unclear."""
    if not isinstance(value, str):
        return None

    text = value.strip()
    if not (text.startswith("{") and text.endswith("}")):
        return None

    try:
        # literal_eval, not eval: this is stored data, and it must be able to
        # parse a dict literal without being able to run anything.
        parsed = ast.literal_eval(text)
    except (ValueError, SyntaxError):
        return None

    if not isinstance(parsed, dict):
        return None

    for key in _KEYS:
        inner = parsed.get(key)
        if isinstance(inner, str) and inner.strip():
            return inner.strip()[:80]

    strings = [v for v in parsed.values() if isinstance(v, str) and v.strip()]
    if len(strings) == 1:
        return strings[0].strip()[:80]

    # Ambiguous. Leave it: visibly broken beats silently wrong.
    return None


def _repair_table(bind, table: str) -> None:
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return
    if "features" not in {c["name"] for c in inspector.get_columns(table)}:
        return

    rows = bind.execute(
        sa.text(f"SELECT id, features FROM {table} WHERE features IS NOT NULL")  # noqa: S608
    ).fetchall()

    for row_id, features in rows:
        if not isinstance(features, list):
            continue

        repaired = [(_repair(f) or f) for f in features]
        if repaired == list(features):
            continue

        # JSON goes through the dialect's own binding rather than as a string,
        # so a list stays a list on both Postgres and SQLite.
        bind.execute(
            sa.update(sa.table(table, sa.column("id"), sa.column("features", sa.JSON)))
            .where(sa.column("id") == row_id)
            .values(features=repaired)
        )


def upgrade() -> None:
    bind = op.get_bind()
    for table in ("car_variants", "cars"):
        _repair_table(bind, table)


def downgrade() -> None:
    # Not reversible, and should not be: the previous value was a rendering
    # mistake, not information. Putting the dict reprs back would only restore
    # the bug.
    pass
