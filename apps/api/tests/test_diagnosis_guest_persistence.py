"""
A signed-out visitor's diagnosis is actually stored.

Measured on Render, on every anonymous POST /diagnosis/analyse:

    ERROR [gaadiiq.diagnosis] Diagnosis computed but not stored (IntegrityError):
    asyncpg.exceptions.NotNullViolationError: null value in column "user_id" of
    relation "vehicle_diagnoses" violates not-null constraint

Production carried a NOT NULL on `user_id` that migration 0006 never created
and the model never declared. Migration 0048 drops it.

WHAT THIS FILE CAN AND CANNOT PROVE

It cannot reproduce the production failure. CI builds its database from the
migration chain, where the column has always been nullable, so the constraint
that broke this never exists here — and `test_migrations_match_models.py`
compares table and column names, not nullability, so it is silent on it too.
That combination is why a green suite coexisted with a feature losing every
guest's data.

What it does pin is the contract that made the constraint wrong: the column is
optional in the model, the endpoint takes no authentication, and a guest's row
must survive the request. If someone later marks `user_id` NOT NULL in the
model or requires a user, these fail and say why.

The 201-with-nothing-saved behaviour at routers/diagnosis.py:421 is left as it
is — deliberate, and a separate decision from this bug.
"""
import uuid

import pytest
from sqlalchemy import select

from models.vehicle_diagnosis import VehicleDiagnosis


class TestGuestDiagnosisColumnSuite:
    def test_user_id_is_optional_in_the_model(self):
        # The half production disagreed with. A guest has no user id to give.
        column = VehicleDiagnosis.__table__.c.user_id

        assert column.nullable is True, (
            "Guests can run a diagnosis; requiring a user id asks for a value "
            "that does not exist at that point."
        )

    def test_user_id_is_not_a_primary_key_or_otherwise_forced(self):
        # A NOT NULL can also arrive by way of a primary key or a foreign key
        # declared non-nullable; neither should apply here.
        column = VehicleDiagnosis.__table__.c.user_id

        assert column.primary_key is False


class TestGuestDiagnosisIsStoredSuite:
    @pytest.mark.asyncio
    async def test_a_row_with_no_user_survives_a_commit(self, db_session):
        """
        The insert the production constraint rejected.

        Against CI's schema this passes trivially. It is here so that a future
        change making `user_id` mandatory — in the model, or in a migration
        applied to this chain — fails loudly rather than showing up as lost
        rows in a log nobody reads.
        """
        record = VehicleDiagnosis(
            id=uuid.uuid4(),
            user_id=None,
            manufacturer="Maruti Suzuki",
            model="Swift",
            model_year=2024,
            fuel_type="Petrol",
            transmission="Manual",
            problem_description="The car's braking system is not working properly.",
            preliminary_diagnosis="Brake Squeal / Brake Fade.",
            severity="medium",
        )

        db_session.add(record)
        await db_session.commit()

        found = (
            await db_session.execute(
                select(VehicleDiagnosis).where(VehicleDiagnosis.id == record.id)
            )
        ).scalar_one()

        assert found.user_id is None
        assert found.problem_description.startswith("The car's braking system")
