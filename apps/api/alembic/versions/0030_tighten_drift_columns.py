"""Finish 0029: apply NOT NULL and the foreign keys where the data allows.

0029 restored 79 columns production was missing, but deliberately stopped short
on sixteen of them. Those are NOT NULL in the migration chain with no default,
so making them NOT NULL means every existing row must already have a value —
and a repair migration cannot invent a manufacturer or a problem description to
satisfy a constraint. Three of the sixteen are also foreign keys, where the
constraint would fail against any orphan row.

The reason for stopping was never that tightening is wrong; it was that it
depends on data this repository cannot see.

SO THIS ASKS THE DATABASE

Each column is tightened only if the table currently holds no NULLs in it. Each
foreign key is added only if no row points at a parent that is not there. Where
the data does not allow it, the migration says so and moves on rather than
failing the deploy — a schema repair that aborts halfway leaves production in a
state nobody chose, and this runs in Render's pre-deploy step where a failure
takes the release with it.

On an empty or clean database — which is what CI builds, and what production
should be for the diagnosis tables, since they could not have been written to
while their columns were missing — everything here applies and the schema ends
up identical to a fresh `alembic upgrade head`.

Where it does not apply, the skip is logged with the column and the row count,
so the follow-up is a decision about real rows rather than a guess.

The counting and the decision are done in Python rather than in a DO block on
purpose. The first version of this migration raised NOTICE from PL/pgSQL, which
reads correctly and does nothing useful: asyncpg drops notices unless a handler
is attached, so nothing appeared in the deploy log and a skipped column looked
exactly like an applied one. A migration that silently declines to do half its
job is worse than one that never claimed to. `alembic.runtime.migration` is the
logger Render already surfaces, so the skips land beside the INFO lines the
operator is reading anyway.

Revision ID: 0030
Revises: 0029
"""
import logging

import sqlalchemy as sa

from alembic import op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")


# (table, column) — NOT NULL in the chain, no default to backfill with.
NOT_NULL_COLUMNS = [
    ("customer_intent_scores", "budget_fit_score"),
    ("customer_intent_scores", "engagement_score"),
    ("customer_intent_scores", "sentiment_score"),
    ("customer_intent_scores", "urgency_score"),
    ("diagnosis_audit_events", "occurred_at"),
    ("vehicle_diagnoses", "fuel_type"),
    ("vehicle_diagnoses", "manufacturer"),
    ("vehicle_diagnoses", "model"),
    ("vehicle_diagnoses", "model_year"),
    ("vehicle_diagnoses", "problem_description"),
    ("vehicle_diagnoses", "severity"),
    ("vehicle_diagnoses", "transmission"),
    ("voice_transcripts", "text"),
]

# (table, column, parent_table, constraint_name) — all ON DELETE CASCADE, matching
# what the chain builds. These get NOT NULL as well, after the constraint.
FOREIGN_KEYS = [
    ("customer_activities", "dealer_id", "dealers", "customer_activities_dealer_id_fkey"),
    ("customer_intent_scores", "dealer_id", "dealers", "customer_intent_scores_dealer_id_fkey"),
    ("voice_transcripts", "conversation_id", "diagnosis_conversations", "voice_transcripts_conversation_id_fkey"),
]


def _column_exists(bind, table: str, column: str) -> bool:
    return bool(
        bind.scalar(
            sa.text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name = :t AND column_name = :c"
            ),
            {"t": table, "c": column},
        )
    )


def _set_not_null(bind, table: str, column: str) -> None:
    if not _column_exists(bind, table, column):
        log.info("0030: %s.%s absent, skipping", table, column)
        return

    # Identifiers are from the literal lists above, never from input.
    offending = bind.scalar(
        sa.text(f'SELECT count(*) FROM {table} WHERE "{column}" IS NULL')
    )
    if offending:
        # Deliberately not an error. Filling these means deciding what the
        # missing value should have been, which is a data decision made with
        # the rows in front of you, not something a deploy step should guess at
        # while holding the release open.
        log.warning(
            "0030: %s.%s has %d NULL row(s), leaving it nullable — "
            "backfill them and re-run to tighten",
            table,
            column,
            offending,
        )
        return

    op.execute(f'ALTER TABLE {table} ALTER COLUMN "{column}" SET NOT NULL')


def _add_foreign_key(bind, table: str, column: str, parent: str, name: str) -> bool:
    """Return True if the constraint is in place when this returns."""
    if not _column_exists(bind, table, column):
        log.info("0030: %s.%s absent, skipping foreign key", table, column)
        return False

    if bind.scalar(
        sa.text("SELECT 1 FROM pg_constraint WHERE conname = :n"), {"n": name}
    ):
        return True  # already there; a fresh database arrives like this

    orphans = bind.scalar(
        sa.text(
            f"SELECT count(*) FROM {table} c "
            f"LEFT JOIN {parent} p ON c.{column} = p.id "
            f"WHERE c.{column} IS NOT NULL AND p.id IS NULL"
        )
    )
    if orphans:
        # An orphan means the parent was deleted while this column did not
        # exist to cascade from. Adding the constraint would abort the
        # migration; deleting the rows to make it fit would destroy data to
        # satisfy a constraint, which is the wrong way round.
        log.warning(
            "0030: %s.%s has %d row(s) referencing a missing %s, "
            "leaving the foreign key off",
            table,
            column,
            orphans,
            parent,
        )
        return False

    op.execute(
        f"ALTER TABLE {table} ADD CONSTRAINT {name} "
        f"FOREIGN KEY ({column}) REFERENCES {parent}(id) ON DELETE CASCADE"
    )
    return True


def upgrade() -> None:
    bind = op.get_bind()

    for table, column in NOT_NULL_COLUMNS:
        _set_not_null(bind, table, column)

    for table, column, parent, name in FOREIGN_KEYS:
        if _add_foreign_key(bind, table, column, parent, name):
            # Only once the constraint holds. Tightening a column that still
            # carries orphan-producing NULLs would fail for a different reason
            # than the one being reported.
            _set_not_null(bind, table, column)


def downgrade() -> None:
    for table, column, _parent, name in FOREIGN_KEYS:
        op.execute(f'ALTER TABLE {table} ALTER COLUMN "{column}" DROP NOT NULL')
        op.execute(f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {name}")
    for table, column in NOT_NULL_COLUMNS:
        op.execute(f'ALTER TABLE {table} ALTER COLUMN "{column}" DROP NOT NULL')
