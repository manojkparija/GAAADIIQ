"""Audit logging for media operations."""
from typing import Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from models.media_audit import AuditAction, VehicleMediaAudit


async def log_audit(
    db: AsyncSession,
    media_id: UUID,
    action: AuditAction,
    actor_id: Optional[UUID] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> VehicleMediaAudit:
    """Log an audit event for a media operation."""
    audit = VehicleMediaAudit(
        media_id=media_id,
        action=action,
        actor_id=actor_id,
        ip_address=ip_address,
        user_agent=user_agent,
        metadata=metadata,
    )
    db.add(audit)
    await db.flush()
    return audit


async def get_audit_log(
    db: AsyncSession,
    media_id: UUID,
    limit: int = 100,
) -> list[VehicleMediaAudit]:
    """Get audit log for a media item."""
    from sqlalchemy import select

    stmt = (
        select(VehicleMediaAudit)
        .where(VehicleMediaAudit.media_id == media_id)
        .order_by(VehicleMediaAudit.created_at.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    return result.scalars().all()


async def get_actor_audit_log(
    db: AsyncSession,
    actor_id: UUID,
    limit: int = 100,
) -> list[VehicleMediaAudit]:
    """Get audit log for actions by a specific actor."""
    from sqlalchemy import select

    stmt = (
        select(VehicleMediaAudit)
        .where(VehicleMediaAudit.actor_id == actor_id)
        .order_by(VehicleMediaAudit.created_at.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    return result.scalars().all()
