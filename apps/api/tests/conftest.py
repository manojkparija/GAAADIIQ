"""Shared pytest fixtures and configuration."""
import pytest

from db.session import get_db
from main import app


@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    """Ensure app.dependency_overrides is always clean between tests.

    If a test fixture crashes before its cleanup runs, stale overrides would
    cause subsequent tests to use a dropped in-memory DB and fail with
    'no such table' errors. This autouse fixture guarantees cleanup.
    """
    yield
    app.dependency_overrides.pop(get_db, None)
