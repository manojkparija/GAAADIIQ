"""
Startup must tell the truth about migrations.

The deployment logs reported "Alembic: up to date" on every restart of a
database whose listings and cars tables the application could not read. Three
things combined to produce that:

  - alembic reports on stderr, and only stdout was logged, so the message was
    the empty-string fallback rather than anything alembic had said;
  - subprocess.run was called with check=False, so a failed upgrade never
    raised and the production re-raise below it was unreachable;
  - nothing configured logging, so the line would not have been emitted anyway.

Each of those is silent on its own. Together they made a broken schema
indistinguishable from a healthy one for as long as it took to notice that the
site was empty.
"""
import logging
import subprocess
from contextlib import suppress
from types import SimpleNamespace

import pytest

import main


def _completed(returncode: int, stdout: str = "", stderr: str = ""):
    return SimpleNamespace(returncode=returncode, stdout=stdout, stderr=stderr)


async def _run_lifespan():
    """Drive the startup half of the lifespan and stop before shutdown."""
    async with main.lifespan(main.app):
        return


@pytest.mark.asyncio
async def test_a_failed_migration_stops_production_startup(monkeypatch):
    monkeypatch.setattr(main.settings, "environment", "production")
    monkeypatch.setattr(
        subprocess, "run",
        lambda *a, **k: _completed(1, stderr="UndefinedColumnError: cars.fuel_type"),
    )

    with pytest.raises(RuntimeError, match="migration failed"):
        await _run_lifespan()


@pytest.mark.asyncio
async def test_a_failed_migration_is_logged_with_what_alembic_said(monkeypatch, caplog):
    monkeypatch.setattr(main.settings, "environment", "production")
    monkeypatch.setattr(
        subprocess, "run",
        lambda *a, **k: _completed(1, stderr="UndefinedColumnError: cars.fuel_type"),
    )

    with caplog.at_level(logging.ERROR), suppress(RuntimeError):
        await _run_lifespan()

    # The cause, not just the fact of failure — the traceback arrives on stderr.
    assert "cars.fuel_type" in caplog.text


@pytest.mark.asyncio
async def test_a_migration_warning_is_raised_to_error_level(monkeypatch, caplog):
    """
    A migration that cannot finish its job says so with RAISE WARNING rather
    than failing, because reconciling a legacy table can need a decision no
    migration should make alone. Buried among alembic's progress lines at INFO,
    that is a message nobody reads.
    """
    monkeypatch.setattr(main.settings, "environment", "production")
    monkeypatch.setattr(
        subprocess, "run",
        lambda *a, **k: _completed(
            0,
            stderr=(
                "INFO  [alembic.runtime.migration] Running upgrade 0017 -> 0018\n"
                "WARNING:  cars.id is bigint but the application keys the "
                "catalogue by uuid, and cars holds 42 rows\n"
            ),
        ),
    )

    with caplog.at_level(logging.ERROR):
        await _run_lifespan()

    assert "cars.id is bigint" in caplog.text


@pytest.mark.asyncio
async def test_a_successful_migration_reports_what_it_did(monkeypatch, caplog):
    monkeypatch.setattr(main.settings, "environment", "production")
    monkeypatch.setattr(
        subprocess, "run",
        lambda *a, **k: _completed(
            0, stderr="INFO  [alembic.runtime.migration] Running upgrade 0017 -> 0018"
        ),
    )

    with caplog.at_level(logging.INFO):
        await _run_lifespan()

    # Which migrations ran, rather than an unconditional "up to date".
    assert "0017 -> 0018" in caplog.text
