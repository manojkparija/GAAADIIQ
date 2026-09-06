-- Let the right people read an enquiry, and nobody else.
--
-- THE PROBLEM THIS SOLVES
--
-- Enquiries submit correctly now (023), and then vanish. car_enquiries has
-- row-level security enabled and exactly one policy — enquiries_insert, for
-- INSERT. Postgres default-denies, so with no SELECT policy the table returns
-- zero rows to everyone through the Supabase client: dealers, admins, all of
-- them. The buyer's details are recorded and unreachable.
--
-- THE RULE, AS DECIDED
--
-- A seller sees enquiries for their own cars; an admin sees all. Least access:
-- a dealer never sees a buyer who asked about somebody else's car.
--
-- MEASURED IN PRODUCTION BEFORE WRITING THIS (024a)
--
--   listings.id, .car_id, .seller_id  -> all uuid, so seller_id points at
--                                        users.id, NOT at sellers.id
--   sellers.id                        -> integer (a different seller concept;
--                                        not the one listings uses)
--   user_profiles admins              -> admin@gaadiiq.in,
--                                        manojkparija@gaadiiq.com
--   the recorded enquiry              -> is_catalogue_car = true,
--                                        is_listing = false
--
-- CATALOGUE ENQUIRIES HAVE NO SELLER, AND THAT IS NOT A BUG
--
-- car_enquiries.car_id does not hold one kind of id. cars-data.service.ts has
-- two mappers and they differ:
--
--     mapListing       -> id: lst.id   (a listings.id — someone's advert)
--     mapCatalogueCar  -> id: car.id   (a cars.id — manufacturer catalogue)
--
-- Both are UUIDs, so the column cannot say which it is; this policy asks the
-- listings table instead of guessing. An enquiry against manufacturer stock
-- has no dealer behind it, so it matches no seller clause and is visible to
-- admins only. That is the correct outcome, not a gap: there is nobody else it
-- could belong to. Every enquiry recorded so far is of this kind.
--
-- WHY EMAIL, AND WHY user_profiles
--
-- Copied from 010_test_drive_outcome.sql, which solves this exact problem for
-- test drive requests and works today. Email is the link between an
-- authenticated caller and a row, and "who is an admin" has to live in the
-- database — the Angular bundle's adminEmails list is invisible to Postgres.
--
-- 010's own warning applies here and is worth repeating: if the account that
-- reads the dashboard is not in user_profiles with role 'admin', switching
-- this policy on shows them an empty tab. The two admin rows above are what
-- production currently has. Confirm the account you sign in with is one of
-- them before concluding this migration is broken.

BEGIN;

-- Dropped first so the file can be applied twice. Postgres has no
-- CREATE POLICY IF NOT EXISTS, and a re-run that dies half way is worse than
-- one that does nothing.
DROP POLICY IF EXISTS "enquiries_seller_select" ON public.car_enquiries;
DROP POLICY IF EXISTS "enquiries_seller_or_admin_select" ON public.car_enquiries;

CREATE POLICY "enquiries_seller_or_admin_select" ON public.car_enquiries
  FOR SELECT USING (
    -- An admin sees everything, including catalogue enquiries that have no
    -- seller to route to.
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE lower(p.email) = lower(auth.jwt() ->> 'email')
        AND p.role = 'admin'
    )
    -- A seller sees an enquiry only when it names a listing they own.
    -- Joined through users because listings.seller_id is a uuid pointing at
    -- users.id — measured, not assumed; `sellers` uses integer ids and is a
    -- different concept.
    OR EXISTS (
      SELECT 1
      FROM public.listings l
      JOIN public.users u ON u.id = l.seller_id
      WHERE l.id = car_enquiries.car_id
        AND lower(u.email) = lower(auth.jwt() ->> 'email')
    )
  );

-- The seller clause looks up listings by id on every row read.
CREATE INDEX IF NOT EXISTS car_enquiries_car_id_idx
  ON public.car_enquiries (car_id);

COMMIT;

-- Check it took:
--
--   SELECT policyname, cmd FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'car_enquiries'
--   ORDER BY policyname;
--
-- Expect two rows: enquiries_insert (INSERT) and
-- enquiries_seller_or_admin_select (SELECT).
--
-- Then, signed in as an admin, the dealer dashboard's Enquiries tab should
-- show the row. If it is empty, check your signed-in email against
-- user_profiles before suspecting the policy.
