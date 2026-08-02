"""Version history tracking for media."""
import json
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.media_version import MediaEventType, VehicleMediaVersion
from models.vehicle_media import VehicleMedia


async def record_version(
    db: AsyncSession,
    media_id: UUID,
    event_type: MediaEventType,
    actor_id: Optional[UUID] = None,
    old_value: Optional[dict] = None,
    new_value: Optional[dict] = None,
) -> VehicleMediaVersion:
    """Record a version change event."""
    version = VehicleMediaVersion(
        media_id=media_id,
        event_type=event_type,
        actor_id=actor_id,
        old_value=old_value,
        new_value=new_value,
    )
    db.add(version)
    await db.flush()
    return version


async def get_version_history(
    db: AsyncSession,
    media_id: UUID,
    limit: int = 50,
) -> list[VehicleMediaVersion]:
    """Get version history for a media item."""
    stmt = (
        select(VehicleMediaVersion)
        .where(VehicleMediaVersion.media_id == media_id)
        .order_by(VehicleMediaVersion.created_at.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    return result.scalars().all()


async def rollback_to_version(
    db: AsyncSession,
    media_id: UUID,
    version_id: int,
    actor_id: Optional[UUID] = None,
) -> Optional[VehicleMediaVersion]:
    """Rollback media to a previous version."""
    # Get the target version
    stmt = select(VehicleMediaVersion).where(VehicleMediaVersion.id == version_id)
    result = await db.execute(stmt)
    target_version = result.scalar_one_or_none()

    if not target_version or target_version.media_id != media_id:
        return None

    # Get current media state
    media_stmt = select(VehicleMedia).where(VehicleMedia.id == media_id)
    media_result = await db.execute(media_stmt)
    media = media_result.scalar_one_or_none()

    if not media:
        return None

    # Capture current state before rollback
    old_value = {
        "make": media.make,
        "model": media.model,
        "variant": media.variant,
        "model_year": media.model_year,
        "category": media.category,
        "image_category": media.image_category.value if media.image_category else None,
        "colour": media.colour,
        "fuel_type": media.fuel_type,
        "transmission": media.transmission,
        "source": media.source,
        "copyright": media.copyright,
        "license": media.license,
    }

    # Apply rollback
    if target_version.new_value:
        new_state = target_version.new_value
        media.make = new_state.get("make")
        media.model = new_state.get("model")
        media.variant = new_state.get("variant")
        media.model_year = new_state.get("model_year")
        media.category = new_state.get("category")
        media.colour = new_state.get("colour")
        media.fuel_type = new_state.get("fuel_type")
        media.transmission = new_state.get("transmission")
        media.source = new_state.get("source")
        media.copyright = new_state.get("copyright")
        media.license = new_state.get("license")

    # Record the rollback as a new version
    rollback_version = await record_version(
        db,
        media_id=media_id,
        event_type=MediaEventType.METADATA_UPDATED,
        actor_id=actor_id,
        old_value=old_value,
        new_value=target_version.new_value,
    )

    return rollback_version


def extract_metadata_diff(old: dict, new: dict) -> tuple[dict, dict]:
    """Extract changed fields from before/after metadata."""
    changed = {}
    for key in set(list(old.keys()) + list(new.keys())):
        old_val = old.get(key)
        new_val = new.get(key)
        if old_val != new_val:
            changed[key] = {"from": old_val, "to": new_val}

    return changed, {k: v for k, v in new.items() if k in changed}
