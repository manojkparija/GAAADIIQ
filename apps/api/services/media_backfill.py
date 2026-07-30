"""
Bring images stored before the enrichment pipeline up to its standard.

Rows ingested by the earlier code have a storage key and little else: no
thumbnail, no perceptual hash, and tags only where the brochure happened to
describe exactly one vehicle. Every catalogue surface filters on those tags, so
without this the pipeline looks broken on existing data while working correctly
on everything uploaded after it.

Three properties matter more than speed here:

  idempotent  Only missing fields are filled, so a second run is a no-op and a
              run interrupted halfway can simply be started again.
  resumable   Work is done in batches with a commit per batch, so a timeout or
              a restart loses one batch rather than the whole job.
  survivable  One unreadable image must not stop the run. A brochure from two
              years ago can contain a file the current decoder rejects, and
              that is not a reason to leave the other nine hundred untouched.

Deliberately not run at startup: it reads and rewrites every image in storage,
which is the wrong thing to do automatically while the API is trying to serve
traffic. It is triggered by an admin endpoint instead.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.vehicle_media import ExtractedVehicle, VehicleMedia
from services import pdf_ingest
from services.media_index import media_index
from services.media_storage import StorageError, get_storage

logger = logging.getLogger("gaadiiq.media_backfill")

BATCH_SIZE = 50


@dataclass
class BackfillReport:
    scanned: int = 0
    tagged: int = 0
    thumbnailed: int = 0
    hashed: int = 0
    indexed: int = 0
    unreadable: int = 0
    errors: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "scanned": self.scanned,
            "tagged": self.tagged,
            "thumbnailed": self.thumbnailed,
            "hashed": self.hashed,
            "indexed": self.indexed,
            "unreadable": self.unreadable,
            # Bounded: a run over a broken bucket would otherwise return one
            # error per image and a response nobody can read.
            "errors": self.errors[:20],
        }


def _needs_work(m: VehicleMedia) -> bool:
    """
    Whether a row has been through enrichment at all.

    Deliberately not "is any enriched field null". Several of them are
    legitimately null forever — a flat colour swatch has no perceptual
    signature to compute, and an image uploaded against a listing has no
    brochure to take a make from — so selecting on those nulls made every run
    pick the same rows up again and re-read every file from storage.
    """
    return m.enriched_at is None


async def _tags_for_job(db: AsyncSession, job_id) -> dict:
    """
    Consensus tags for a job's images, from the vehicles it produced.

    Same rule as ingestion: each field independently, and only where the
    brochure agrees. A multi-variant brochure therefore yields make, model,
    year and category but no variant.
    """
    if job_id is None:
        return {}

    vehicles = (await db.execute(
        select(ExtractedVehicle).where(ExtractedVehicle.job_id == job_id)
    )).scalars().all()
    if not vehicles:
        return {}

    def consensus(values):
        distinct = {v for v in values if v}
        return distinct.pop() if len(distinct) == 1 else None

    return {
        "make": consensus([v.make for v in vehicles]),
        "model": consensus([v.model for v in vehicles]),
        "variant": consensus([v.variant for v in vehicles]),
        "model_year": consensus([v.model_year for v in vehicles]),
        "category": consensus([v.body_type for v in vehicles]),
        "only_vehicle_id": vehicles[0].id if len(vehicles) == 1 else None,
    }


async def backfill_media(
    db: AsyncSession,
    *,
    limit: int | None = None,
    reindex_all: bool = False,
) -> BackfillReport:
    """
    Fill in what older rows are missing. Returns a report of what changed.

    `limit` caps the number of rows touched, so a first run can be tried small
    before committing to the whole table. `reindex_all` also pushes rows that
    need no other work into the search index, for the case where the index was
    provisioned after the images were.
    """
    report = BackfillReport()
    storage = get_storage()

    stmt = select(VehicleMedia).order_by(VehicleMedia.created_at)
    if not reindex_all:
        stmt = stmt.where(VehicleMedia.enriched_at.is_(None))
    if limit:
        stmt = stmt.limit(limit)

    rows = (await db.execute(stmt)).scalars().all()
    # Cached per job: a brochure's images share one set of tags, and re-deriving
    # them per image would run the same query hundreds of times.
    tag_cache: dict = {}
    pending: list[VehicleMedia] = []

    for m in rows:
        report.scanned += 1

        if m.job_id not in tag_cache:
            tag_cache[m.job_id] = await _tags_for_job(db, m.job_id)
        tags = tag_cache[m.job_id]

        if tags:
            before = (m.make, m.model, m.variant, m.model_year, m.category)
            m.make = m.make or tags.get("make")
            m.model = m.model or tags.get("model")
            m.variant = m.variant or tags.get("variant")
            m.model_year = m.model_year or tags.get("model_year")
            m.category = m.category or tags.get("category")
            if tags.get("only_vehicle_id") and m.extracted_vehicle_id is None:
                m.extracted_vehicle_id = tags["only_vehicle_id"]
            if (m.make, m.model, m.variant, m.model_year, m.category) != before:
                report.tagged += 1

        # Only read the file when something actually needs the bytes — most of
        # the cost of this job is storage reads, not database writes.
        if m.thumbnail_key is None or m.phash is None or m.content_hash is None:
            try:
                data = await storage.load(m.storage_key)
            except StorageError as exc:
                # A row whose file is gone is a broken row, not a broken run.
                # Still marked: retrying a vanished file on every future run
                # would re-read storage forever for a row that cannot improve.
                report.unreadable += 1
                report.errors.append(f"{m.storage_key}: {exc}")
                m.enriched_at = datetime.now(timezone.utc)
                pending.append(m)
                continue

            if m.content_hash is None:
                import hashlib
                m.content_hash = hashlib.sha256(data).hexdigest()
                report.hashed += 1

            if m.phash is None:
                computed = pdf_ingest.perceptual_hash(data)
                if computed:
                    m.phash = computed

            if m.thumbnail_key is None:
                thumb = pdf_ingest.make_thumbnail(data)
                if thumb:
                    thumb_bytes, thumb_type = thumb
                    candidate = pdf_ingest.thumbnail_key(m.storage_key)
                    try:
                        m.thumbnail_key = (
                            await storage.save(candidate, thumb_bytes, thumb_type)
                        ).key
                        report.thumbnailed += 1
                    except StorageError as exc:
                        report.errors.append(f"thumbnail {candidate}: {exc}")
                else:
                    # Undecodable by the current Pillow — counted, not retried
                    # on every future run, because the row is left as it is and
                    # will simply be picked up again if the decoder improves.
                    report.unreadable += 1

        # Marked whatever the outcome, including for a row whose file has
        # vanished: retrying an unreadable file on every future run would
        # re-read storage forever for a row that cannot improve. Null the
        # column to force one back through.
        m.enriched_at = datetime.now(timezone.utc)
        pending.append(m)

        # Committed per batch so an interrupted run keeps the work it has done.
        if len(pending) >= BATCH_SIZE:
            await db.commit()
            await media_index.index_many(pending)
            report.indexed += len(pending)
            pending = []

    if pending:
        await db.commit()
        await media_index.index_many(pending)
        report.indexed += len(pending)

    logger.info("Media backfill finished: %s", report.as_dict())
    return report
