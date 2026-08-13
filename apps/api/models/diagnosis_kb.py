"""The diagnosis knowledge base — what is wrong, and how to fix it.

Two tables rather than one, because a diagnosis and its repairs are different
shapes. "Engine overheating" is one finding; topping up coolant to get home,
replacing a thermostat, and pressure-testing for a head gasket are three
different jobs with different costs, skill levels and risks. Flattening them
into one row loses the distinction the user most needs — which of these can I
do myself, and which one actually fixes it.

WHY THIS IS NOT THE EXISTING vehicle_diagnoses TABLE

`vehicle_diagnoses` records a *request*: this person, this car, this complaint,
this answer, at this time. It is an event log. This is a *corpus*: curated,
sourced, reviewed, and reused across many requests. They are joined only by the
diagnosis pipeline reading one to answer the other.

WHAT MAKES A ROW SAFE TO SERVE

Two independent gates, and both must pass:

    status              = ACTIVE           (an editor has published it)
    verification_status = VERIFIED         (a reviewer has checked it)

A row that is merely present answers nobody. Gemini-generated content lands as
PENDING_REVIEW and stays inert until a human moves it — which is the whole
reason the corpus can be trusted at all.

VEHICLE SCOPE IS THE SUBTLE PART

A stored row is served with no hedging, so a row scoped too widely is worse
than no row. `manufacturer`/`model` accept the literal 'ANY' for genuinely
universal advice, but engine_code, year range and odometer range exist because
a 1.2 petrol and a 1.5 diesel of the same model fail in different ways, and a
timing-belt fault at 90,000 km is not a fault at 9,000.
"""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base, TimestampMixin, UUIDMixin


def _pg_enum(enum_cls, name: str, *, create_type: bool = True) -> Enum:
    """A Postgres enum column that stores the member VALUE, not its name.

    SQLAlchemy persists `Severity.high` as its *name* — "high" — unless told
    otherwise, while the Postgres type declares labels "LOW/MEDIUM/HIGH/...".
    The mismatch is invisible on SQLite, which does not enforce enum labels at
    all, so the unit suite passed and the first real Postgres insert failed with
    `invalid input value for enum diagnosis_severity: "high"`.

    values_callable is the fix, and it is applied here once rather than at each
    of the sixteen column definitions, where one omission would reintroduce the
    same failure on one column only.
    """
    return Enum(
        enum_cls,
        name=name,
        create_type=create_type,
        values_callable=lambda members: [m.value for m in members],
    )

# 'ANY' rather than NULL for an unscoped field: NULL in a WHERE clause is a
# three-valued trap, and every lookup would need a COALESCE. A sentinel keeps
# the query readable and the intent explicit in the data.
ANY_VEHICLE = "ANY"


class VerificationStatus(str, enum.Enum):
    pending_review = "PENDING_REVIEW"
    verified = "VERIFIED"
    rejected = "REJECTED"


class RecordStatus(str, enum.Enum):
    draft = "DRAFT"
    active = "ACTIVE"
    inactive = "INACTIVE"


class SourceType(str, enum.Enum):
    oem = "OEM"
    government = "GOVERNMENT"
    technical = "TECHNICAL"
    community = "COMMUNITY"
    admin_verified = "ADMIN_VERIFIED"
    ai_generated = "AI_GENERATED"


class Severity(str, enum.Enum):
    low = "LOW"
    medium = "MEDIUM"
    high = "HIGH"
    critical = "CRITICAL"


class CanDrive(str, enum.Enum):
    """Deliberately four-valued.

    A boolean forces a claim in both directions, and the false claim here is
    "yes, keep driving" on a car that should not be driven. UNKNOWN is a real
    answer and authors are told to use it.
    """

    yes = "YES"
    no = "NO"
    limited = "LIMITED"
    unknown = "UNKNOWN"


class SolutionType(str, enum.Enum):
    temporary_fix = "TEMPORARY_FIX"
    permanent_repair = "PERMANENT_REPAIR"
    part_replacement = "PART_REPLACEMENT"
    adjustment = "ADJUSTMENT"
    cleaning = "CLEANING"
    software_update = "SOFTWARE_UPDATE"
    inspection_only = "INSPECTION_ONLY"


class Difficulty(str, enum.Enum):
    diy = "DIY"
    mechanic = "MECHANIC"
    specialist = "SPECIALIST"
    dealer_only = "DEALER_ONLY"


