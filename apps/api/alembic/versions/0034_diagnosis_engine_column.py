"""Record which engine answered each diagnosis.

The knowledge base is only as good as its coverage, and until now nothing
recorded coverage. `GET /diagnosis-kb/stats` counts rows — how many exist, how
many are verified — which answers "how big is the corpus" but not the question
that actually matters: *which vehicles are falling through to the model?*

The answer was already computed on every request and thrown away. `run_diagnosis`
returns `engine` (knowledge_base | openai | gemini | ollama | heuristic) and
logs it, but `vehicle_diagnoses` had no column for it, so the history table
could not tell a curated answer from a generated one after the fact.

Two columns, both nullable because every existing row predates them and
back-filling would mean inventing a provenance we do not have:

  * engine          — which rung served it
  * kb_diagnosis_code — the matched row, when the knowledge base served it

Indexed on (manufacturer, model, engine): the coverage report groups by vehicle
and splits by engine, and that is the only shape it is queried in.

Revision ID: 0034
Revises: 0033
"""

import sqlalchemy as sa

from alembic import op

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("vehicle_diagnoses", sa.Column("engine", sa.String(32), nullable=True))
    op.add_column(
        "vehicle_diagnoses", sa.Column("kb_diagnosis_code", sa.String(64), nullable=True)
    )
    op.create_index(
        "ix_vd_coverage",
        "vehicle_diagnoses",
        ["manufacturer", "model", "engine"],
    )


def downgrade() -> None:
    op.drop_index("ix_vd_coverage", table_name="vehicle_diagnoses")
    op.drop_column("vehicle_diagnoses", "kb_diagnosis_code")
    op.drop_column("vehicle_diagnoses", "engine")
