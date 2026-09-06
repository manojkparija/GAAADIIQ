-- Make car_enquiries.car_id hold what the app actually sends: a UUID.
--
-- REPORTED FROM THE LIVE SITE: "send enquiry form is not getting submitted".
--
-- 009_car_enquiries.sql declared
--
--     car_id int NOT NULL
--
-- while `Car.id` in cars-data.service.ts is typed `string`, and both
-- mapListing and mapCatalogueCar populate it from the API, which returns
-- UUIDs — the same ones visible in a /cars response, e.g.
-- "66289b53-c850-4236-8cdd-49b54245e131". Postgres refuses that for an int
-- column with 22P02, invalid_text_representation, every single time. The form
-- has never worked, for any car.
--
-- CLAUDE.md already records the underlying trap: "cars.id is a UUID in the
-- ORM. Batch 1 SQL says bigint; the ORM wins." This table was written against
-- the older assumption and never revisited.
--
-- WHY THE SELLER-READ POLICY IS NOT RECREATED HERE
--
-- The first draft of this migration recreated it verbatim from 009, on the
-- principle that a migration should not quietly loosen a permission. Running
-- it against production gave:
--
--     ERROR: 42P01: relation "public.car_listings" does not exist
--
-- which is worth stating plainly: **that policy has never existed.** 009 would
-- have failed on the same line when it was first run, so car_enquiries has its
-- insert policy and no seller-read policy at all. Recreating it verbatim would
-- abort this transaction and take the column change down with it — which is
-- exactly what happened.
--
-- Nor can it simply be pointed at the right table here. Introspection of the
-- live database (023a) returned car_enquiries, cars, listings, sellers and
-- users — so of the two names 009 uses, `sellers` is real and `car_listings`
-- is the one that does not exist. The table it was reaching for is `listings`
-- (uuid id, uuid car_id -> cars.id, uuid seller_id -> users.id).
--
-- Rewriting the policy against that is a change to who can read buyer contact
-- details, which is a decision about access to personal data and not something
-- to smuggle into a column-type fix — the more so because `sellers` and
-- `users` are two different tables and which one a seller is identified by
-- decides who gets to see phone numbers. dealer-dashboard.component.ts queries
-- the same non-existent car_listings, so the seller-side read is broken end to
-- end and wants fixing as one deliberate piece.
--
-- The effect of this migration on read access is therefore: none. There is no
-- policy to drop and none is added.
--
-- CONFIRMED AGAINST PRODUCTION BEFORE RUNNING (023a)
--
--   car_enquiries.car_id  -> integer, NOT NULL     (the bug, measured)
--   policies on the table -> enquiries_insert only (so the DROP below is a
--                                                   genuine no-op)
--   car_listings          -> absent
--
-- WHY THE OLD ROWS CAN BE CONVERTED WITHOUT LOSS
--
-- There are none to lose. The insert has never succeeded — a UUID has never
-- been accepted by an int column — so any row present would predate the
-- current app. The USING clause converts what it can and fails loudly rather
-- than discarding anything, which is the right way round: a surprise here
-- should stop the migration, not the data.

BEGIN;

-- No-op if it is absent, which is the expected case: see the note above.
DROP POLICY IF EXISTS "enquiries_seller_select" ON public.car_enquiries;

ALTER TABLE public.car_enquiries
  ALTER COLUMN car_id TYPE uuid USING car_id::text::uuid;

COMMIT;

-- Check it took:
--
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'car_enquiries'
--   ORDER BY ordinal_position;
--
-- Expect car_id -> uuid.
