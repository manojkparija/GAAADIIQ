"""The Python enum and the Postgres enum must agree.

`job_offer` was added to `NotificationType` during the marketplace work and
never to the Postgres type, which migration 0001 created with seven labels.
Nothing noticed for a whole feature, because CI runs on SQLite — where the
column is plain text and every label is acceptable — while production runs on
Postgres, where the insert fails.

The failure surfaced as a 500 on the flow it broke, not on the change that
broke it:

    asyncpg UndefinedObjectError: type "notification_type" does not exist
    POST /service-requests/{id}/dispatch 500

So this compares the two lists directly. It is the only check that can catch
the next member added on one side only, and it runs on any database.
"""
import re
from pathlib import Path

from models.notification import NotificationType

_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"


def _labels_created_by_0001() -> set[str]:
    """The labels `CREATE TYPE notification_type` starts life with."""
    text = (_VERSIONS / "0001_initial_schema.py").read_text()
    body = re.search(
        r"CREATE TYPE notification_type AS ENUM \((.*?)\)\"", text, re.S
    )
    assert body, "0001 no longer creates notification_type in the expected form"
    return set(re.findall(r"'([a-z_]+)'", body.group(1)))


def _labels_ensured_by_0036() -> set[str]:
    """The labels 0036 guarantees, whatever state the database is in."""
    text = (_VERSIONS / "0036_notification_type_job_offer.py").read_text()
    body = re.search(r"_LABELS = \[(.*?)\]", text, re.S)
    assert body, "0036 no longer declares _LABELS"
    return set(re.findall(r'"([a-z_]+)"', body.group(1)))


def test_every_python_label_is_reachable_in_postgres():
    """Every value the ORM can write must exist as a database label."""
    python_labels = {member.value for member in NotificationType}
    ensured = _labels_ensured_by_0036()

    missing = python_labels - ensured
    assert not missing, (
        f"NotificationType has {sorted(missing)} but no migration adds them to "
        "the Postgres type. Inserting one raises InvalidTextRepresentation in "
        "production and passes on SQLite in CI. Add them to _LABELS in a "
        "migration."
    )


def test_0036_does_not_quietly_drop_a_label():
    """0036 must be a superset of what 0001 created, never a replacement."""
    original = _labels_created_by_0001()
    ensured = _labels_ensured_by_0036()

    dropped = original - ensured
    assert not dropped, (
        f"{sorted(dropped)} existed from 0001 and 0036 no longer lists them. "
        "A label in use by stored rows must not be dropped."
    )


def test_job_offer_specifically_is_covered():
    """The member whose absence broke dispatch."""
    assert "job_offer" in {m.value for m in NotificationType}
    assert "job_offer" in _labels_ensured_by_0036()
    # And the record of why this file exists: 0001 alone was not enough.
    assert "job_offer" not in _labels_created_by_0001()
