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
