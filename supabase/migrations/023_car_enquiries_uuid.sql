-- Make car_enquiries.car_id hold what the app actually sends: a UUID.
--
-- REPORTED FROM THE LIVE SITE: "send enquiry form is not getting submitted".
--
-- 009_car_enquiries.sql declared
--
--     car_id int NOT NULL
--
-- and the buyer's enquiry has been failing on every attempt ever since,
-- silently: car-detail.component.ts caught the error and displayed "Could not
-- send enquiry. Please try again." That message is now replaced with the
-- database's own words, but the cause is here.
--
-- WHY IT IS A UUID
--
-- `Car.id` in cars-data.service.ts is typed `string`, and both mapListing and
-- mapCatalogueCar populate it from the API, which returns UUIDs — the same
-- ones visible in a /cars response, e.g.
-- "66289b53-c850-4236-8cdd-49b54245e131". Postgres refuses that for an int
-- column with 22P02, invalid_text_representation, every single time.
--
-- CLAUDE.md already records the underlying trap: "cars.id is a UUID in the
-- ORM. Batch 1 SQL says bigint; the ORM wins." This table was written against
-- the older assumption and never revisited.
--
-- WHY THE OLD ROWS CAN BE CONVERTED WITHOUT LOSS
--
-- There are none to lose. The insert has never succeeded — a UUID has never
-- been accepted by an int column — so any row present would predate the
-- current app. The USING clause below therefore converts what it can and the
-- migration fails loudly rather than quietly discarding anything, which is the
-- right way round: a surprise here should stop the migration, not the data.
--
-- WHAT THIS DOES NOT FIX
--
-- The seller-side read. The policy dropped and recreated below, and
-- dealer-dashboard.component.ts, both scope enquiries through `car_listings`,
-- a Supabase-side table with integer ids that is not defined anywhere in this
-- repository. That linkage is unrelated to the buyer being unable to submit,
-- and guessing at it would be a second change riding along with this one. The
-- policy is recreated exactly as it was so nothing silently loosens; it will
-- match nothing until that linkage is settled, which is what it did before.

BEGIN;

-- The policy reads car_id, so it has to go before the type can change.
DROP POLICY IF EXISTS "enquiries_seller_select" ON public.car_enquiries;

ALTER TABLE public.car_enquiries
  ALTER COLUMN car_id TYPE uuid USING car_id::text::uuid;

-- Recreated verbatim from 009. Unchanged on purpose: see the note above.
CREATE POLICY "enquiries_seller_select" ON public.car_enquiries
  FOR SELECT USING (
    car_id IN (
      SELECT id FROM public.car_listings
      WHERE seller_id = (
        SELECT id FROM public.sellers
        WHERE email = auth.jwt() ->> 'email'
        LIMIT 1
      )
    )
  );

COMMIT;

-- Check it took:
--
--   SELECT data_type FROM information_schema.columns
--   WHERE table_name = 'car_enquiries' AND column_name = 'car_id';
--
-- Expect: uuid
