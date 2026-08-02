"""
Initialize SQLite schema directly (bypassing Alembic's PostgreSQL-specific SQL).
Used for local development only - production uses Alembic + PostgreSQL.
"""
import asyncio

from sqlalchemy.ext.asyncio import create_async_engine

import models  # noqa: F401
from core.config import settings
from db.base import Base


async def init_sqlite_schema():
    """Create SQLite schema from SQLAlchemy models."""
    if not settings.async_database_url.startswith("sqlite"):
        print("⚠️  Not SQLite - skipping direct schema initialization")
        return

    print("📦 Initializing SQLite schema for local development...")

    # Create async engine
    engine = create_async_engine(
        settings.async_database_url,
        echo=False,
        connect_args={"check_same_thread": False},
    )

    try:
        # Create all tables from SQLAlchemy models
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        print("✅ SQLite schema initialized successfully")
    except Exception as e:
        print(f"❌ Schema initialization failed: {e}")
        raise
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(init_sqlite_schema())