class WarrantyImpact(str, enum.Enum):
    none = "NONE"
    may_void = "MAY_VOID"
    voids = "VOIDS"


class DiagnosisMaster(UUIDMixin, TimestampMixin, Base):
    """One finding, scoped to the vehicles it actually applies to."""

    __tablename__ = "diagnosis_master"

    diagnosis_code: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True
    )

    # --- Vehicle scope ------------------------------------------------------
    manufacturer: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    model: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    variant: Mapped[str | None] = mapped_column(String(100))
    engine_code: Mapped[str | None] = mapped_column(String(50))
    transmission: Mapped[str | None] = mapped_column(String(30))
    model_year_from: Mapped[int] = mapped_column(Integer, nullable=False)
    model_year_to: Mapped[int] = mapped_column(Integer, nullable=False)
    fuel_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    odometer_from_km: Mapped[int | None] = mapped_column(Integer)
    odometer_to_km: Mapped[int | None] = mapped_column(Integer)

    # --- Classification -----------------------------------------------------
    system: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    subsystem: Mapped[str | None] = mapped_column(String(80))
    error_code: Mapped[str | None] = mapped_column(String(20), index=True)
    related_error_codes: Mapped[str | None] = mapped_column(Text)

    # --- Symptom ------------------------------------------------------------
    canonical_symptom: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    symptom: Mapped[str] = mapped_column(Text, nullable=False)
    user_keywords: Mapped[str] = mapped_column(Text, nullable=False)

    # --- The finding --------------------------------------------------------
    possible_cause: Mapped[str] = mapped_column(Text, nullable=False)
    diagnostic_steps: Mapped[str] = mapped_column(Text, nullable=False)
    confirms_when: Mapped[str | None] = mapped_column(Text)
    # What would mean it is NOT this. Stored because the pipeline can use it to
    # withhold a match, and because it is the field that stops a plausible row
    # being served for a symptom it does not actually explain.
    rule_out: Mapped[str | None] = mapped_column(Text)

    # --- Risk ---------------------------------------------------------------
    severity: Mapped[Severity] = mapped_column(
        _pg_enum(Severity, "diagnosis_severity"), nullable=False, index=True
    )
    # Read BEFORE any confidence or cache check. See services/diagnosis_kb.py.
    safety_critical: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    can_drive: Mapped[CanDrive] = mapped_column(
        _pg_enum(CanDrive, "diagnosis_can_drive"), nullable=False, default=CanDrive.unknown
    )
    recommended_action: Mapped[str] = mapped_column(Text, nullable=False)
    requires_professional: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # --- Cost roll-up (per-solution costs live on the child rows) -----------
    estimated_cost_min: Mapped[int | None] = mapped_column(Integer)
    estimated_cost_max: Mapped[int | None] = mapped_column(Integer)

    # --- Provenance ---------------------------------------------------------
    source_type: Mapped[SourceType] = mapped_column(
        _pg_enum(SourceType, "diagnosis_source_type"), nullable=False
    )
    source_name: Mapped[str] = mapped_column(String(255), nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(500))
    confidence_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    verification_status: Mapped[VerificationStatus] = mapped_column(
        _pg_enum(VerificationStatus, "diagnosis_verification_status"),
        nullable=False,
        default=VerificationStatus.pending_review,
        index=True,
    )
    last_verified: Mapped[date | None] = mapped_column(Date)
    reviewed_by: Mapped[str | None] = mapped_column(String(255))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[RecordStatus] = mapped_column(
        _pg_enum(RecordStatus, "diagnosis_record_status"),
        nullable=False,
        default=RecordStatus.draft,
        index=True,
    )
    notes: Mapped[str | None] = mapped_column(Text)

    solutions: Mapped[list["DiagnosisSolution"]] = relationship(
        back_populates="diagnosis",
        cascade="all, delete-orphan",
        order_by="DiagnosisSolution.sequence",
    )

    __table_args__ = (
        # The exact-lookup index. Column order matches how the lookup narrows:
        # manufacturer and model first because they eliminate the most rows.
        Index(
            "ix_dm_lookup",
            "manufacturer", "model", "fuel_type", "canonical_symptom", "status",
        ),
        Index("ix_dm_dtc", "error_code", "manufacturer", "model"),
        # Serving requires BOTH gates, so index them together.
        Index("ix_dm_servable", "status", "verification_status"),
    )

    @property
    def is_servable(self) -> bool:
        """Published and reviewed. Anything else is invisible to users."""
        return (
            self.status == RecordStatus.active
            and self.verification_status == VerificationStatus.verified
        )

    def __repr__(self) -> str:
        return f"<DiagnosisMaster {self.diagnosis_code} {self.canonical_symptom}>"


