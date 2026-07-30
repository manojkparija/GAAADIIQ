"""
An unhandled server error must reach the browser as a readable 500.

Starlette's ServerErrorMiddleware sits above CORSMiddleware, so a crash it
handles returns a 500 with no Access-Control-Allow-Origin header. The browser
will not expose such a response to JavaScript: the fetch rejects, Angular sees
status 0, and the UI says "Could not reach the API" — pointing the operator at
network and deployment problems while the real cause is a traceback in the
server log.

These tests pin the fix: the error response carries CORS headers, so the
frontend can read the status and say what actually happened.
"""
import pytest
from fastapi.testclient import TestClient

ORIGIN = "http://localhost:4200"


@pytest.fixture
def crashing_app():
    """The real app's middleware stack, plus one route that always raises."""
    from main import app

    @app.get("/__test_crash", include_in_schema=False)
    async def _crash():
        raise RuntimeError("boom — simulated unhandled error")

    yield app

    # Leave the shared app as it was found; other test modules import it.
    app.router.routes = [
        r for r in app.router.routes if getattr(r, "path", None) != "/__test_crash"
    ]


def test_unhandled_error_returns_500_not_a_dropped_connection(crashing_app):
    # raise_server_exceptions=False makes TestClient behave like a real server
    # and return the 500 rather than re-raising into the test.
    client = TestClient(crashing_app, raise_server_exceptions=False)
    response = client.get("/__test_crash", headers={"Origin": ORIGIN})

    assert response.status_code == 500


def test_error_response_carries_the_cors_header(crashing_app):
    """
    The header is the whole point. Without it the browser discards the
    response and the frontend cannot tell a crash from an unreachable host.
    """
    client = TestClient(crashing_app, raise_server_exceptions=False)
    response = client.get("/__test_crash", headers={"Origin": ORIGIN})

    assert response.headers.get("access-control-allow-origin") == ORIGIN


def test_error_body_is_readable_json_without_leaking_internals(crashing_app):
    client = TestClient(crashing_app, raise_server_exceptions=False)
    response = client.get("/__test_crash", headers={"Origin": ORIGIN})

    detail = response.json()["detail"]
    assert "logs" in detail.lower()
    # The exception message stays in the server log, not in the browser.
    assert "boom" not in detail


def test_successful_requests_are_untouched(crashing_app):
    client = TestClient(crashing_app)
    response = client.get("/health", headers={"Origin": ORIGIN})

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == ORIGIN
