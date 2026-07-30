"""
Supabase-issued tokens must authenticate against this API.

The UI signs in through Supabase, which uses HS256 with the project secret.
get_current_user previously verified only this backend's own RS256 tokens, so
every signed-in user was rejected with "Not authenticated" — including admins
trying to upload a brochure.
"""
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core.config import settings
from db.session import get_db
from main import app
from models.user import User, UserRole

SECRET = "test-supabase-jwt-secret"


def _supabase_token(email: str) -> str:
    """A token shaped like Supabase's: HS256, project secret, email claim."""
    return jwt.encode(
        {"sub": str(uuid.uuid4()), "email": email, "aud": "authenticated"},
        SECRET,
        algorithm="HS256",
    )


@pytest_asyncio.fixture
async def client(db_engine, monkeypatch):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)

    async def override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    monkeypatch.setattr(settings, "supabase_jwt_secret", SECRET)
    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        c.session_factory = session_factory
        yield c
    app.dependency_overrides.clear()


class TestSupabaseTokenAuthSuite:
    @pytest.mark.asyncio
    async def test_supabase_token_is_accepted(self, client, monkeypatch):
        monkeypatch.setattr(settings, "admin_emails", "boss@gaadiiq.com")
        r = await client.get(
            "/brochures/jobs",
            headers={"Authorization": f"Bearer {_supabase_token('boss@gaadiiq.com')}"},
        )
        assert r.status_code == 200, r.text

    @pytest.mark.asyncio
    async def test_admin_allowlist_grants_access(self, client, monkeypatch):
        # A genuine admin whose local row predates their promotion must not be
        # locked out of admin endpoints.
        monkeypatch.setattr(settings, "admin_emails", "boss@gaadiiq.com")
        async with client.session_factory() as s:
            s.add(User(
                id=uuid.uuid4(), email="boss@gaadiiq.com",
                hashed_password=None, role=UserRole.buyer, is_verified=True,
            ))
            await s.commit()

        r = await client.get(
            "/brochures/jobs",
            headers={"Authorization": f"Bearer {_supabase_token('boss@gaadiiq.com')}"},
        )
        assert r.status_code == 200

    @pytest.mark.asyncio
    async def test_non_admin_is_forbidden_not_unauthenticated(self, client, monkeypatch):
        # 403 not 401: the caller proved who they are, they simply lack the role.
        monkeypatch.setattr(settings, "admin_emails", "")
        r = await client.get(
            "/brochures/jobs",
            headers={"Authorization": f"Bearer {_supabase_token('buyer@example.com')}"},
        )
        assert r.status_code == 403

    @pytest.mark.asyncio
    async def test_first_login_provisions_a_local_row(self, client, monkeypatch):
        monkeypatch.setattr(settings, "admin_emails", "boss@gaadiiq.com")
        await client.get(
            "/brochures/jobs",
            headers={"Authorization": f"Bearer {_supabase_token('boss@gaadiiq.com')}"},
        )
        async with client.session_factory() as s:
            user = (await s.execute(
                select(User).where(User.email == "boss@gaadiiq.com")
            )).scalar_one_or_none()
        assert user is not None
        assert user.role == UserRole.admin
        # Authentication happens at Supabase; no password is stored here.
        assert user.hashed_password is None

    @pytest.mark.asyncio
    async def test_a_forged_token_is_rejected(self, client):
        forged = jwt.encode(
            {"sub": str(uuid.uuid4()), "email": "attacker@evil.com"},
            "not-the-project-secret",
            algorithm="HS256",
        )
        r = await client.get("/brochures/jobs", headers={"Authorization": f"Bearer {forged}"})
        assert r.status_code == 401

    @pytest.mark.asyncio
    async def test_role_claim_in_the_token_cannot_grant_admin(self, client, monkeypatch):
        # The identity provider's claims are client-controlled; only server-side
        # configuration may confer admin.
        monkeypatch.setattr(settings, "admin_emails", "")
        sneaky = jwt.encode(
            {"sub": str(uuid.uuid4()), "email": "buyer@example.com", "role": "admin"},
            SECRET, algorithm="HS256",
        )
        r = await client.get("/brochures/jobs", headers={"Authorization": f"Bearer {sneaky}"})
        assert r.status_code == 403

    @pytest.mark.asyncio
    async def test_no_token_is_still_unauthenticated(self, client):
        assert (await client.get("/brochures/jobs")).status_code == 401


class TestAsymmetricSupabaseKeysSuite:
    """
    Newer Supabase projects sign with ES256 keys published at a JWKS endpoint
    and have no shared secret at all. A deployment must not break when the
    project is migrated, so both signing modes are accepted.
    """

    @staticmethod
    def _es256_keypair():
        """A private key PEM plus the matching public JWK, as Supabase publishes."""
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec
        from jose import jwk

        private = ec.generate_private_key(ec.SECP256R1())
        pem = private.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode()
        public_pem = private.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode()

        public_jwk = jwk.construct(public_pem, algorithm="ES256").to_dict()
        # to_dict() can hand back bytes for the coordinates; a JWKS served over
        # HTTP is JSON, so normalise to str or the verifier rejects the key.
        public_jwk = {
            k: (v.decode() if isinstance(v, bytes) else v) for k, v in public_jwk.items()
        }
        public_jwk["kid"] = "test-key-1"
        return pem, public_jwk

    @pytest.mark.asyncio
    async def test_es256_token_is_accepted(self, client, monkeypatch):
        import services.llm_tier as llm_tier

        pem, public_jwk = self._es256_keypair()
        monkeypatch.setattr(settings, "admin_emails", "boss@gaadiiq.com")
        # No shared secret exists on an asymmetric project.
        monkeypatch.setattr(settings, "supabase_jwt_secret", "")
        monkeypatch.setattr(settings, "supabase_url", "https://test.supabase.co")
        monkeypatch.setattr(llm_tier, "_JWKS", {"keys": [public_jwk]})
        monkeypatch.setattr(llm_tier, "_JWKS_FETCHED_AT", 9e18)  # never expire

        token = jwt.encode(
            {"sub": str(uuid.uuid4()), "email": "boss@gaadiiq.com", "aud": "authenticated"},
            pem, algorithm="ES256", headers={"kid": "test-key-1"},
        )
        r = await client.get("/brochures/jobs", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200, r.text

    @pytest.mark.asyncio
    async def test_token_signed_by_another_key_is_rejected(self, client, monkeypatch):
        import services.llm_tier as llm_tier

        _, published_jwk = self._es256_keypair()
        attacker_pem, _ = self._es256_keypair()
        monkeypatch.setattr(settings, "supabase_jwt_secret", "")
        monkeypatch.setattr(settings, "supabase_url", "https://test.supabase.co")
        monkeypatch.setattr(llm_tier, "_JWKS", {"keys": [published_jwk]})
        monkeypatch.setattr(llm_tier, "_JWKS_FETCHED_AT", 9e18)

        token = jwt.encode(
            {"sub": str(uuid.uuid4()), "email": "attacker@evil.com"},
            attacker_pem, algorithm="ES256", headers={"kid": "test-key-1"},
        )
        r = await client.get("/brochures/jobs", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401