class DiagnosisSolution(UUIDMixin, TimestampMixin, Base):
    """One way to fix one diagnosis. Many per diagnosis is the normal case.

    `is_temporary_fix` and `resolves_root_cause` are separate flags rather than
    one, because they are genuinely independent: topping up coolant is
    temporary and does not fix the leak, but a software update can be permanent
    and still not address a failing sensor. Collapsing them would force one of
    those to be described wrongly — and a bypass presented as a repair is how
    somebody breaks down twice.
    """

    __tablename__ = "diagnosis_solutions"

    solution_code: Mapped[str] = mapped_column(
        String(80), nullable=False, unique=True, index=True
    )
    diagnosis_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("diagnosis_master.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    solution_title: Mapped[str] = mapped_column(String(255), nullable=False)
    solution_type: Mapped[SolutionType] = mapped_column(
        _pg_enum(SolutionType, "diagnosis_solution_type"), nullable=False
    )
    difficulty: Mapped[Difficulty] = mapped_column(
        _pg_enum(Difficulty, "diagnosis_difficulty"), nullable=False, index=True
    )
    is_temporary_fix: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    resolves_root_cause: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    steps: Mapped[str] = mapped_column(Text, nullable=False)
    expected_outcome: Mapped[str | None] = mapped_column(Text)
    verification_check: Mapped[str | None] = mapped_column(Text)

    tools_required: Mapped[str | None] = mapped_column(Text)
    parts_required: Mapped[str | None] = mapped_column(Text)
    oem_part_numbers: Mapped[str | None] = mapped_column(Text)
    consumables: Mapped[str | None] = mapped_column(Text)
    labour_hours_est: Mapped[float | None] = mapped_column(Float)

    # Parts and labour separately: labour varies by city, parts do not.
    cost_parts_min: Mapped[int | None] = mapped_column(Integer)
    cost_parts_max: Mapped[int | None] = mapped_column(Integer)
    cost_labour_min: Mapped[int | None] = mapped_column(Integer)
    cost_labour_max: Mapped[int | None] = mapped_column(Integer)
    success_rate_pct: Mapped[int | None] = mapped_column(Integer)

    # --- The fields that stop somebody getting hurt -------------------------
    safety_warning: Mapped[str | None] = mapped_column(Text)
    prerequisites: Mapped[str | None] = mapped_column(Text)
    do_not_attempt_if: Mapped[str | None] = mapped_column(Text)
    warranty_impact: Mapped[WarrantyImpact | None] = mapped_column(
        _pg_enum(WarrantyImpact, "diagnosis_warranty_impact")
    )
    environmental_note: Mapped[str | None] = mapped_column(Text)

    source_type: Mapped[SourceType] = mapped_column(
        _pg_enum(SourceType, "diagnosis_source_type", create_type=False), nullable=False
    )
    source_name: Mapped[str] = mapped_column(String(255), nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(500))
    confidence_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    verification_status: Mapped[VerificationStatus] = mapped_column(
        _pg_enum(VerificationStatus, "diagnosis_verification_status", create_type=False),
        nullable=False,
        default=VerificationStatus.pending_review,
        index=True,
    )
    status: Mapped[RecordStatus] = mapped_column(
        _pg_enum(RecordStatus, "diagnosis_record_status", create_type=False),
        nullable=False,
        default=RecordStatus.draft,
        index=True,
    )
    reviewed_by: Mapped[str | None] = mapped_column(String(255))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)

    diagnosis: Mapped["DiagnosisMaster"] = relationship(back_populates="solutions")

    __table_args__ = (
        Index("ix_ds_diagnosis_seq", "diagnosis_id", "sequence"),
        Index("ix_ds_servable", "status", "verification_status"),
    )

    @property
    def is_servable(self) -> bool:
        return (
            self.status == RecordStatus.active
            and self.verification_status == VerificationStatus.verified
        )

    def __repr__(self) -> str:
        return f"<DiagnosisSolution {self.solution_code} {self.difficulty}>"


