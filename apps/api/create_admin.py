"""
Create an admin user for GAADIIQ.

Usage:
  cd apps/api
  python create_admin.py
"""
import asyncio
import sys

sys.path.insert(0, ".")

from sqlalchemy import select
from db.session import AsyncSessionLocal
from core.security import hash_password
from models.user import User

ADMIN_EMAIL = "manojkparija@gaadiiq.com"
ADMIN_PASSWORD = "Admin@123"


async def create_admin():
    async with AsyncSessionLocal() as session:
        # Check if admin already exists
        result = await session.execute(
            select(User).where(User.email == ADMIN_EMAIL)
        )
        admin = result.scalar_one_or_none()

        if admin is None:
            admin = User(
                email=ADMIN_EMAIL,
                hashed_password=hash_password(ADMIN_PASSWORD),
                full_name="GAADIIQ Admin",
                role="admin",
                is_verified=True,
                is_active=True,
            )
            session.add(admin)
            await session.commit()
            print(f"✓ Admin user created successfully!")
            print(f"  Email: {ADMIN_EMAIL}")
            print(f"  Password: {ADMIN_PASSWORD}")
            print(f"\nYou can now log in with these credentials.")
        else:
            print(f"ℹ Admin user already exists: {ADMIN_EMAIL}")
            print(f"  If you forgot the password, you'll need to reset it.")


if __name__ == "__main__":
    asyncio.run(create_admin())
