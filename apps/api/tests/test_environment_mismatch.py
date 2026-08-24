"""
Does the environment we declare match what we are connected to?

WHY THIS CHECK IS NOT PART OF validate_production_config

That method opens with `if not self.is_production: return`. Every check it makes
is gated on the one flag most worth doubting — so a deployment with ENVIRONMENT
unset or misspelt skips all of them in silence. And it is not alone in trusting
that string:

  * core/dependencies.py hands an unauthenticated caller a synthetic Dev Admin
  * routers/payments.py accepts a dev-mode bypass
  * core/limiter.py disables rate limiting entirely

One wrong string is an open admin API, auto-approved payments and no rate
limiting, simultaneously, against real data. So this runs unconditionally and
asks the opposite question: not "are we configured for production" but "does
what we are connected to look like production, whatever we called ourselves".
"""
import pytest

from core.config import settings


@pytest.fixture
def env(monkeypatch):
    def _set(environment: str, database_url: str):
        monkeypatch.setattr(settings, "environment", environment, raising=False)
        monkeypatch.setattr(settings, "database_url", database_url, raising=False)
        return settings.environment_mismatch()

    return _set


def test_dev_flag_against_a_remote_database_is_the_dangerous_case(env):
    """
    The combination that matters: the bypasses are live and the data is real.

    This is the shape of a real accident — a Render service whose ENVIRONMENT
    was never set, or was set to "Production" with a capital P, pointed at the
    live Supabase.
    """
    msg = env("development", "postgresql+asyncpg://u:p@db.abcdefg.supabase.co:5432/postgres")
    assert msg is not None
    assert "Dev Admin" in msg, "the message must say what is actually exposed"


def test_a_misspelt_environment_is_caught_the_same_way(env):
    """
    is_production is an exact string comparison, so "Production" is not
    production — and nothing else in the codebase would have said so.
    """
    assert env("Production", "postgresql://u:p@db.x.supabase.co:5432/postgres") is not None


def test_production_pointed_at_a_local_database_is_also_a_mismatch(env):
    msg = env("production", "postgresql+asyncpg://u:p@localhost:5432/gaadiiq")
    assert msg is not None
    assert "holds nothing" in msg


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+asyncpg://u:p@localhost:5432/gaadiiq",
        "postgresql+asyncpg://u:p@127.0.0.1:5432/gaadiiq",
        "sqlite+aiosqlite:///./gaadiiq.db",
        "postgresql+asyncpg://u:p@host.docker.internal:5432/g",
        "postgresql+asyncpg://u:p@192.168.1.20:5432/g",
    ],
)
def test_ordinary_local_development_is_silent(env, url):
    """
    A check that cries wolf on every developer's machine gets ignored, and an
    ignored check is worse than none — this is the same trap as a permanently
    red CI step. CI runs against a localhost Postgres and must stay quiet too.
    """
    assert env("development", url) is None


def test_a_real_production_deployment_is_silent(env):
    assert env("production", "postgresql+asyncpg://u:p@db.x.supabase.co:5432/postgres") is None


@pytest.mark.parametrize("url", ["", "not a url at all", "postgresql://[oops"])
def test_a_url_it_cannot_read_is_not_treated_as_evidence(env, url):
    """
    Saying nothing beats a false alarm. The whole value of this check is that
    when it does speak, it is worth reading.
    """
    assert env("development", url) is None


def test_it_ships_warn_only():
    """
    The flag exists so the refuse-to-boot behaviour is a separate, later
    decision.

    This check reasons from a heuristic — the database host — so it can be
    wrong in ways no test here would reveal. A refuse-to-boot heuristic that is
    wrong takes the service down on the exact release meant to harden it, and on
    a production we cannot reach into afterwards that is not recoverable. Ship
    it warn-only, read the log against a real deployment, then turn it on.
    """
    assert settings.strict_environment_check is False
