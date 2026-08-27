"""
An enum migration must not assume the type is there.

WHAT HAPPENED

Migration 0045 adds 'seller_basic' to subscription_tier and
'subscription_seller_basic' to payment_purpose. It ran ALTER TYPE
unconditionally on any PostgreSQL database, and production does not have those
types:

    asyncpg.exceptions.UndefinedObjectError: type "subscription_tier" does not
    exist
    [SQL: ALTER TYPE subscription_tier ADD VALUE IF NOT EXISTS 'seller_basic']
    ==> Pre-deploy has failed
    ==> Exited with status 1

The pre-deploy step exits 1, so *no* new version ships — a migration for one
unreleased pricing tier blocked every unrelated deploy behind it.

TWO THINGS MADE IT EASY TO WRITE

  - "ADD VALUE IF NOT EXISTS" reads as covering the whole statement. It guards
    the value, not the type.
  - The types *are* created by migration 0001, so any database built from the
    migration chain has them — including every one CI builds. Production was
    not built that way: the marketplace tables came from the hand-run
    schema_setup_batch*.sql files at the repo root. That is the two-places
    schema problem CLAUDE.md opens with, and CI cannot see it, because CI
    always starts from the chain.

WHY THESE TESTS ARE SHAPED LIKE THIS

The fault only exists on PostgreSQL — SQLite stores these columns as text and
accepts any label, so a SQLite run cannot reach it. And test_media_admin.py
and friends are excluded from the Postgres job. So rather than a database
test, these assert the property directly on the migration source: every
ALTER TYPE in the versions directory is preceded by a pg_type existence check.

That is a weaker check than executing it, and deliberately so — it is the one
that runs everywhere, including on the SQLite job, and it fails for the next
person who writes the unguarded version.
"""
import io
import tokenize
from pathlib import Path

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"


def _code_only(path: Path) -> str:
    """
    The file's text with comments removed — strings kept.

    Comments have to go: 0045 quotes the failing SQL verbatim so the next
    reader knows what the outage looked like, and a plain substring search
    matches that comment and reports the migration as unguarded. The first
    version of this test did exactly that, and failed on the very fix it
    exists to protect.

    Strings have to stay, which the *second* version got wrong: the guard
    itself lives inside a SQL literal — either a DO block containing
    "SELECT 1 FROM pg_type" (0025, 0036) or a Python-side existence query
    (0045). Dropping STRING tokens deletes the thing being looked for and
    reports three perfectly safe migrations as broken.
    """
    out = []
    tokens = tokenize.generate_tokens(io.StringIO(path.read_text()).readline)
    for tok_type, tok_str, _, _, _ in tokens:
        if tok_type == tokenize.COMMENT:
            continue
        out.append(tok_str)
    return " ".join(out)


def _migrations_altering_a_type() -> list[Path]:
    """
    Migrations that really run an ALTER TYPE.

    Matched on the raw text — an ALTER inside an f-string is still an ALTER,
    and STRING tokens are dropped by _code_only — but the *guard* check below
    reads the code-only form, where a quoted example cannot masquerade as one.
    """
    return [p for p in VERSIONS.glob("*.py") if "ALTER TYPE" in p.read_text()]


def test_there_is_at_least_one_such_migration():
    """
    Guards the guard.

    If ALTER TYPE ever stops appearing — renamed, reworded, moved — the test
    below would pass over an empty list and report success while checking
    nothing. That is the failure mode this whole file exists to prevent, so it
    must not be the failure mode of the file itself.
    """
    assert _migrations_altering_a_type(), (
        "no migration contains ALTER TYPE — the guard below is now vacuous"
    )


def test_every_alter_type_checks_the_type_exists_first():
    """
    An ALTER TYPE with no pg_type check ahead of it is the production outage.
    """
    offenders = []
    for path in _migrations_altering_a_type():
        code = _code_only(path)
        if "pg_type" not in code:
            offenders.append(path.name)

    assert not offenders, (
        "these migrations ALTER a type without first checking it exists, which "
        "fails pre-deploy on a database that does not have it: "
        + ", ".join(offenders)
    )


def test_0045_guards_both_of_its_types():
    """
    Both types are checked, not just the one that happened to fail first.

    subscription_tier raised before payment_purpose was ever reached, so a fix
    that guarded only the name in the traceback would fail again on the next
    deploy, one line further down.
    """
    path = VERSIONS / "0045_seller_basic_tier.py"
    code = _code_only(path)
    raw = path.read_text()

    assert "pg_type" in code, "0045 no longer checks the type exists"
    # Both type names must still be handled. They live in string literals, so
    # this reads the raw file — the point here is coverage, not guardedness.
    for type_name in ("subscription_tier", "payment_purpose"):
        assert type_name in raw, f"{type_name} no longer handled by 0045"

    # And the ALTERs must be built rather than written out as standalone
    # statements: a bare literal would mean the guarded path was bypassed.
    # Checked on code-only text so the traceback quoted in the file's comments
    # does not count against it.
    for hardcoded in (
        "ALTER TYPE subscription_tier ADD VALUE",
        "ALTER TYPE payment_purpose ADD VALUE",
    ):
        assert hardcoded not in code, (
            f"{hardcoded!r} appears outside the existence check"
        )
