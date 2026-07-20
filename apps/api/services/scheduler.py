"""Nightly background job to rescore all leads."""
from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from db.session import AsyncSessionLocal as async_session_factory
from models.customer_intent import CustomerIntentScore
from services.sentiment import analyse_customer_intent

logger = logging.getLogger("gaadiiq.scheduler")

scheduler = AsyncIOScheduler()


async def rescore_all_leads() -> None:
    """Re-run intent analysis for every scored lead. Runs nightly at 02:00."""
    logger.info("Nightly rescore: starting")
    async with async_session_factory() as db:
        result = await db.execute(select(CustomerIntentScore))
        scores = result.scalars().all()
        updated = 0
        for score in scores:
            try:
                await analyse_customer_intent(db, score.user_id, score.dealer_id, customer_name="Customer")
                updated += 1
            except Exception as exc:
                logger.warning("Rescore failed for user %s: %s", score.user_id, exc)
    logger.info("Nightly rescore: completed %d leads", updated)


def start_scheduler() -> None:
    scheduler.add_job(rescore_all_leads, "cron", hour=2, minute=0, id="nightly_rescore", replace_existing=True)
    scheduler.start()
    logger.info("APScheduler started — nightly rescore at 02:00")


def stop_scheduler() -> None:
    scheduler.shutdown(wait=False)
