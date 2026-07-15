import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, field_validator

from models.user import UserRole


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str | None = None
    phone: str | None = None

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserPublicOut(BaseModel):
    """Safe public representation — no PII (email/phone).
    Used in ListingOut and other publicly accessible responses.
    """
    id: uuid.UUID
    full_name: str | None
    role: UserRole
    created_at: datetime

    model_config = {"from_attributes": True}


class UserOut(BaseModel):
    """Full representation returned only to the authenticated user themselves."""
    id: uuid.UUID
    email: str
    full_name: str | None
    phone: str | None
    role: UserRole
    is_verified: bool
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class TokenData(BaseModel):
    user_id: uuid.UUID | None = None
    email: str | None = None
