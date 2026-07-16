import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.dependencies import get_current_user
from core.limiter import limiter
from core.security import (
    REFRESH_TOKEN_COOKIE,
    clear_auth_cookies,
    create_access_token,
    create_refresh_token,
    hash_password,
    set_auth_cookies,
    verify_password,
)
from db.session import get_db
from models.refresh_token import RefreshToken
from models.user import User
from schemas.user import ForgotPasswordRequest, ResetPasswordRequest, Token, UserCreate, UserLogin, UserOut
from services.email import send_email

router = APIRouter(prefix="/auth", tags=["auth"])


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def _create_session(user: User, db: AsyncSession, response: Response) -> Token:
    access_token = create_access_token(user.id, user.email)
    raw_refresh = create_refresh_token()

    rt = RefreshToken(
        user_id=user.id,
        token_hash=_hash_token(raw_refresh),
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days),
    )
    db.add(rt)
    await db.commit()

    set_auth_cookies(response, access_token, raw_refresh)
    return Token(access_token=access_token, user=UserOut.model_validate(user))


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def register(
    request: Request,
    response: Response,
    payload: UserCreate,
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        )

    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        phone=payload.phone,
    )
    db.add(user)
    await db.flush()
    return await _create_session(user, db, response)


@router.post("/login", response_model=Token)
@limiter.limit("5/minute")
async def login(
    request: Request,
    response: Response,
    payload: UserLogin,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()

    if not user or not user.hashed_password or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled",
        )

    return await _create_session(user, db, response)


@router.post("/refresh", response_model=Token)
async def refresh(
    response: Response,
    refresh_token: str | None = Cookie(default=None, alias=REFRESH_TOKEN_COOKIE),
    db: AsyncSession = Depends(get_db),
):
    """Exchange a valid refresh token for a new access token + refresh token pair."""
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No refresh token")

    token_hash = _hash_token(refresh_token)
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked.is_(False),
            RefreshToken.expires_at > datetime.now(timezone.utc),
        )
    )
    rt = result.scalar_one_or_none()
    if not rt:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")

    # Rotate: revoke old, issue new
    rt.revoked = True
    await db.flush()

    result2 = await db.execute(select(User).where(User.id == rt.user_id))
    user = result2.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    return await _create_session(user, db, response)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    refresh_token: str | None = Cookie(default=None, alias=REFRESH_TOKEN_COOKIE),
    db: AsyncSession = Depends(get_db),
):
    """Revoke refresh token and clear auth cookies."""
    if refresh_token:
        token_hash = _hash_token(refresh_token)
        result = await db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        rt = result.scalar_one_or_none()
        if rt:
            rt.revoked = True
            await db.commit()
    clear_auth_cookies(response)


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)):
    return UserOut.model_validate(current_user)


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
@limiter.limit("3/minute")
async def forgot_password(
    request: Request,
    payload: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Send a password-reset link to the given email.
    Always returns 202 to avoid user enumeration.
    """
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()

    if user and user.is_active:
        raw_token = secrets.token_urlsafe(32)
        user.password_reset_token = hashlib.sha256(raw_token.encode()).hexdigest()
        user.password_reset_expires = datetime.now(timezone.utc) + timedelta(hours=1)
        await db.commit()

        reset_url = f"{settings.frontend_url}/reset-password?token={raw_token}"
        await send_email(
            to=user.email,
            subject="Reset your GAADIIQ password",
            html=f"""
<p>Hi {user.full_name or "there"},</p>
<p>We received a request to reset the password for your GAADIIQ account.</p>
<p><a href="{reset_url}"
   style="background:#C9A227;color:#fff;padding:10px 20px;border-radius:6px;
          text-decoration:none;font-weight:600;">Reset Password</a></p>
<p>This link expires in <strong>1 hour</strong>. If you didn't request this, you can safely ignore this email.</p>
<p>— The GAADIIQ Team</p>
""",
            text=f"Reset your GAADIIQ password: {reset_url}\n\nThis link expires in 1 hour.",
        )

    return {"detail": "If an account with that email exists, a reset link has been sent."}


@router.post("/reset-password", status_code=status.HTTP_200_OK)
@limiter.limit("5/minute")
async def reset_password(
    request: Request,
    payload: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    """Exchange a valid reset token for a new password."""
    token_hash = hashlib.sha256(payload.token.encode()).hexdigest()
    result = await db.execute(
        select(User).where(User.password_reset_token == token_hash)
    )
    user = result.scalar_one_or_none()

    if (
        not user
        or not user.password_reset_expires
        or user.password_reset_expires.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc)
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token.",
        )

    user.hashed_password = hash_password(payload.new_password)
    user.password_reset_token = None
    user.password_reset_expires = None
    await db.commit()

    return {"detail": "Password updated successfully. You can now sign in."}
