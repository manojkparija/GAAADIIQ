"""Semantic search is off unless someone turns it on, and on means configured.

Production ran with `QDRANT_API_KEY="dummy"` for months. Not through
carelessness: `validate_production_config` refused to boot without the key, so
the only way to deploy was to put something — anything — in the box. The check
then passed forever while semantic search silently fell back to rule-based
matching and no listing was ever indexed.

A required secret that people satisfy with a placeholder is worse than no
requirement. These tests pin the shape that replaced it.
"""

import pytest

from core.config import Settings


def _prod(**overrides) -> Settings:
    """A Settings object that looks like production, minus the bits under test."""
    base = dict(
        environment="production",
        jwt_private_key="x", jwt_public_key="y",
        RAZORPAY_KEY_ID="k", RAZORPAY_KEY_SECRET="s",
        SMTP_HOST="smtp.example.com",
    )
    base.update(overrides)
    return Settings(**base)


def test_semantic_search_is_off_by_default():
    """The honest default: no Qdrant has ever been provisioned for this product."""
    assert Settings().semantic_search_enabled is False


def test_production_boots_without_any_qdrant_configuration(monkeypatch):
    """
    The whole point. With the feature off, nothing about Qdrant should stand
    between a deploy and a running service.
    """
    monkeypatch.setenv("METRICS_TOKEN", "t")
    settings = _prod(semantic_search_enabled=False, qdrant_api_key="")
    settings.validate_production_config()  # must not raise or exit


def test_enabling_it_without_a_cluster_is_refused(monkeypatch):
    """Opt in, and the configuration has to be real."""
    monkeypatch.setenv("METRICS_TOKEN", "t")
    settings = _prod(
        semantic_search_enabled=True,
        qdrant_url="http://localhost:6333",
        qdrant_api_key="a-real-looking-key",
    )
    with pytest.raises(SystemExit):
        settings.validate_production_config()


@pytest.mark.parametrize("placeholder", ["dummy", "DUMMY", " changeme ", "placeholder", "todo", ""])
def test_a_placeholder_key_is_not_a_configuration(monkeypatch, placeholder):
    """
    The specific failure this replaces. "dummy" satisfied the old check and
    told us nothing; it must now fail loudly at the point of the lie.
    """
    monkeypatch.setenv("METRICS_TOKEN", "t")
    settings = _prod(
        semantic_search_enabled=True,
        qdrant_url="https://cluster.eu-central.aws.cloud.qdrant.io:6333",
        qdrant_api_key=placeholder,
    )
    with pytest.raises(SystemExit):
        settings.validate_production_config()


def test_a_real_configuration_is_accepted(monkeypatch):
    monkeypatch.setenv("METRICS_TOKEN", "t")
    settings = _prod(
        semantic_search_enabled=True,
        qdrant_url="https://cluster.eu-central.aws.cloud.qdrant.io:6333",
        qdrant_api_key="qdr_live_abc123",
    )
    settings.validate_production_config()


def test_the_vector_store_is_inert_while_disabled(monkeypatch):
    """
    No client, so no connection attempt, so no per-listing timeout and no
    connection-refused warning on every boot.
    """
    from services import vector_store

    monkeypatch.setattr(vector_store.settings, "semantic_search_enabled", False)
    assert vector_store._client() is None
    assert vector_store.ensure_collection() is False