class DiagnosisSymptomAlias(UUIDMixin, TimestampMixin, Base):
    """What a user actually types, mapped to the canonical symptom key.

    Rows are per phrase, not per diagnosis: "engine shaking", "car jerking" and
    "vehicle vibrates on acceleration" all point at ENGINE_MISFIRE, and any
    diagnosis carrying that canonical symptom is then reachable from all three.
    Attaching aliases to a diagnosis instead would mean re-entering every phrase
    for every vehicle scope.
    """

    __tablename__ = "diagnosis_symptom_aliases"

    canonical_symptom: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    user_phrase: Mapped[str] = mapped_column(String(255), nullable=False)
    # Lower-cased, punctuation-stripped form the normaliser matches against.
    # Stored rather than computed so the match is an index lookup, not a scan.
    normalised_phrase: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    language: Mapped[str] = mapped_column(String(10), nullable=False, default="en")
    status: Mapped[RecordStatus] = mapped_column(
        _pg_enum(RecordStatus, "diagnosis_record_status", create_type=False),
        nullable=False,
        default=RecordStatus.active,
    )
    notes: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        Index("uq_alias_phrase_lang", "normalised_phrase", "language", unique=True),
    )

    def __repr__(self) -> str:
        return f"<DiagnosisSymptomAlias {self.normalised_phrase} → {self.canonical_symptom}>"


class ReviewDecision(str, enum.Enum):
    approved = "APPROVED"
    rejected = "REJECTED"
    # Sent back to the author with notes: not wrong, not yet right. Without it
    # a reviewer's only options are to publish something they doubt or to
    # reject work that mostly stands, and neither leaves a usable record.
    returned = "RETURNED"


class DiagnosisReviewEvent(UUIDMixin, TimestampMixin, Base):
    """Who decided what about which row, and why.

    The row itself carries only its current state — ACTIVE, VERIFIED, the name
    of the last reviewer. That is enough to serve traffic and not enough to
    answer the question that actually gets asked after a bad answer reaches a
    driver: who approved this, when, and what did they say about it. This table
    is that record, and it is append-only for the same reason.

    Nullable on both sides because a decision is about a diagnosis *or* a single
    solution; exactly one is set, enforced by a check constraint in the
    migration rather than by convention.
    """

    __tablename__ = "diagnosis_review_events"

    diagnosis_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("diagnosis_master.id", ondelete="CASCADE"), index=True
    )
    solution_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("diagnosis_solutions.id", ondelete="CASCADE"), index=True
    )
    decision: Mapped[ReviewDecision] = mapped_column(
        _pg_enum(ReviewDecision, "diagnosis_review_decision"), nullable=False, index=True
    )
    reviewer: Mapped[str] = mapped_column(String(255), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    # What the row looked like before, so a decision can be read without
    # reconstructing history from the rows it touched.
    previous_status: Mapped[str | None] = mapped_column(String(30))
    previous_verification: Mapped[str | None] = mapped_column(String(30))

    __table_args__ = (
        Index("ix_dre_recent", "created_at", "reviewer"),
    )

    def __repr__(self) -> str:
        return f"<DiagnosisReviewEvent {self.decision} by {self.reviewer}>"


class DiagnosisImportRun(UUIDMixin, TimestampMixin, Base):
    """One import attempt, kept whether it succeeded or not.

    A failed import is the more useful record: it says which rows an editor
    tried to add and why they were refused. Without it the only evidence is a
    toast message the admin has already dismissed.
    """

    __tablename__ = "diagnosis_import_runs"

    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    imported_by: Mapped[str] = mapped_column(String(255), nullable=False)
    dry_run: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    master_rows_read: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    master_created: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    master_updated: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    master_rejected: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    solution_rows_read: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    solution_created: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    solution_updated: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    solution_rejected: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    alias_rows_read: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    alias_created: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Row-level errors, [{sheet, row, column, message}]. Text rather than JSON
    # so a very large error list cannot be silently truncated by a driver.
    errors: Mapped[str | None] = mapped_column(Text)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    def __repr__(self) -> str:
        return f"<DiagnosisImportRun {self.filename} dry_run={self.dry_run}>"
