-- Make an enquiry something you can work, not just something you received.
--
-- THE GAP THIS CLOSES
--
-- Raised while thinking through go-live: the catalogue is loaded, the site is
-- live, and no dealers are onboarded yet. Buyers enquire. Where does it go?
--
-- The routing was already right — 024 sends an enquiry with no listing behind
-- it to admins, which is every enquiry in the table today. What was missing is
-- everything after that:
--
--   * nobody is told. The insert goes client -> Supabase directly, so the API
--     never sees it and nothing server-side can react. The row waits until
--     somebody happens to open the dashboard.
--   * there is nowhere to record that it has been dealt with. The table is
--     id, car_id, buyer_name, buyer_phone, buyer_email, notes, created_at.
--     At twenty enquiries you cannot tell which you have already called.
--
-- WHAT THIS ADDS
--
-- status       — the same five values car_leads already uses, so the two
--                inboxes read the same way and a dealer does not have to learn
--                two vocabularies. Defaults to 'new'.
-- notified_at  — when the alert for this row went out. Null means "not yet".
--
-- WHY notified_at IS A COLUMN AND NOT A LOG LINE
--
-- The notifier is a scheduled job (services/scheduler.py), not a webhook,
-- because the browser cannot be trusted to report its own successful insert —
-- a buyer who closes the tab is exactly the lead you most want to hear about.
-- A job that re-reads the table needs a durable mark saying which rows it has
-- already announced, or it emails the same enquiry every few minutes until
-- somebody mutes the alerts, and the next real one arrives into a muted inbox.
--
-- THE UPDATE POLICY IS THE MISSING HALF OF 024
--
-- 024 let the right people read an enquiry. A status nobody may write is
-- decoration, so the same rule is applied to UPDATE: a seller may move an
-- enquiry that names their own listing, an admin may move any. Taken verbatim
-- from 024's USING clause so the two cannot drift apart — if one is wrong,
-- both are wrong in the same way, which is far easier to spot than a read and
-- a write that quietly disagree.
--
-- Buyers cannot update. Someone who sent an enquiry does not get to mark it
-- handled, for the same reason they do not close their own support ticket.

BEGIN;

ALTER TABLE public.car_enquiries
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS notified_at timestamptz;

-- The same five car_leads uses. A CHECK rather than an enum: adding a value to
-- a Postgres enum inside a transaction is awkward, and this list will change.
ALTER TABLE public.car_enquiries
  DROP CONSTRAINT IF EXISTS car_enquiries_status_check;
ALTER TABLE public.car_enquiries
  ADD CONSTRAINT car_enquiries_status_check
  CHECK (status IN ('new', 'contacted', 'qualified', 'won', 'lost'));

DROP POLICY IF EXISTS "enquiries_seller_or_admin_update" ON public.car_enquiries;

CREATE POLICY "enquiries_seller_or_admin_update" ON public.car_enquiries
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE lower(p.email) = lower(auth.jwt() ->> 'email')
        AND p.role = 'admin'
    )
    OR EXISTS (
      SELECT 1
      FROM public.listings l
      JOIN public.users u ON u.id = l.seller_id
      WHERE l.id = car_enquiries.car_id
        AND lower(u.email) = lower(auth.jwt() ->> 'email')
    )
  );

-- The notifier's own query: "anything not yet announced", oldest first.
CREATE INDEX IF NOT EXISTS car_enquiries_unnotified_idx
  ON public.car_enquiries (created_at)
  WHERE notified_at IS NULL;

COMMIT;

-- Check it took:
--
--   SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'car_enquiries'
--     AND column_name IN ('status', 'notified_at');
--
--   SELECT policyname, cmd FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'car_enquiries'
--   ORDER BY policyname;
--
-- Expect status -> text default 'new', notified_at -> timestamptz, and three
-- policies: enquiries_insert (INSERT), enquiries_seller_or_admin_select
-- (SELECT), enquiries_seller_or_admin_update (UPDATE).
--
-- The enquiry already in the table will have notified_at NULL, so the first
-- run of the notifier will email it. That is intended: it has never been
-- announced to anyone.
