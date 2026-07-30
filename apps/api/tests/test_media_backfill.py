"""
Backfilling images stored before the enrichment pipeline.

Rows ingested by the earlier code have a storage key and little else. Every
catalogue surface filters on tags, so until they are filled the pipeline looks
broken on existing data while working correctly on new uploads.
"""
import io
import uuid

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from models.vehicle_media import ExtractedVehicle, PdfIngestionJob, VehicleMedia
from services import media_backfill
from services.media_storage import get_storage


def _png(colour=(200, 30, 30), size=(600, 400)) -> bytes:
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", size, colour).save(buf, "PNG")
    return buf.getvalue()


@pytest_asyncio.fixture
async def session(db_engine):
    factory = async_sessionmaker(db_engine, expire_on_commit=False, class_=AsyncSession)
    async with factory() as s:
        yield s


async def _legacy_row(session, storage, *, job_id=None, key=None) -> VehicleMedia:
    """A row as the pre-enrichment code would have written it."""
    key = key or f"brochures/legacy/{uuid.uuid4().hex[:8]}.png"
    await storage.save(key, _png(), "image/png")
    row = VehicleMedia(
        storage_key=key,
        content_type="image/png",
        size_bytes=100,
        source_pdf_name="DZIRE.pdf",
        job_id=job_id,
        # Everything the enrichment pipeline adds is absent.
        thumbnail_key=None, phash=None, content_hash=None,
        make=None, model=None, model_year=None, category=None,
    )
    session.add(row)
    await session.commit()
    return row


async def _job_with_vehicles(session, variants) -> PdfIngestionJob:
    job = PdfIngestionJob(source_pdf_name="DZIRE.pdf")
    session.add(job)
    await session.flush()
    for v in variants:
        session.add(ExtractedVehicle(
            job_id=job.id, make="Maruti Suzuki", model="Dzire",
            variant=v, model_year=2025, body_type="Sedan",
        ))
    await session.commit()
    return job


@pytest.mark.asyncio
async def test_legacy_rows_gain_tags_thumbnail_and_hashes(session):
    storage = get_storage()
    job = await _job_with_vehicles(session, ["ZXi+"])
    row = await _legacy_row(session, storage, job_id=job.id)

    report = await media_backfill.backfill_media(session)

    await session.refresh(row)
    assert row.make == "Maruti Suzuki"
    assert row.model == "Dzire"
    assert row.model_year == 2025
    assert row.category == "Sedan"
    assert row.thumbnail_key is not None
    assert row.phash is not None
    assert row.content_hash is not None
    # A single-vehicle brochure can attribute the image to that vehicle.
    assert row.extracted_vehicle_id is not None
    assert report.tagged >= 1 and report.thumbnailed >= 1


@pytest.mark.asyncio
async def test_running_twice_changes_nothing(session):
    """
    Idempotence is what makes an interrupted run safe to restart, so a second
    pass must not re-thumbnail or re-tag anything.
    """
    storage = get_storage()
    job = await _job_with_vehicles(session, ["ZXi+"])
    await _legacy_row(session, storage, job_id=job.id)

    first = await media_backfill.backfill_media(session)
    second = await media_backfill.backfill_media(session)

    assert first.thumbnailed == 1
    assert second.scanned == 0, "a completed row must not be selected again"
    assert second.thumbnailed == 0 and second.tagged == 0


@pytest.mark.asyncio
async def test_a_multi_variant_brochure_tags_everything_except_variant(session):
    """The case the old ingest code skipped entirely."""
    storage = get_storage()
    job = await _job_with_vehicles(session, ["VXi", "ZXi", "ZXi+"])
    row = await _legacy_row(session, storage, job_id=job.id)

    await media_backfill.backfill_media(session)

    await session.refresh(row)
    assert row.make == "Maruti Suzuki" and row.model == "Dzire"
    assert row.model_year == 2025 and row.category == "Sedan"
    assert row.variant is None, "the brochure disagrees on variant; leave it for an admin"
    assert row.extracted_vehicle_id is None, "cannot attribute to one of three"


@pytest.mark.asyncio
async def test_a_missing_file_does_not_stop_the_run(session):
    """
    A brochure from two years ago can reference a file that is gone. That is a
    broken row, not a reason to leave the rest of the table untouched.
    """
    storage = get_storage()
    job = await _job_with_vehicles(session, ["ZXi+"])

    broken = VehicleMedia(
        storage_key="brochures/legacy/vanished.png",
        content_type="image/png", size_bytes=1,
        source_pdf_name="OLD.pdf", job_id=job.id,
    )
    session.add(broken)
    await session.commit()
    good = await _legacy_row(session, storage, job_id=job.id)

    report = await media_backfill.backfill_media(session)

    await session.refresh(good)
    assert good.thumbnail_key is not None, "the healthy row must still be processed"
    assert report.unreadable >= 1
    assert report.errors, "the broken row is reported, not swallowed"


@pytest.mark.asyncio
async def test_existing_values_are_never_overwritten(session):
    """An admin edit or a classification pass is better evidence than consensus."""
    storage = get_storage()
    job = await _job_with_vehicles(session, ["ZXi+"])
    row = await _legacy_row(session, storage, job_id=job.id)
    row.make = "Hand Corrected"
    row.variant = "Curated"
    await session.commit()

    await media_backfill.backfill_media(session)

    await session.refresh(row)
    assert row.make == "Hand Corrected"
    assert row.variant == "Curated"
    # Untouched fields are still filled in.
    assert row.model == "Dzire"


@pytest.mark.asyncio
async def test_limit_caps_the_work(session):
    storage = get_storage()
    job = await _job_with_vehicles(session, ["ZXi+"])
    for _ in range(3):
        await _legacy_row(session, storage, job_id=job.id)

    report = await media_backfill.backfill_media(session, limit=2)

    assert report.scanned == 2


@pytest.mark.asyncio
async def test_a_row_with_no_job_is_still_hashed_and_thumbnailed(session):
    """A listing upload has no brochure to take tags from, but still needs both."""
    storage = get_storage()
    row = await _legacy_row(session, storage, job_id=None)

    await media_backfill.backfill_media(session)

    await session.refresh(row)
    assert row.thumbnail_key is not None
    assert row.phash is not None
    assert row.make is None, "nothing to infer tags from, and none invented"
