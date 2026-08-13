"""The diagnosis knowledge base: master findings, their solutions, aliases, import audit.

Four tables. The split between a finding and its repairs is the point of the
design — see models/diagnosis_kb.py for why one table would lose the
distinction users most need.

Nothing existing is touched. `vehicle_diagnoses` stays exactly as it is: that
table records requests, this one holds curated content, and the pipeline reads
one to answer the other.

The enum types are created once, by the first table that uses them, and reused
by the rest via create_type=False in the model. Postgres would otherwise raise
"type already exists" on the second CREATE.

Revision ID: 0032
Revises: 0031
"""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None

SEVERITY = sa.Enum("LOW", "MEDIUM", "HIGH", "CRITICAL", name="diagnosis_severity")
CAN_DRIVE = sa.Enum("YES", "NO", "LIMITED", "UNKNOWN", name="diagnosis_can_drive")
SOURCE_TYPE = sa.Enum(
    "OEM", "GOVERNMENT", "TECHNICAL", "COMMUNITY", "ADMIN_VERIFIED", "AI_GENERATED",
    name="diagnosis_source_type",
)
VERIFICATION = sa.Enum(
    "PENDING_REVIEW", "VERIFIED", "REJECTED", name="diagnosis_verification_status"
)
RECORD_STATUS = sa.Enum("DRAFT", "ACTIVE", "INACTIVE", name="diagnosis_record_status")
SOLUTION_TYPE = sa.Enum(
    "TEMPORARY_FIX", "PERMANENT_REPAIR", "PART_REPLACEMENT", "ADJUSTMENT",
    "CLEANING", "SOFTWARE_UPDATE", "INSPECTION_ONLY",
    name="diagnosis_solution_type",
)
DIFFICULTY = sa.Enum(
    "DIY", "MECHANIC", "SPECIALIST", "DEALER_ONLY", name="diagnosis_difficulty"
)
WARRANTY = sa.Enum("NONE", "MAY_VOID", "VOIDS", name="diagnosis_warranty_impact")

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "diagnosis_master",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("diagnosis_code", sa.String(64), nullable=False, unique=True),
        # Vehicle scope. 'ANY' is a sentinel rather than NULL — see the model.
        sa.Column("manufacturer", sa.String(100), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("variant", sa.String(100)),
        sa.Column("engine_code", sa.String(50)),
        sa.Column("transmission", sa.String(30)),
        sa.Column("model_year_from", sa.Integer, nullable=False),
        sa.Column("model_year_to", sa.Integer, nullable=False),
        sa.Column("fuel_type", sa.String(30), nullable=False),
        sa.Column("odometer_from_km", sa.Integer),
        sa.Column("odometer_to_km", sa.Integer),
        # Classification
        sa.Column("system", sa.String(60), nullable=False),
        sa.Column("subsystem", sa.String(80)),
        sa.Column("error_code", sa.String(20)),
        sa.Column("related_error_codes", sa.Text),
        # Symptom
        sa.Column("canonical_symptom", sa.String(80), nullable=False),
        sa.Column("symptom", sa.Text, nullable=False),
        sa.Column("user_keywords", sa.Text, nullable=False),
        # Finding
        sa.Column("possible_cause", sa.Text, nullable=False),
        sa.Column("diagnostic_steps", sa.Text, nullable=False),
        sa.Column("confirms_when", sa.Text),
        sa.Column("rule_out", sa.Text),
        # Risk
        sa.Column("severity", SEVERITY, nullable=False),
        sa.Column("safety_critical", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("can_drive", CAN_DRIVE, nullable=False, server_default="UNKNOWN"),
        sa.Column("recommended_action", sa.Text, nullable=False),
        sa.Column("requires_professional", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("estimated_cost_min", sa.Integer),
        sa.Column("estimated_cost_max", sa.Integer),
        # Provenance
        sa.Column("source_type", SOURCE_TYPE, nullable=False),
        sa.Column("source_name", sa.String(255), nullable=False),
        sa.Column("source_url", sa.String(500)),
        sa.Column("confidence_score", sa.Float, nullable=False, server_default="0"),
        sa.Column("verification_status", VERIFICATION, nullable=False, server_default="PENDING_REVIEW"),
        sa.Column("last_verified", sa.Date),
        sa.Column("reviewed_by", sa.String(255)),
        sa.Column("status", RECORD_STATUS, nullable=False, server_default="DRAFT"),
        sa.Column("notes", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        # Cost range must not be inverted. A CHECK rather than application-only
        # validation: the importer is not the only thing that will ever write here.
        sa.CheckConstraint(
            "estimated_cost_max IS NULL OR estimated_cost_min IS NULL "
            "OR estimated_cost_max >= estimated_cost_min",
            name="ck_dm_cost_range",
        ),
        sa.CheckConstraint("model_year_to >= model_year_from", name="ck_dm_year_range"),
        sa.CheckConstraint(
            "confidence_score >= 0 AND confidence_score <= 1", name="ck_dm_confidence"
        ),
    )
    op.create_index("ix_diagnosis_master_diagnosis_code", "diagnosis_master", ["diagnosis_code"])
    op.create_index("ix_diagnosis_master_manufacturer", "diagnosis_master", ["manufacturer"])
    op.create_index("ix_diagnosis_master_model", "diagnosis_master", ["model"])
    op.create_index("ix_diagnosis_master_fuel_type", "diagnosis_master", ["fuel_type"])
    op.create_index("ix_diagnosis_master_system", "diagnosis_master", ["system"])
    op.create_index("ix_diagnosis_master_error_code", "diagnosis_master", ["error_code"])
    op.create_index("ix_diagnosis_master_canonical_symptom", "diagnosis_master", ["canonical_symptom"])
    op.create_index("ix_diagnosis_master_severity", "diagnosis_master", ["severity"])
    op.create_index("ix_diagnosis_master_safety_critical", "diagnosis_master", ["safety_critical"])
    op.create_index("ix_diagnosis_master_status", "diagnosis_master", ["status"])
    op.create_index("ix_diagnosis_master_verification_status", "diagnosis_master", ["verification_status"])
    # Composite, ordered by how the exact lookup narrows.
    op.create_index(
        "ix_dm_lookup", "diagnosis_master",
        ["manufacturer", "model", "fuel_type", "canonical_symptom", "status"],
    )
    op.create_index("ix_dm_dtc", "diagnosis_master", ["error_code", "manufacturer", "model"])
    op.create_index("ix_dm_servable", "diagnosis_master", ["status", "verification_status"])

    op.create_table(
        "diagnosis_solutions",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("solution_code", sa.String(80), nullable=False, unique=True),
        sa.Column(
            "diagnosis_id", UUID,
            sa.ForeignKey("diagnosis_master.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sequence", sa.Integer, nullable=False, server_default="1"),
        sa.Column("solution_title", sa.String(255), nullable=False),
        sa.Column("solution_type", SOLUTION_TYPE, nullable=False),
        sa.Column("difficulty", DIFFICULTY, nullable=False),
        sa.Column("is_temporary_fix", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("resolves_root_cause", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("steps", sa.Text, nullable=False),
        sa.Column("expected_outcome", sa.Text),
        sa.Column("verification_check", sa.Text),
        sa.Column("tools_required", sa.Text),
        sa.Column("parts_required", sa.Text),
        sa.Column("oem_part_numbers", sa.Text),
        sa.Column("consumables", sa.Text),
        sa.Column("labour_hours_est", sa.Float),
        sa.Column("cost_parts_min", sa.Integer),
        sa.Column("cost_parts_max", sa.Integer),
        sa.Column("cost_labour_min", sa.Integer),
        sa.Column("cost_labour_max", sa.Integer),
        sa.Column("success_rate_pct", sa.Integer),
        sa.Column("safety_warning", sa.Text),
        sa.Column("prerequisites", sa.Text),
        sa.Column("do_not_attempt_if", sa.Text),
        sa.Column("warranty_impact", WARRANTY),
        sa.Column("environmental_note", sa.Text),
        sa.Column("source_type", SOURCE_TYPE, nullable=False),
        sa.Column("source_name", sa.String(255), nullable=False),
        sa.Column("source_url", sa.String(500)),
        sa.Column("confidence_score", sa.Float, nullable=False, server_default="0"),
        sa.Column("verification_status", VERIFICATION, nullable=False, server_default="PENDING_REVIEW"),
        sa.Column("status", RECORD_STATUS, nullable=False, server_default="DRAFT"),
        sa.Column("notes", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        # A bypass cannot also be a cure. Enforced here because the direction it
        # fails in tells a driver a temporary fix has repaired their car.
        sa.CheckConstraint(
            "NOT (is_temporary_fix AND resolves_root_cause)", name="ck_ds_temp_not_root"
        ),
        sa.CheckConstraint(
            "success_rate_pct IS NULL OR (success_rate_pct >= 0 AND success_rate_pct <= 100)",
            name="ck_ds_success_rate",
        ),
        sa.CheckConstraint(
            "confidence_score >= 0 AND confidence_score <= 1", name="ck_ds_confidence"
        ),
    )
    op.create_index("ix_diagnosis_solutions_solution_code", "diagnosis_solutions", ["solution_code"])
    op.create_index("ix_diagnosis_solutions_diagnosis_id", "diagnosis_solutions", ["diagnosis_id"])
    op.create_index("ix_diagnosis_solutions_difficulty", "diagnosis_solutions", ["difficulty"])
    op.create_index("ix_diagnosis_solutions_status", "diagnosis_solutions", ["status"])
    op.create_index("ix_diagnosis_solutions_verification_status", "diagnosis_solutions", ["verification_status"])
    op.create_index("ix_ds_diagnosis_seq", "diagnosis_solutions", ["diagnosis_id", "sequence"])
    op.create_index("ix_ds_servable", "diagnosis_solutions", ["status", "verification_status"])

    op.create_table(
        "diagnosis_symptom_aliases",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("canonical_symptom", sa.String(80), nullable=False),
        sa.Column("user_phrase", sa.String(255), nullable=False),
        sa.Column("normalised_phrase", sa.String(255), nullable=False),
        sa.Column("language", sa.String(10), nullable=False, server_default="en"),
        sa.Column("status", RECORD_STATUS, nullable=False, server_default="ACTIVE"),
        sa.Column("notes", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_diagnosis_symptom_aliases_canonical_symptom", "diagnosis_symptom_aliases", ["canonical_symptom"])
    op.create_index("ix_diagnosis_symptom_aliases_normalised_phrase", "diagnosis_symptom_aliases", ["normalised_phrase"])
    # One phrase per language. Stops the same alias arriving twice from two
    # imports and doubling a symptom's weight in retrieval.
    op.create_index(
        "uq_alias_phrase_lang", "diagnosis_symptom_aliases",
        ["normalised_phrase", "language"], unique=True,
    )

    op.create_table(
        "diagnosis_import_runs",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("imported_by", sa.String(255), nullable=False),
        sa.Column("dry_run", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("master_rows_read", sa.Integer, nullable=False, server_default="0"),
        sa.Column("master_created", sa.Integer, nullable=False, server_default="0"),
        sa.Column("master_updated", sa.Integer, nullable=False, server_default="0"),
        sa.Column("master_rejected", sa.Integer, nullable=False, server_default="0"),
        sa.Column("solution_rows_read", sa.Integer, nullable=False, server_default="0"),
        sa.Column("solution_created", sa.Integer, nullable=False, server_default="0"),
        sa.Column("solution_updated", sa.Integer, nullable=False, server_default="0"),
        sa.Column("solution_rejected", sa.Integer, nullable=False, server_default="0"),
        sa.Column("alias_rows_read", sa.Integer, nullable=False, server_default="0"),
        sa.Column("alias_created", sa.Integer, nullable=False, server_default="0"),
        sa.Column("errors", sa.Text),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("diagnosis_import_runs")
    op.drop_table("diagnosis_symptom_aliases")
    op.drop_table("diagnosis_solutions")
    op.drop_table("diagnosis_master")
    for enum_name in (
        "diagnosis_warranty_impact", "diagnosis_difficulty", "diagnosis_solution_type",
        "diagnosis_record_status", "diagnosis_verification_status", "diagnosis_source_type",
        "diagnosis_can_drive", "diagnosis_severity",
    ):
        op.execute(f"DROP TYPE IF EXISTS {enum_name}")
