"""
The Postgres pool checks a connection before handing it out.

WHAT THIS PREVENTS COMING BACK

Reported from the live site for a day: the New Cars page read "0 models
available" on a normal reload and showed the full catalogue after a hard
refresh, apparently at random. Six changes were made against the wrong layer —
the service worker, edge cache TTLs, the auth interceptor, cache-busting —
before the app was made to display the reason, which read:

    /cars?bucket=new&priced_only=true&page=1&page_size=100
      — HTTP 504 Gateway Timeout

Render's own log recorded 200 OK for those same requests. Both were true: the
query hung, the gateway gave up and answered the browser, and the request
completed long afterwards and logged its 200. The server log and the browser
were describing different moments, which is why they seemed to contradict.

Supabase closes idle connections server-side. Without `pool_pre_ping`
SQLAlchemy cannot know that: after a quiet spell it hands out a socket nobody
is listening to, and the query waits on it until TCP gives up — minutes, far
past any gateway's patience.

It also explains why it read as a caching bug for so long. A signed-out visitor
is served by the edge cache and never reaches the origin, while
core/cache_policy.py stamps `no-store` on any request carrying Authorization —
so a signed-in reader hits the origin every time and is the only one who ever
meets a dead connection. Every working observation that day was anonymous and
every failing one was signed in.

WHY A TEST AND NOT JUST A COMMENT

These are two keyword arguments in a dict. They are easy to drop in a refactor,
nothing fails when they go, and the symptom returns days later as an
intermittent timeout that looks like anything but a pool setting. The cost of
the guard is far below the cost of diagnosing it twice.
"""

import importlib


def _pg_engine_kwargs(monkeypatch, url: str = "postgresql+asyncpg://u:p@h/db") -> dict:
    """The kwargs db.session builds for a Postgres URL.

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
        return dict(module.engine_kwargs)
    finally:
        # Leave the module bound to the real settings for everything after this.
        monkeypatch.undo()
        importlib.reload(db.session)


def test_postgres_pool_pings_before_handing_out_a_connection(monkeypatch):
    """The one that fixes the 504.

    pre_ping issues a cheap SELECT 1 on checkout and silently replaces a
    connection that fails it. Without it a dead socket is handed to a query
    that then waits on it for minutes.
    """
    assert _pg_engine_kwargs(monkeypatch).get("pool_pre_ping") is True


def test_postgres_connections_are_retired_before_the_far_end_closes_them(monkeypatch):
    """pre_ping recovers from a dead connection; recycling avoids meeting one.

    The bound matters, not the exact number: it has to sit inside the idle
    timeouts Supabase and pgbouncer apply, and ten minutes is already longer
    than some of those.
    """
    recycle = _pg_engine_kwargs(monkeypatch).get("pool_recycle")
    assert recycle is not None, "connections are never retired"
    assert 0 < recycle <= 600, f"pool_recycle={recycle}s outlives common idle timeouts"


def test_sqlite_is_left_alone(monkeypatch):
    """SQLite uses NullPool and supports none of this.

    The suite itself runs on SQLite, so getting this wrong would break every
    test rather than just this one — but it would break them confusingly, and
    the assertion says which branch is which.
    """
    kwargs = _pg_engine_kwargs(monkeypatch, url="sqlite+aiosqlite:///./test.db")
    assert "pool_size" not in kwargs
    assert "pool_pre_ping" not in kwargs
    assert kwargs["connect_args"] == {"check_same_thread": False}
