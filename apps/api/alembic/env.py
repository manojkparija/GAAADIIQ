import asyncio
import os
import sys
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# make sure app modules are importable
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import models  # noqa: E402, F401 — import all models so they register with Base.metadata
from core.config import settings  # noqa: E402
from db.base import Base  # noqa: E402

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Override sqlalchemy.url from our settings so we never hardcode credentials
config.set_main_option("sqlalchemy.url", settings.async_database_url)

target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    from sqlalchemy.ext.asyncio import create_async_engine

    db_url = config.get_main_option("sqlalchemy.url")

    # Debug: print URL info (first 80 chars to hide password)
    print(f"[ALEMBIC] URL (first 80): {db_url[:80] if db_url else 'NOT SET'}")
    print(f"[ALEMBIC] URL length: {len(db_url) if db_url else 0}")
    print(f"[ALEMBIC] Has /postgres: {'postgres' in db_url}")

    # For cloud databases like Supabase, SSL is required
    connect_args = {"ssl": True} if "supabase" in db_url or "cloud" in db_url else {}
    print(f"[ALEMBIC] connect_args: {connect_args}")

    try:
        connectable = create_async_engine(
            db_url,
            connect_args=connect_args,
            poolclass=pool.NullPool,
            echo=False,
        )
        print("[ALEMBIC] Engine created successfully")

        async with connectable.connect() as connection:
            print("[ALEMBIC] Connected to database, running migrations...")
            await connection.run_sync(do_run_migrations)
            print("[ALEMBIC] Migrations complete")

        await connectable.dispose()
    except Exception as e:
        print(f"[ALEMBIC] ERROR: {type(e).__name__}: {e}")
        raise


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""

    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
