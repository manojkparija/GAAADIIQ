"""
Somebody is told when a buyer sends an enquiry.

THE GAP THIS CLOSES

Raised while thinking through go-live: catalogue loaded, site live, no dealers
onboarded yet. A buyer enquires — where does it go?

The routing was already right: an enquiry with no listing behind it belongs to
admins, and that is every enquiry recorded so far. What was missing is that
nothing announced it. The insert goes from the browser straight to Supabase, so
the API never sees the request and nothing server-side can react. The row
waited until somebody happened to open the dashboard — while the modal told the
buyer "our team will connect you with the seller within 2 hours".

WHAT THESE HOLD

The three properties that make the alert trustworthy rather than merely
present: it goes to the right people, it does not repeat itself, and a burst
cannot turn one tick into hundreds of emails. Each has a failure mode that is
invisible until it is expensive — an alert nobody receives, an inbox so noisy
it gets muted, or a spam run that empties the SMTP quota.
"""

from unittest.mock import AsyncMock, patch

import pytest

from services import enquiry_alerts


class _Row:
    """One row of the notifier's query."""

    def __init__(self, **kw):
        self.id = kw.get("id", "e-1")
        self.buyer_name = kw.get("buyer_name", "Asha")
        self.buyer_phone = kw.get("buyer_phone", "+919000000000")
        self.buyer_email = kw.get("buyer_email")
        self.notes = kw.get("notes")
        self.make = kw.get("make")
        self.model = kw.get("model")
        self.year = kw.get("year")


def test_the_email_carries_the_number_somebody_has_to_ring():
    """An alert that forces a trip to the dashboard is one people stop opening."""
    html, plain = enquiry_alerts._body(
        _Row(buyer_name="Asha", buyer_phone="+919000000000", make="Maruti Suzuki", model="Swift", year=2026)
    )

    assert "+919000000000" in html
    assert "+919000000000" in plain
    assert "Asha" in html
    assert "Maruti Suzuki Swift" in html


def test_a_car_it_cannot_name_does_not_become_the_word_none():
    """car_id may point at a listing or at a catalogue car, and the join can
    miss. "asked about a car" is honest; "asked about None None" is a bug
    report sent to a customer-facing inbox."""
    html, plain = enquiry_alerts._body(_Row(make=None, model=None, year=None))

    assert "None" not in html
    assert "None" not in plain
    assert "a car" in plain


def test_notes_are_included_only_when_the_buyer_wrote_some():
    with_notes = enquiry_alerts._body(_Row(notes="Is it still available?"))[1]
    without = enquiry_alerts._body(_Row(notes=None))[1]
    blank = enquiry_alerts._body(_Row(notes="   "))[1]

    assert "Is it still available?" in with_notes
    assert "They said" not in without
    assert "They said" not in blank, "whitespace is not a message"


def test_the_batch_is_bounded():
    """The insert policy is WITH CHECK (true) — anonymous and unlimited. A
    burst of spam must not become a burst of email; the overflow waits for the
    next run rather than arriving all at once."""
    assert 0 < enquiry_alerts.ALERT_BATCH <= 100


def test_the_poll_is_not_so_frequent_that_it_becomes_a_query_storm():
    """Minutes, not seconds. A buyer expects a call back, not an instant reply,
    and this runs against the same single-worker service the catalogue does."""
    assert 60 <= enquiry_alerts.ALERT_POLL_SECONDS <= 3600


@pytest.mark.asyncio
async def test_nothing_is_announced_when_there_is_no_admin_to_announce_it_to(caplog):
    """The failure 010 warns about, in its own comments: without an admin row
    the alert goes nowhere. Silently returning zero would make an empty inbox
    look like a quiet day, so it says so in the log."""
    session = AsyncMock()
    session.__aenter__.return_value = session
    session.__aexit__.return_value = False

    with patch.object(enquiry_alerts, "AsyncSessionLocal", return_value=session), \
         patch.object(enquiry_alerts, "_admin_recipients", AsyncMock(return_value=[])), \
         patch.object(enquiry_alerts, "send_email", AsyncMock()) as mail:
        sent = await enquiry_alerts.announce_new_enquiries()

    assert sent == 0
    mail.assert_not_awaited()
    assert "will not be announced" in caplog.text
