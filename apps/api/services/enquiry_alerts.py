"""
Tell somebody when a buyer sends an enquiry.

THE GAP THIS CLOSES

Raised while thinking through go-live: the catalogue is loaded, the site is
live, no dealers are onboarded. A buyer sends an enquiry. Where does it go?

The routing was already right — an enquiry with no listing behind it belongs to
admins, and that is every enquiry recorded so far. What was missing is that
nothing announced it. The insert goes from the browser straight to Supabase,
so the API never sees it: no request to hook, nothing server-side to react.
The row simply waited until somebody happened to open the dashboard.

Meanwhile the modal told the buyer "our team will connect you with the seller
within 2 hours" — a promise nothing in the system was even trying to keep.

WHY A SCHEDULED JOB AND NOT A CALL FROM THE BROWSER

The obvious fix is to have the page call the API after a successful insert.
That fails in exactly the case that matters most: a buyer who submits and
closes the tab is a lead you want to hear about, and their browser is gone. It
would also mean a public endpoint whose whole job is to send mail, which is a
thing that attracts attention.

This reads the table instead. It cannot be skipped, it needs no new endpoint,
and it works no matter how the row got there — including a row inserted by
hand in the SQL editor.

The cost is latency: an enquiry is announced within one poll interval rather
than instantly. For "we will call you back" that is the right trade.

WHY IT WRITES notified_at BEFORE IT IS SURE THE MAIL LANDED

send_email swallows its own failures by design — it no-ops when SMTP is not
configured, which is how dev and the test suite stay quiet. So there is no
reliable "it was delivered" signal to wait for. Marking the row first means a
mail that fails is lost; not marking it means every failure re-sends every few
minutes until somebody mutes the alerts, and then the next real enquiry
arrives into a muted inbox. Silence on one enquiry is recoverable — the row is
still there, still visible in the dashboard, still marked 'new'. A muted inbox
is not.
"""
import logging

from sqlalchemy import text

from db.session import AsyncSessionLocal
from services.email import send_email

logger = logging.getLogger("gaadiiq.enquiry_alerts")

#: How often the scheduler runs this. A buyer expects a call back, not an
#: instant reply, so minutes are fine and a tighter loop only costs queries.
ALERT_POLL_SECONDS = 300

#: Announced per run. A bounded batch, so a backlog — or a burst of spam, the
#: insert policy being open to anyone — cannot turn one tick into hundreds of
#: emails. Anything left over goes out on the next run.
ALERT_BATCH = 20


async def _admin_recipients(db) -> list[str]:
    """Who gets told.

    user_profiles is the same source of truth 010 and 024 use for "who is an
    admin". Deliberately not environment.prod.ts's adminEmails: that list lives
    in the browser bundle and the server cannot read it, which is the whole
    reason the database has its own copy.
    """
    rows = await db.execute(
        text("SELECT email FROM public.user_profiles WHERE role = 'admin' AND email IS NOT NULL")
    )
    return [r[0] for r in rows.fetchall() if r[0]]


def _body(row) -> tuple[str, str]:
    """The email, as (html, text).

    Carries the buyer's number because the entire point is that somebody rings
    it, and an alert that forces a trip to the dashboard to find the number is
    an alert people stop opening. It goes only to admins, who can already read
    every enquiry through the dashboard, so this discloses nothing new.
    """
    car = f"{row.make} {row.model}".strip() if row.make else "a car"
    year = f" {row.year}" if row.year else ""
    notes = (row.notes or "").strip()

    html = (
        f"<p><strong>{row.buyer_name}</strong> asked about <strong>{car}{year}</strong>.</p>"
        f"<p>Phone: <a href=\"tel:{row.buyer_phone}\">{row.buyer_phone}</a><br>"
        f"Email: {row.buyer_email or '—'}</p>"
        + (f"<p>They said: {notes}</p>" if notes else "")
        + "<p>It is in the Enquiries tab of the dealer dashboard.</p>"
    )
    plain = (
        f"{row.buyer_name} asked about {car}{year}.\n"
        f"Phone: {row.buyer_phone}\n"
        f"Email: {row.buyer_email or '-'}\n"
        + (f"They said: {notes}\n" if notes else "")
        + "It is in the Enquiries tab of the dealer dashboard.\n"
    )
    return html, plain


async def announce_new_enquiries() -> int:
    """Email admins about enquiries nobody has been told about. Returns the count.

    The car is joined in from both sides on purpose. car_enquiries.car_id holds
    either a listings.id or a cars.id depending on which page the buyer came
    from — cars-data.service.ts has two mappers and they differ — so a join
    against one table alone names half the cars and leaves the rest as "a car".
    """
    sent = 0
    async with AsyncSessionLocal() as db:
        recipients = await _admin_recipients(db)
        if not recipients:
            # Not an error worth raising every five minutes, but worth saying:
            # with no admin row, an enquiry is announced to nobody. 010's own
            # comments warn about the same missing row emptying a dashboard.
            logger.warning(
                "No admin in user_profiles — new enquiries will not be announced to anyone"
            )
            return 0

        rows = (
            await db.execute(
                text(
                    """
                    SELECT e.id, e.buyer_name, e.buyer_phone, e.buyer_email, e.notes,
                           COALESCE(cl.make, cc.make) AS make,
                           COALESCE(cl.model, cc.model) AS model,
                           COALESCE(cl.year, cc.year) AS year
                    FROM public.car_enquiries e
                    LEFT JOIN public.listings l ON l.id = e.car_id
                    LEFT JOIN public.cars cl     ON cl.id = l.car_id
                    LEFT JOIN public.cars cc     ON cc.id = e.car_id
                    WHERE e.notified_at IS NULL
                    ORDER BY e.created_at
                    LIMIT :limit
                    """
                ),
                {"limit": ALERT_BATCH},
            )
        ).fetchall()

        for row in rows:
            html, plain = _body(row)
            subject = f"New enquiry from {row.buyer_name}"
            for to in recipients:
                await send_email(to, subject, html, plain)

            # Marked whatever send_email did with it: see the module docstring.
            await db.execute(
                text("UPDATE public.car_enquiries SET notified_at = now() WHERE id = :id"),
                {"id": row.id},
            )
            sent += 1

        await db.commit()

    if sent:
        logger.info("Announced %d new enquir%s", sent, "y" if sent == 1 else "ies")
    return sent
