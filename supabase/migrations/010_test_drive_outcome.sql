-- Closing the loop on a test drive.
--
-- Until now a request could be created and read, and nothing else. There was
-- no UPDATE policy on the table at all, so the status column shipped with a
-- comment listing four values it could never move between: every row sat on
-- 'Pending' forever, including ones from over a month ago.
--
-- Two separate questions are recorded, because they have different answers:
--
--   status   did the appointment happen?   Pending / Confirmed / Completed
--                                          / Cancelled / No-show
--   outcome  did it turn into a sale?      Won / Lost / Deciding
--
-- Collapsing these into one list would make a no-show indistinguishable from
-- a lost deal, and would leave nowhere to record a car that sold without a
-- test drive. Kept apart, the pair gives a conversion rate that means
-- something: outcome='Won' over status='Completed'.

ALTER TABLE public.test_drive_requests
  ADD COLUMN IF NOT EXISTS outcome       text,
  ADD COLUMN IF NOT EXISTS outcome_notes text,
  ADD COLUMN IF NOT EXISTS completed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at    timestamptz DEFAULT now();

-- Constraints as NOT VALID, then validated separately: existing rows carry
-- free text in `status` written before there was any check, and a plain ADD
-- CONSTRAINT would fail the migration outright on the first bad row rather
-- than telling anyone which row it was.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'test_drive_status_known'
  ) THEN
    ALTER TABLE public.test_drive_requests
      ADD CONSTRAINT test_drive_status_known
      CHECK (status IN ('Pending', 'Confirmed', 'Completed', 'Cancelled', 'No-show'))
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'test_drive_outcome_known'
  ) THEN
    ALTER TABLE public.test_drive_requests
      ADD CONSTRAINT test_drive_outcome_known
      CHECK (outcome IS NULL OR outcome IN ('Won', 'Lost', 'Deciding'))
      NOT VALID;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
--
-- The read policy was `USING (true)`. Every row of this table carries a
-- buyer's name, phone number and email, so that published the contact details
-- of everyone who ever booked a test drive to anyone holding the anon key —
-- which ships in the browser bundle. Replaced with the same rule the dashboard
-- already applies in TypeScript: a seller sees their own requests, an admin
-- sees all. Doing it in the database means the filter is no longer advisory.
--
-- Identity is matched on email because that is the only link between an
-- authenticated user and a sellers row — `sellers` has no auth.uid() column.
-- That is worth fixing, but not by holding this behind it.

-- Admin has to exist in the database before a policy can ask about it.
--
-- Until now "who is an admin" lived only in the Angular bundle, in
-- environment.prod.ts's `adminEmails`. That is fine for deciding which links
-- to draw and useless for row-level security, which runs in Postgres and has
-- never heard of it. Checked against the live data before writing this: every
-- test drive request belongs to seller 1 (rajesh@rkmotors.in) or seller 7
-- (deepa@raoauto.in), so the account that actually reads this dashboard sees
-- those rows purely by being admin. Without the row below, switching the read
-- policy on would empty the tab.
--
-- Keep this list and environment.prod.ts's `adminEmails` in step. They are two
-- halves of one answer, and the database half is the one that is enforced.
INSERT INTO public.user_profiles (email, name, role)
VALUES ('manojkparija@gaadiiq.com', 'Manoj Parija', 'admin')
ON CONFLICT (email) DO UPDATE SET role = 'admin';

-- Dropped before each CREATE so the file can be applied twice. Postgres has no
-- CREATE POLICY IF NOT EXISTS, and a re-run that dies half way through is
-- worse than one that does nothing.
DROP POLICY IF EXISTS "public_read_requests" ON public.test_drive_requests;
DROP POLICY IF EXISTS "seller_reads_own_requests" ON public.test_drive_requests;
DROP POLICY IF EXISTS "seller_updates_own_requests" ON public.test_drive_requests;

CREATE POLICY "seller_reads_own_requests" ON public.test_drive_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.sellers s
      WHERE s.id = test_drive_requests.seller_id
        AND lower(s.email) = lower(auth.jwt() ->> 'email')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE lower(p.email) = lower(auth.jwt() ->> 'email')
        AND p.role = 'admin'
    )
  );

-- The missing half: whoever may read a request may also move it along.
-- Buyers cannot — a booking is not something the requester marks complete.
CREATE POLICY "seller_updates_own_requests" ON public.test_drive_requests
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.sellers s
      WHERE s.id = test_drive_requests.seller_id
        AND lower(s.email) = lower(auth.jwt() ->> 'email')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE lower(p.email) = lower(auth.jwt() ->> 'email')
        AND p.role = 'admin'
    )
  );

CREATE INDEX IF NOT EXISTS test_drive_requests_seller_status_idx
  ON public.test_drive_requests (seller_id, status);
