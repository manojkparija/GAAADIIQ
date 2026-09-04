"""Monthly AI Diagnosis allowance counter.

WHY A TABLE RATHER THAN A COUNT OVER vehicle_diagnoses

`vehicle_diagnoses.user_id` is a FK into this backend's `users`, and sign-in is
Supabase's. The two stores are unlinked, so a caller who signed in through
Supabase and has no local row stores NULL there (see
`routers/diagnosis._known_user_id`). A quota counted off that column would be
unenforceable for exactly the users who make up ordinary traffic.

This counter is keyed on the verified token's email claim instead — the one
field both stores agree on — falling back to "id:<uuid>" for a token carrying
no email.

WHY period IS TEXT

"YYYY-MM" in UTC, so "this month" is an equality test rather than a range, and
the unique constraint does the deduplication. A new month has no row yet, which
is a fresh allowance: there is no reset job to forget to schedule.

Revision ID: 0050
Revises: 0049
"""
import sqlalchemy as sa

from alembic import op

revision = "0050"
down_revision = "0049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "diagnosis_usage",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("subject", sa.String(length=320), nullable=False),
        sa.Column("period", sa.String(length=7), nullable=False),
        sa.Column("used", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("subject", "period", name="uq_diagnosis_usage_subject_period"),
    )
    op.create_index("ix_diagnosis_usage_subject", "diagnosis_usage", ["subject"])


def downgrade() -> None:
    op.drop_index("ix_diagnosis_usage_subject", table_name="diagnosis_usage")
    op.drop_table("diagnosis_usage")
