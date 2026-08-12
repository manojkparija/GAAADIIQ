"""Add the 79 columns production is missing across nine tables.

The startup drift report named these on a real boot. Same cause as 0028, and a
great deal wider:

  vehicle_diagnoses        30 columns
  customer_intent_scores   17
  voice_transcripts         9
  diagnosis_conversations   8
  diagnosis_audit_events    6
  customer_activities       4
  loan_inquiries            2
  notifications             2
  subscriptions             1

Every one of these IS created by the migration chain — verified by inspecting a
database built from `alembic upgrade head`, where all 79 are present. So this is
not a gap in the migrations; production was built from the hand-run
schema_setup_batch*.sql files and stamped, and has been drifting ever since.
`vehicle_diagnoses` is missing essentially its whole payload, so AI Diagnosis
cannot have been storing a usable record.

HOW EACH COLUMN IS ADDED

Types come from the models. Nullability and defaults come from a database built
by the migration chain, so production converges on the shape a fresh deploy
would have rather than on a second opinion.

  * A column the chain gives a default (now(), false, 0, 'en-IN', 'user') is
    added WITH that default and NOT NULL. Postgres backfills existing rows, so
    this is safe on a table with data in it.
  * A column that is NOT NULL in the chain but has no default is added
    NULLABLE. Making it NOT NULL would require inventing a value for every
    existing row — a manufacturer, a problem description, an occurred_at — and
    a repair migration must not put made-up data in front of anyone. Tightening
    these is a follow-up that needs the rows in front of you.
  * Everything else is added nullable, matching the chain.

Foreign keys are deliberately NOT recreated here. customer_intent_scores.dealer_id,
customer_activities.dealer_id and voice_transcripts.conversation_id are FKs in
the models; adding the constraint would fail against rows that cannot satisfy
it, and a repair migration that aborts halfway is worse than one that leaves a
constraint for later.

Revision ID: 0029
Revises: 0028
"""
from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


