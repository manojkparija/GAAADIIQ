"""Nightly background job to rescore all leads."""
from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from db.session import AsyncSessionLocal as async_session_factory
from models.customer_intent import CustomerIntentScore
from services.llm_tier import JWKS_REFRESH_SECONDS, warm_jwks_cache
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
    # Keep the Supabase key set fresh from here rather than from whichever
    # request happens to arrive after it goes stale. The fetch is synchronous
    # and the service runs one worker, so on the request path it stopped the
    # event loop for every request in flight; warm_jwks_cache runs it in a
    # thread, and a failed refresh leaves the previous keys in place.
    scheduler.add_job(
        warm_jwks_cache,
        "interval",
        seconds=JWKS_REFRESH_SECONDS,
        id="jwks_refresh",
        replace_existing=True,
    )
    scheduler.start()
    logger.info(
        "APScheduler started — nightly rescore at 02:00, JWKS refresh every %ds",
        JWKS_REFRESH_SECONDS,
    )


def stop_scheduler() -> None:
    scheduler.shutdown(wait=False)
