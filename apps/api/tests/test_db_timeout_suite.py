"""
Nothing waits on the database longer than the gateway will wait on us.

WHAT THIS PREVENTS COMING BACK

The catalogue failed on the live site for two days with the browser showing:

    /cars?bucket=new&priced_only=true&page=1&page_size=100
      — HTTP 504 Gateway Timeout

while Render's own log recorded 200 OK for the same requests. Both were true:
the request hung, the gateway gave up at around 100 seconds and answered the
browser itself, and the request finished long afterwards and logged its 200.

`pool_pre_ping` and `pool_recycle` shipped first (#223, deployed and confirmed
in Render's deploy list) and the 504 came back, so a dead pooled socket was not
the whole cause. These bounds do not depend on knowing the cause: whatever
stalls — a hung connect, a query waiting on a lock, a network path that
black-holes — the request is cut off at 15s instead of holding a worker for a
minute and a half. This service runs WEB_CONCURRENCY=1, so one stuck request is
the entire API, which is why an unbounded wait is the expensive part.

WHY THE NUMBERS ARE ASSERTED AS A RANGE

The exact values are a judgement, and pinning them exactly would make this test
fail every time someone tunes them. What must not come back is the absence of a
bound, or a bound so large it is past the gateway's patience and therefore does
nothing at all.
"""

import importlib

# The gateway in front of this service gives up at roughly this point. A
# database bound at or above it never fires, because the browser has already
# been answered by then.
GATEWAY_PATIENCE_SECONDS = 100


def _pg_connect_args(monkeypatch, url: str = "postgresql+asyncpg://u:p@h/db") -> dict:
    """The connect_args db.session builds for a Postgres URL.

    Imported fresh with the URL patched, because the module decides at import
    time and the test suite itself runs on SQLite.
    """
    import core.config

    monkeypatch.setattr(
        type(core.config.settings),
        "async_database_url",
        property(lambda self: url),
        raising=False,
    )

    import db.session

    module = importlib.reload(db.session)
    try:
        return dict(module.engine_kwargs.get("connect_args", {}))
    finally:
        # Leave the module bound to the real settings for everything after this.
        monkeypatch.undo()
        importlib.reload(db.session)


def test_opening_a_connection_gives_up_rather_than_hanging(monkeypatch):
    timeout = _pg_connect_args(monkeypatch).get("timeout")
    assert timeout is not None, "a connect can hang indefinitely"
    assert 0 < timeout < GATEWAY_PATIENCE_SECONDS, (
        f"connect timeout={timeout}s is not inside the gateway's patience"
    )


def test_a_single_statement_cannot_outlive_the_gateway(monkeypatch):
    """The client-side bound: asyncpg stops waiting and raises."""
    command_timeout = _pg_connect_args(monkeypatch).get("command_timeout")
    assert command_timeout is not None, "a query can run unbounded"
    assert 0 < command_timeout < GATEWAY_PATIENCE_SECONDS, (
        f"command_timeout={command_timeout}s is not inside the gateway's patience"
    )


def test_postgres_is_told_to_stop_working_on_it_too(monkeypatch):
    """The server-side half, and it is not redundant.

    command_timeout makes the client stop waiting; without statement_timeout
    Postgres carries on executing a query whose answer nobody will read,
    holding locks and burning a connection on the far side.
    """
    server_settings = _pg_connect_args(monkeypatch).get("server_settings") or {}
    raw = server_settings.get("statement_timeout")
    assert raw is not None, "Postgres is never told to abandon a slow query"

    # Postgres takes this in milliseconds when given a bare number.
    seconds = int(str(raw).strip()) / 1000
    assert 0 < seconds < GATEWAY_PATIENCE_SECONDS, (
        f"statement_timeout={seconds}s is not inside the gateway's patience"
    )


def test_sqlite_is_left_alone(monkeypatch):
    """SQLite supports none of this, and the suite itself runs on SQLite.

    Getting this wrong would break every test rather than just this one — but
    confusingly, so the assertion says which branch is which.
    """
    args = _pg_connect_args(monkeypatch, url="sqlite+aiosqlite:///./test.db")
    assert args == {"check_same_thread": False}


def test_a_database_timeout_is_reported_as_retryable(monkeypatch):
    """503, not 500, and the distinction is the whole point.

    The browser decides whether to try again from the status. CarsDataService
    retries 502/503/504 and gives up immediately on a 500, so returning 500
    here would turn a moment of contention into an outage panel — the exact
    failure this change exists to stop.
    """
    import main

    assert main._database_timeout_handler is not None

    handlers = main.app.exception_handlers
    assert TimeoutError in handlers, "an asyncio timeout still becomes a 500"

    from sqlalchemy.exc import TimeoutError as SQLTimeoutError

    assert SQLTimeoutError in handlers, "a SQLAlchemy timeout still becomes a 500"


def test_the_timeout_handler_answers_503_with_a_retry_hint():
    import asyncio

    from fastapi import Request

    import main

    scope = {
        "type": "http",
        "method": "GET",
        "path": "/cars",
        "headers": [],
        "query_string": b"",
    }
    response = asyncio.run(
        main._database_timeout_handler(Request(scope), TimeoutError("too slow"))
    )

    assert response.status_code == 503
    assert response.headers.get("Retry-After") == "1"
