"""Review audit trail for the diagnosis knowledge base.

0032 gave rows two gates — ACTIVE and VERIFIED — but nothing that records who
opened them. `reviewed_by` on the master row holds only the *last* name, and
solutions carried no reviewer at all, so a solution could become servable with
no trace of who decided that.

This adds:

  * diagnosis_review_events — append-only, one row per decision
  * diagnosis_master.reviewed_at
  * diagnosis_solutions.reviewed_by / reviewed_at

The check constraint is the part worth reading: a decision is about a diagnosis
or a solution, and a row claiming neither is meaningless while a row claiming
both is ambiguous about what was actually approved.

Revision ID: 0033
Revises: 0032
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


# Values, not names — same reason as 0032 and models/diagnosis_kb.py::_pg_enum.
DECISION_LABELS = ("APPROVED", "REJECTED", "RETURNED")


def _decision_type(is_pg: bool):
    """The column's type, which must NOT try to create the Postgres type again.

    `create_table` emits CREATE TYPE for every Enum column it sees unless told
    not to. Combined with the explicit `.create()` below that is two CREATE TYPE
    statements for one type, and the second fails with DuplicateObjectError —
    which SQLite never reproduces, because it has no CREATE TYPE at all. Found
    by running this migration against real Postgres, not by the test suite.
    """
    if is_pg:
        return postgresql.ENUM(
            *DECISION_LABELS, name="diagnosis_review_decision", create_type=False
        )
    return sa.Enum(*DECISION_LABELS, name="diagnosis_review_decision")


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    if is_pg:
        sa.Enum(*DECISION_LABELS, name="diagnosis_review_decision").create(
            bind, checkfirst=True
        )

    op.add_column(
        "diagnosis_master",
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "diagnosis_solutions",
        sa.Column("reviewed_by", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "diagnosis_solutions",
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "diagnosis_review_events",
        sa.Column("id", postgresql.UUID(as_uuid=True) if is_pg else sa.Uuid(as_uuid=True),
                  primary_key=True, nullable=False),
        sa.Column("diagnosis_id", postgresql.UUID(as_uuid=True) if is_pg else sa.Uuid(as_uuid=True),
                  sa.ForeignKey("diagnosis_master.id", ondelete="CASCADE"), nullable=True),
        sa.Column("solution_id", postgresql.UUID(as_uuid=True) if is_pg else sa.Uuid(as_uuid=True),
                  sa.ForeignKey("diagnosis_solutions.id", ondelete="CASCADE"), nullable=True),
        sa.Column("decision", _decision_type(is_pg), nullable=False),
        sa.Column("reviewer", sa.String(length=255), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("previous_status", sa.String(length=30), nullable=True),
        sa.Column("previous_verification", sa.String(length=30), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        # A decision is about exactly one thing. Neither is meaningless; both is
        # ambiguous about what the reviewer actually signed off.
        sa.CheckConstraint(
            "(diagnosis_id IS NOT NULL) OR (solution_id IS NOT NULL)",
            name="ck_dre_target_present",
        ),
    )

    op.create_index("ix_dre_diagnosis_id", "diagnosis_review_events", ["diagnosis_id"])
    op.create_index("ix_dre_solution_id", "diagnosis_review_events", ["solution_id"])
    op.create_index("ix_dre_decision", "diagnosis_review_events", ["decision"])
    op.create_index("ix_dre_recent", "diagnosis_review_events", ["created_at", "reviewer"])


def downgrade() -> None:
    bind = op.get_bind()
    op.drop_index("ix_dre_recent", table_name="diagnosis_review_events")
    op.drop_index("ix_dre_decision", table_name="diagnosis_review_events")
    op.drop_index("ix_dre_solution_id", table_name="diagnosis_review_events")
    op.drop_index("ix_dre_diagnosis_id", table_name="diagnosis_review_events")
    op.drop_table("diagnosis_review_events")

    op.drop_column("diagnosis_solutions", "reviewed_at")
    op.drop_column("diagnosis_solutions", "reviewed_by")
    op.drop_column("diagnosis_master", "reviewed_at")

    if bind.dialect.name == "postgresql":
        sa.Enum(*DECISION_LABELS, name="diagnosis_review_decision").drop(
            bind, checkfirst=True
        )