COLUMNS = [
    ('vehicle_diagnoses', 'analysis_confidence', 'FLOAT', None, True),
    ('vehicle_diagnoses', 'audio_url', 'VARCHAR(500)', None, True),
    ('vehicle_diagnoses', 'cost_max_inr', 'INTEGER', None, True),
    ('vehicle_diagnoses', 'cost_min_inr', 'INTEGER', None, True),
    ('vehicle_diagnoses', 'diy_fixes', 'JSON', None, True),
    ('vehicle_diagnoses', 'fuel_type', 'VARCHAR(30)', None, False),
    ('vehicle_diagnoses', 'image_urls', 'JSON', None, True),
    ('vehicle_diagnoses', 'immediate_service_required', 'BOOLEAN', None, True),
    ('vehicle_diagnoses', 'maintenance_history', 'JSON', None, True),
    ('vehicle_diagnoses', 'manufacturer', 'VARCHAR(100)', None, False),
    ('vehicle_diagnoses', 'model', 'VARCHAR(100)', None, False),
    ('vehicle_diagnoses', 'model_year', 'INTEGER', None, False),
    ('vehicle_diagnoses', 'odometer_km', 'INTEGER', None, True),
    ('vehicle_diagnoses', 'ollama_used', 'BOOLEAN', 'false', False),
    ('vehicle_diagnoses', 'possible_causes', 'JSON', None, True),
    ('vehicle_diagnoses', 'preliminary_diagnosis', 'TEXT', None, True),
    ('vehicle_diagnoses', 'preventive_maintenance', 'JSON', None, True),
    ('vehicle_diagnoses', 'problem_description', 'TEXT', None, False),
    ('vehicle_diagnoses', 'recommended_steps', 'JSON', None, True),
    ('vehicle_diagnoses', 'repair_complexity', 'VARCHAR(30)', None, True),
    ('vehicle_diagnoses', 'repair_time_estimate', 'VARCHAR(100)', None, True),
    ('vehicle_diagnoses', 'retrieved_sources', 'JSON', None, True),
    ('vehicle_diagnoses', 'risk_level', 'VARCHAR(20)', None, True),
    ('vehicle_diagnoses', 'safe_to_drive', 'BOOLEAN', None, True),
    ('vehicle_diagnoses', 'severity', 'VARCHAR(20)', None, False),
    ('vehicle_diagnoses', 'transmission', 'VARCHAR(30)', None, False),
    ('vehicle_diagnoses', 'variant', 'VARCHAR(100)', None, True),
    ('vehicle_diagnoses', 'video_url', 'VARCHAR(500)', None, True),
    ('vehicle_diagnoses', 'warning_lights', 'JSON', None, True),
    ('vehicle_diagnoses', 'when_occurs', 'JSON', None, True),
    ('diagnosis_conversations', 'completed', 'BOOLEAN', 'false', False),
    ('diagnosis_conversations', 'extracted_vehicle_info', 'JSON', None, True),
    ('diagnosis_conversations', 'language', 'VARCHAR(10)', "'en-IN'::character varying", False),
    ('diagnosis_conversations', 'language_auto_detected', 'BOOLEAN', 'false', False),
    ('diagnosis_conversations', 'stt_engine', 'VARCHAR(30)', None, True),
    ('diagnosis_conversations', 'turn_count', 'INTEGER', '0', False),
    ('diagnosis_conversations', 'updated_at', 'TIMESTAMP WITH TIME ZONE', 'now()', False),
    ('diagnosis_conversations', 'user_id', 'UUID', None, True),
    ('subscriptions', 'valid_until', 'TIMESTAMP WITH TIME ZONE', None, True),
    ('customer_intent_scores', 'best_contact_time', 'VARCHAR(100)', None, True),
    ('customer_intent_scores', 'budget_fit_score', 'FLOAT', None, False),
    ('customer_intent_scores', 'dealer_id', 'UUID', None, False),
    ('customer_intent_scores', 'engagement_score', 'FLOAT', None, False),
    ('customer_intent_scores', 'interested_cars', 'JSON', None, True),
    ('customer_intent_scores', 'llm_reasoning', 'TEXT', None, True),
    ('customer_intent_scores', 'next_best_action', 'VARCHAR(200)', None, True),
    ('customer_intent_scores', 'ollama_used', 'BOOLEAN', None, True),
    ('customer_intent_scores', 'predicted_purchase_window', 'VARCHAR(50)', None, True),
    ('customer_intent_scores', 'revisit_count', 'INTEGER', None, True),
    ('customer_intent_scores', 'scored_at', 'TIMESTAMP WITHOUT TIME ZONE', None, True),
    ('customer_intent_scores', 'sentiment_score', 'FLOAT', None, False),
    ('customer_intent_scores', 'total_enquiries', 'INTEGER', None, True),
    ('customer_intent_scores', 'total_loan_inquiries', 'INTEGER', None, True),
    ('customer_intent_scores', 'total_test_drives', 'INTEGER', None, True),
    ('customer_intent_scores', 'total_views', 'INTEGER', None, True),
    ('customer_intent_scores', 'urgency_score', 'FLOAT', None, False),
    ('diagnosis_audit_events', 'consent_version', 'INTEGER', None, True),
    ('diagnosis_audit_events', 'conversation_id', 'UUID', None, True),
    ('diagnosis_audit_events', 'detail', 'JSON', None, True),
    ('diagnosis_audit_events', 'language', 'VARCHAR(10)', None, True),
    ('diagnosis_audit_events', 'occurred_at', 'TIMESTAMP WITH TIME ZONE', None, False),
    ('diagnosis_audit_events', 'user_id', 'UUID', None, True),
    ('voice_transcripts', 'confidence', 'FLOAT', None, True),
    ('voice_transcripts', 'conversation_id', 'UUID', None, False),
    ('voice_transcripts', 'language', 'VARCHAR(10)', "'en-IN'::character varying", False),
    ('voice_transcripts', 'role', 'VARCHAR(16)', "'user'::character varying", False),
    ('voice_transcripts', 'step', 'VARCHAR(32)', None, True),
    ('voice_transcripts', 'stt_engine', 'VARCHAR(30)', None, True),
    ('voice_transcripts', 'text', 'TEXT', None, False),
    ('voice_transcripts', 'updated_at', 'TIMESTAMP WITH TIME ZONE', 'now()', False),
    ('voice_transcripts', 'user_id', 'UUID', None, True),
    ('customer_activities', 'dealer_id', 'UUID', None, False),
    ('customer_activities', 'duration_seconds', 'INTEGER', None, True),
    ('customer_activities', 'extra_data', 'JSON', None, True),
    ('customer_activities', 'updated_at', 'TIMESTAMP WITH TIME ZONE', 'now()', False),
    ('loan_inquiries', 'annual_income', 'NUMERIC(12, 2)', None, True),
    ('loan_inquiries', 'partner_ref', 'VARCHAR(100)', None, True),
    ('notifications', 'body', 'TEXT', None, True),
    ('notifications', 'updated_at', 'TIMESTAMP WITH TIME ZONE', 'now()', False),
]


def upgrade() -> None:
    for table, column, type_sql, default, nullable in COLUMNS:
        clause = f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {type_sql}"
        if default is not None:
            # A default lets Postgres fill existing rows, which is what makes
            # NOT NULL safe to apply here.
            clause += f" DEFAULT {default}"
            clause += " NOT NULL" if not nullable else ""
        op.execute(clause + ";")


def downgrade() -> None:
    for table, column, *_ in reversed(COLUMNS):
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS {column};")
