"""
The SMTP password the dashboard holds is the one the code reads.

REPORTED by reading the production dashboard: it sets SMTP_PASSWORD. config.py
declared SMTP_PASS. The two never met, so services/email.py authenticated with
an empty password against a host that WAS configured, and its single
`except Exception` logged the refusal and returned. Mail has been failing for
as long as both have existed and nothing in the product said so.

WHY AN ALIAS RATHER THAN A RENAME

Renaming the field to SMTP_PASSWORD is the smaller diff and the worse change:
any .env, CI job or second deployment still saying SMTP_PASS would break the
moment it shipped, and that breakage would be just as quiet as this one.
Accepting both names cannot break either.

SMTP_PASS stays first in the AliasChoices so an explicit one keeps winning.
"""

from core.config import Settings


def test_the_dashboards_spelling_is_read(monkeypatch):
    # THE REPORTED BUG. Before the alias this returned "".
    monkeypatch.setenv("SMTP_PASSWORD", "from-the-dashboard")
    monkeypatch.delenv("SMTP_PASS", raising=False)

    assert Settings(_env_file=None).SMTP_PASS == "from-the-dashboard"


def test_the_original_spelling_still_works(monkeypatch):
    # The half a rename would have broken.
    monkeypatch.setenv("SMTP_PASS", "from-dotenv")
    monkeypatch.delenv("SMTP_PASSWORD", raising=False)

    assert Settings(_env_file=None).SMTP_PASS == "from-dotenv"


def test_the_explicit_name_wins_when_both_are_set(monkeypatch):
    # Not arbitrary: SMTP_PASS is the name the code has always declared, so a
    # deployment that sets it means it.
    monkeypatch.setenv("SMTP_PASS", "explicit")
    monkeypatch.setenv("SMTP_PASSWORD", "alias")

    assert Settings(_env_file=None).SMTP_PASS == "explicit"


def test_neither_set_is_still_empty_rather_than_an_error(monkeypatch):
    # email.py treats empty as "no auth" and passes None. A missing password
    # must stay a configuration state, not a startup crash.
    monkeypatch.delenv("SMTP_PASS", raising=False)
    monkeypatch.delenv("SMTP_PASSWORD", raising=False)

    assert Settings(_env_file=None).SMTP_PASS == ""


def test_the_other_smtp_fields_are_untouched(monkeypatch):
    # The alias is one field. A change that quietly altered SMTP_FROM's default
    # would send mail from the wrong address.
    monkeypatch.delenv("SMTP_FROM", raising=False)
    monkeypatch.delenv("SMTP_USER", raising=False)
    monkeypatch.delenv("SMTP_PORT", raising=False)
    s = Settings(_env_file=None)

    assert s.SMTP_FROM == "noreply@gaadiiq.com"
    assert s.SMTP_USER == ""
    assert s.SMTP_PORT == 587
