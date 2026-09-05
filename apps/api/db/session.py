from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from core.config import settings

# SQLite doesn't support pool_size/max_overflow; PostgreSQL does
engine_kwargs = {
    "echo": settings.debug,
}

if settings.async_database_url.startswith("sqlite"):
    # SQLite: use NullPool (no connection pooling)
    engine_kwargs["connect_args"] = {"check_same_thread": False}
    engine_kwargs["poolclass"] = NullPool
else:
    # PostgreSQL: enable connection pooling
    engine_kwargs["pool_size"] = 10
    engine_kwargs["max_overflow"] = 20

    # Check a pooled connection is alive before handing it out.
    #
    # THE 504 THIS FIXES
    #
    # Reported from the live site for a day: "0 models available" on a normal
    # reload, the full catalogue after a hard refresh, seemingly at random. The
    # browser was eventually made to show the reason and it read
    #
    #   /cars?bucket=new&priced_only=true&page=1&page_size=100
    #     — HTTP 504 Gateway Timeout
    #
    # while Render's own log recorded 200 OK for the same requests. Both are
    # true: the query hung, the gateway gave up and answered the browser, and
    # the request finished long afterwards and logged its 200.
    #
    # Supabase closes idle connections server-side. Without pre-ping SQLAlchemy
    # cannot know that, so after a quiet spell it hands out a socket nobody is
    # listening to and the query waits on it until TCP gives up — minutes, far
    # past any gateway's patience. pre_ping issues a cheap SELECT 1 on checkout
    # and silently replaces a connection that fails it.
    #
    # It also explains why this looked like a caching bug for so long. A signed
    # -out visitor is served by the edge cache and never reaches the origin;
    # core/cache_policy.py stamps no-store on any request carrying
    # Authorization, so a signed-in reader hits the origin every single time
    # and is the only one who ever meets a dead connection. Every working
    # observation all day was anonymous, and every failing one was signed in.
    engine_kwargs["pool_pre_ping"] = True

    # And retire connections before the far end does.
    #
    # pre_ping recovers from a dead connection; recycling avoids meeting one.
    # Five minutes is comfortably inside the idle timeouts Supabase and
    # pgbouncer apply, and costs nothing on a busy pool because a connection in
    # constant use never reaches the age limit.
    engine_kwargs["pool_recycle"] = 300
    # "require" encrypts the connection but does not verify the server
    # certificate chain. Supabase's direct endpoint (db.*.supabase.co) presents
    # a chain that no standard trust store can validate — asyncpg's ssl=True and
    # an explicit certifi CA bundle both fail there with
    # CERTIFICATE_VERIFY_FAILED ("self-signed certificate in certificate
    # chain"), which took down every database call in the API.
    #
    # Trade-off: traffic is encrypted, but an active MITM on the database link
    # would not be detected. To restore full verification, fetch Supabase's CA
    # certificate and pass an ssl.SSLContext built with it instead.
    engine_kwargs["connect_args"] = {"ssl": "require"}

engine = create_async_engine(settings.async_database_url, **engine_kwargs)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
    class_=AsyncSession,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
