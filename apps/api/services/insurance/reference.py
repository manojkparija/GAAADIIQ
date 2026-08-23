"""
The GAADIIQ insurance attribution reference: GIQ-INS-YYYY-NNNNNNNN.

BRD §12 calls this critical to preventing revenue leakage, and that is exactly
what it is. It is the only token that survives the whole journey — it goes out
with the quote request, the partner echoes it back on their conversion webhook,
and reconciliation matches on it months later. Without it, a policy the partner
issued is a payment nobody can tie to the journey that earned it.

WHY A COUNTER AND NOT A UUID

A UUID needs no coordination and would be the obvious choice, but these are
read by people: off a reconciliation spreadsheet, over the phone to a support
agent, out of an email from the partner's finance team. A 36-character hex
string is transcribed wrongly often enough that the errors become the work.

The cost of that choice is coordination, handled below.

CONCURRENCY

The counter row is taken with SELECT ... FOR UPDATE, so two requests arriving
together block rather than reading the same value. Without the lock both would
compute last_value + 1 identically and the second insert would die on
`reference`'s unique constraint — after the partner call, which is the
expensive place to fail.

SQLite does not implement row locking and does not need to; the suite runs
serially. The dialect check below is not an optimisation, it is that SQLite
errors on the syntax.

THE SEQUENCE HAS GAPS, BY DESIGN

A transaction that takes a number and then rolls back leaves a hole. Closing
that would mean holding the lock across the partner's network call, turning
every slow upstream response into a queue on a single row. Gaps are cheaper:
reconciliation matches references, it does not count them.
"""
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.insurance import InsuranceReferenceCounter

PREFIX = "GIQ-INS"


async def next_reference(db: AsyncSession, *, year: int | None = None) -> str:
    """Mint the next reference for `year` (default: the current UTC year).

    Call inside the transaction that writes the quote, so a rolled-back journey
    does not leave the counter advanced any further than it has to.
    """
    year = year or datetime.now(timezone.utc).year

    stmt = select(InsuranceReferenceCounter).where(InsuranceReferenceCounter.year == year)
    if db.bind is not None and db.bind.dialect.name != "sqlite":
        stmt = stmt.with_for_update()

    counter = (await db.execute(stmt)).scalar_one_or_none()

    if counter is None:
        counter = InsuranceReferenceCounter(year=year, last_value=0)
        db.add(counter)
        # Materialise the row before incrementing it, so a concurrent caller
        # meets a row to lock rather than inserting a second one and failing on
        # the primary key.
        await db.flush()

    counter.last_value += 1
    await db.flush()

    # Eight digits: a hundred million policies in a year is far beyond any
    # plausible volume, and a fixed width keeps the references sortable as
    # text, which is how they will be sorted in a spreadsheet.
    return f"{PREFIX}-{year}-{counter.last_value:08d}"
