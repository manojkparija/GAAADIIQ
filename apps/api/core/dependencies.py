import uuid

from fastapi import Cookie, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.security import ACCESS_TOKEN_COOKIE, decode_access_token
from db.session import get_db
from models.user import User, UserRole

bearer_scheme = HTTPBearer(auto_error=False)

_unauthorized = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    cookie_token: str | None = Cookie(default=None, alias=ACCESS_TOKEN_COOKIE),
    db: AsyncSession = Depends(get_db),
) -> User:
    # Bearer token takes precedence (explicit API call); fall back to httpOnly cookie (browser)
    raw_token: str | None = None
    if credentials:
        raw_token = credentials.credentials
    elif cookie_token:
        raw_token = cookie_token

    if raw_token is None:
        raise _unauthorized

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    payload = decode_access_token(raw_token)
    if payload:
        user_id_str: str | None = payload.get("sub")
        if user_id_str is None:
            raise credentials_exception
        try:
            user_id = uuid.UUID(user_id_str)
        except ValueError:
            raise credentials_exception

        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if user is None or not user.is_active:
            raise credentials_exception
        return user

    # Not one of our own tokens — try Supabase.
    #
    # The whole UI authenticates against Supabase, which signs tokens with
    # HS256 and the project secret. decode_access_token above only verifies
    # this backend's RS256 tokens, so every signed-in user was rejected with
    # "Not authenticated" no matter how they logged in. (The Angular
    # interceptor's comment claiming Supabase uses RS256 is what hid this.)
    return await _user_from_supabase_token(raw_token, db, credentials_exception)


async def _user_from_supabase_token(
    token: str,
    db: AsyncSession,
    credentials_exception: HTTPException,
) -> User:
    """
    Resolve a Supabase-authenticated caller to a local User row.

    Supabase and this backend keep separate user tables with unrelated IDs, so
    the match is on email — the only field they share.

    A verified caller with no local row is provisioned one. They have already
    proven they hold a valid token for this project; refusing them would mean
    anyone who signed up through the UI could never use an API endpoint. The
    row carries no password, because authentication happens at Supabase.
    """
    from services.llm_tier import verify_caller

    caller = verify_caller(token)
    if caller is None or not caller.email:
        raise credentials_exception

    result = await db.execute(select(User).where(User.email == caller.email))
    user = result.scalar_one_or_none()

    if user is not None:
        if not user.is_active:
            raise credentials_exception
        return user

    # Role comes from server-side configuration, never from the token: a claim
    # inside a JWT is supplied by the client's identity provider and must not
    # be able to grant admin here.
    role = UserRole.admin if caller.email in settings.admin_email_set else UserRole.buyer
    user = User(
        id=uuid.uuid4(),
        email=caller.email,
        hashed_password=None,
        full_name=None,
        role=role,
        is_active=True,
        is_verified=True,  # Supabase verified the address
    )
    db.add(user)
    await db.flush()
    return user


async def get_admin_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    cookie_token: str | None = Cookie(default=None, alias=ACCESS_TOKEN_COOKIE),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Get admin user. In development, allows dev admin email without JWT.
    In production, requires valid authentication and admin role.
    """
    # Development mode: allow dev admin email without requiring JWT token
    if not settings.is_production and credentials is None and not cookie_token:
        # This is for testing only and should NEVER be used in production
        return User(
            id=uuid.uuid4(),
            email=settings.admin_emails.split(",")[0].strip() if settings.admin_emails else "admin@test",
            hashed_password=None,
            full_name="Dev Admin",
            role=UserRole.admin,
            is_active=True,
            is_verified=True,
        )

    # Production or when JWT is provided: validate using get_current_user
    user = await get_current_user(credentials, cookie_token, db)

    # Verify admin role
    if user.email and user.email.lower() in settings.admin_email_set:
        return user
    if user.role != UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user


async def get_seller_user(current_user: User = Depends(get_current_user)) -> User:
    """Require seller OR admin role — server-side guard (MOB-012)."""
    if current_user.role.value not in ("seller", "dealer", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Dealer/seller access required",
        )
    return current_user
