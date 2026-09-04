"""
Per-subject monthly counter for AI Diagnosis runs.

WHY A TABLE AND NOT A COUNT OVER `vehicle_diagnoses`

Counting history rows looks like the obvious implementation and does not work
here. `vehicle_diagnoses.user_id` is a FK into *this* backend's `users`, and
sign-in is Supabase's — the two stores are unlinked, so a caller who signed in
through Supabase and has no local row stores NULL (see
`routers/diagnosis._known_user_id`). A quota counted off that column would be
unenforceable for exactly the users who make up ordinary traffic.

The counter is keyed on the *verified* identity instead, which both token
sources carry: the email claim, falling back to the API user id when a token
somehow has no email. Nothing here is taken from the request body.

`period` is a UTC "YYYY-MM" string rather than a date range, so "this month"
is an equality test and the unique constraint does the deduplication. A new
month simply has no row yet, which is a fresh allowance — no reset job.
"""
from sqlalchemy import Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base, TimestampMixin, UUIDMixin


class DiagnosisUsage(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "diagnosis_usage"
    __table_args__ = (
        UniqueConstraint("subject", "period", name="uq_diagnosis_usage_subject_period"),
    )

    #: Lowercased verified email, or "id:<uuid>" for a token carrying no email.
    subject: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    #: UTC calendar month, "YYYY-MM".
    period: Mapped[str] = mapped_column(String(7), nullable=False)
    used: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    def __repr__(self) -> str:
        return f"<DiagnosisUsage {self.subject} {self.period}={self.used}>"
