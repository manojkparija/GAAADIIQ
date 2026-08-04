#!/usr/bin/env python3
"""
Standalone schema fixer - adds missing columns to the database.
Run this directly: python fix_schema.py
"""

import asyncio
import sys
from pathlib import Path
from urllib.parse import urlparse

import asyncpg


async def fix_schema():
    """Add all missing columns to the database."""

    # Read .env file
    env_file = Path(__file__).parent / ".env"
    if not env_file.exists():
        print("❌ .env file not found")
        return False

    database_url = None
    with open(env_file) as f:
        for line in f:
            if line.startswith("DATABASE_URL="):
                database_url = line.split("=", 1)[1].strip()
                break

    if not database_url:
        print("❌ DATABASE_URL not found in .env")
        return False

    print("📡 Connecting to database...")
    print(f"   Host: {database_url.split('@')[1].split('/')[0]}")

    # Parse connection string
    database_url = database_url.replace("postgresql+asyncpg://", "postgresql://")
    parsed = urlparse(database_url)

    # Connect with retries
    conn = None
    for attempt in range(1, 4):
        try:
            print(f"   Attempt {attempt}/3...", end=" ")
            conn = await asyncio.wait_for(
                asyncpg.connect(
                    host=parsed.hostname,
                    port=parsed.port,
                    user=parsed.username,
                    password=parsed.password,
                    database=parsed.path.lstrip("/"),
                    # See db/session.py: Supabase's chain fails verification.
                    ssl="require",
                    timeout=30,
                ),
                timeout=35,
            )
            print("✅")
            break
        except asyncio.TimeoutError:
            print("timeout")
            if attempt < 3:
                print("   Waiting before retry...")
                await asyncio.sleep(3)
        except Exception as e:
            print(f"error: {e}")
            if attempt < 3:
                await asyncio.sleep(3)

    if not conn:
        print("\n❌ Could not connect to database after 3 attempts")
        print("\n💡 The mobile hotspot may be blocking PostgreSQL connections.")
        print("   Solution: Execute the SQL in Supabase SQL Editor:\n")
        print("   1. Go to https://app.supabase.com/project/[YOUR-PROJECT]/sql/new")
        print("   2. Copy and run this SQL:\n")
        print("      ALTER TABLE refresh_tokens")
        print("      ADD COLUMN IF NOT EXISTS revoked BOOLEAN NOT NULL DEFAULT FALSE;\n")
        return False

    try:
        print("\n🔧 Applying schema fixes...\n")

        # Add missing revoked column to refresh_tokens
        try:
            await conn.execute(
                "ALTER TABLE refresh_tokens "
                "ADD COLUMN IF NOT EXISTS revoked BOOLEAN NOT NULL DEFAULT FALSE;"
            )
            print("✅ refresh_tokens.revoked column")
        except asyncpg.DuplicateColumnError:
            print("⚠️  refresh_tokens.revoked already exists")
        except Exception as e:
            print(f"❌ refresh_tokens.revoked: {e}")
            return False

        # Verify schema
        print("\n📋 Verifying schema:\n")
        columns = await conn.fetch(
            "SELECT column_name, data_type, is_nullable "
            "FROM information_schema.columns "
            "WHERE table_name = 'refresh_tokens' "
            "ORDER BY ordinal_position;"
        )

        print("   refresh_tokens columns:")
        for col in columns:
            nullable = "NULL" if col["is_nullable"] else "NOT NULL"
            print(f"     • {col['column_name']:20} {col['data_type']:15} {nullable}")

        print("\n✅ Schema fix complete!")
        print("\n📝 Next steps:")
        print("   1. Restart the API server: python -m uvicorn main:app --reload")
        print("   2. Test registration: POST /auth/register")
        print("   3. Or go to http://localhost:8000/docs for Swagger UI")

        return True

    finally:
        await conn.close()


async def main():
    try:
        success = await fix_schema()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\n⚠️  Cancelled by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
