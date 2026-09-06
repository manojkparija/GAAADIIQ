-- Record which sales executive is handling a test drive.
--
-- ASKED FOR DIRECTLY: "test drive enquiries needs to be handled by a sales
-- executive, his details needs to be captured here" — annotated on the Test
-- Drives tab of the dealer dashboard.
--
-- Today a request lands with a status and, once it happens, an outcome. What
-- it never records is who took it. With one person that is obvious; with three
-- it is the first question asked when a buyer rings back and nobody knows who
-- promised them what.
--
-- WHY FREE TEXT AND NOT A FOREIGN KEY
--
-- The obvious design is to point this at a staff record and pick from a list.
-- There is nothing to point at. The role enum is buyer | seller | dealer |
-- admin — checked, not assumed — so "sales executive" is not a kind of account
-- that exists, and `sellers` is a business, not a person on the floor.
--
-- Inventing a staff table and a fifth role to satisfy a two-field request
-- would be a much larger change than the one asked for, and it would have to
-- be onboarded before the dashboard could record anything at all. That is the
-- wrong order: the need is to write down who is handling this drive, today.
--
-- The columns are shaped so the upgrade stays open. When staff accounts exist,
-- an executive_id can be added beside these and backfilled by matching on
-- phone; nothing recorded now is lost or has to be re-entered.
--
-- WHY A PHONE AND NOT AN EMAIL
--
-- The buyer's own contact on this table is a phone number, because that is how
-- this business actually reaches people. An executive is reached the same way,
-- and a colleague chasing a handover wants the number, not an inbox.
--
-- assigned_at answers "how long did this sit unassigned", which is the metric
-- that tells you whether the process works. It is set when a name is first
-- written and left alone afterwards: reassigning does not restart the clock on
-- how long the buyer waited for somebody to pick it up.
--
-- NO NEW POLICY IS NEEDED
--
-- 010 already grants UPDATE on this table to the seller who owns the request
-- and to admins, and a Postgres UPDATE policy covers the whole row rather than
-- named columns. So exactly the people who can already move a request along
-- can record who is handling it, which is the right set — and nobody else
-- gains anything.

BEGIN;

ALTER TABLE public.test_drive_requests
  ADD COLUMN IF NOT EXISTS executive_name  text,
  ADD COLUMN IF NOT EXISTS executive_phone text,
  ADD COLUMN IF NOT EXISTS assigned_at     timestamptz;

-- "What is still nobody's job", which is the list somebody works from.
CREATE INDEX IF NOT EXISTS test_drive_requests_unassigned_idx
  ON public.test_drive_requests (created_at)
  WHERE executive_name IS NULL;

COMMIT;

-- Check it took:
--
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'test_drive_requests'
--     AND column_name IN ('executive_name', 'executive_phone', 'assigned_at')
--   ORDER BY column_name;
--
-- Expect three rows. Existing requests keep NULL — they were handled by
-- whoever handled them, and inventing a name for them would be worse than
-- leaving the column honest about not knowing.
