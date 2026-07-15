"""
Auth endpoint tests — register, login, /auth/me, JWT validation.
Uses in-memory SQLite; overrides the DB dependency to avoid needing Postgres.
"""
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from db.base import Base
from db.session import get_db
from main import app

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture
async def db_engine():
    engine = create_async_engine(TEST_DB_URL, echo=False, connect_args={"check_same_thread": False}, poolclass=StaticPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def client(db_engine):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


# --- Register ---

@pytest.mark.asyncio
async def test_register_success(client: AsyncClient):
    resp = await client.post("/auth/register", json={
        "email": "user@gaadiiq.com",
        "password": "secret123",
        "full_name": "Manoj Test",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["email"] == "user@gaadiiq.com"
    assert data["user"]["role"] == "buyer"


@pytest.mark.asyncio
async def test_register_duplicate_email(client: AsyncClient):
    payload = {"email": "dup@gaadiiq.com", "password": "secret123"}
    await client.post("/auth/register", json=payload)
    resp = await client.post("/auth/register", json=payload)
    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_register_weak_password(client: AsyncClient):
    resp = await client.post("/auth/register", json={
        "email": "weak@gaadiiq.com",
        "password": "short",
    })
    assert resp.status_code == 422


# --- Login ---

@pytest.mark.asyncio
async def test_login_success(client: AsyncClient):
    await client.post("/auth/register", json={
        "email": "login@gaadiiq.com",
        "password": "mypassword",
    })
    resp = await client.post("/auth/login", json={
        "email": "login@gaadiiq.com",
        "password": "mypassword",
    })
    assert resp.status_code == 200
    assert "access_token" in resp.json()


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient):
    await client.post("/auth/register", json={
        "email": "wrongpw@gaadiiq.com",
        "password": "correctpass",
    })
    resp = await client.post("/auth/login", json={
        "email": "wrongpw@gaadiiq.com",
        "password": "wrongpass",
    })
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_unknown_email(client: AsyncClient):
    resp = await client.post("/auth/login", json={
        "email": "nobody@gaadiiq.com",
        "password": "anything",
    })
    assert resp.status_code == 401


# --- /auth/me ---

@pytest.mark.asyncio
async def test_me_returns_current_user(client: AsyncClient):
    reg = await client.post("/auth/register", json={
        "email": "me@gaadiiq.com",
        "password": "testpass1",
        "full_name": "Me User",
    })
    token = reg.json()["access_token"]
    resp = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["email"] == "me@gaadiiq.com"
    assert resp.json()["full_name"] == "Me User"


@pytest.mark.asyncio
async def test_me_rejects_invalid_token(client: AsyncClient):
    resp = await client.get("/auth/me", headers={"Authorization": "Bearer invalid.token.here"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_me_requires_auth(client: AsyncClient):
    resp = await client.get("/auth/me")
    assert resp.status_code in (401, 403)  # HTTPBearer returns 403 pre-Starlette 0.21, 401 after
