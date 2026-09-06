-- Read-only. Answers the four things a seller-read policy for car_enquiries
-- depends on. Nothing here writes anything.
--
-- WHY THIS EXISTS RATHER THAN A POLICY
--
-- The decision is settled — a seller sees enquiries for their own cars, admins
-- see all — but the linkage it needs is not, and this repository disagrees
-- with itself about it in three places:
--
--   * 009 reached for `car_listings`, which does not exist.
--   * 010 identifies a seller as `sellers.email = auth.jwt() ->> 'email'`,
--     with admin via `user_profiles.role = 'admin'`. That one demonstrably
--     works, so it is the pattern to copy.
--   * the API models a listing as `listings.seller_id -> users.id` (uuid),
--     which is a different seller concept from `sellers` (numeric id, email).
--
-- THE PART THAT CHANGES THE ANSWER
--
-- `car_enquiries.car_id` does not hold one kind of id. cars-data.service.ts
-- has two mappers and they populate `Car.id` differently:
--
--     mapListing       -> id: lst.id    (a listings.id — someone's advert)
--     mapCatalogueCar  -> id: car.id    (a cars.id — manufacturer catalogue)
--
-- Both are UUIDs, so the column cannot say which it is. And a catalogue car
-- has no seller at all: the S-Presso enquiry that was just submitted
-- successfully is a lead against manufacturer stock, not against a dealer's
-- advert. "The seller of that car" is undefined for it.
--
-- Query 4 is the one that settles this. Run all four and paste the results.

-- 1. The shape of listings: is seller_id a uuid (-> users.id) or something
--    that could match sellers.id? This decides which table the policy joins.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'listings'
  AND column_name IN ('id', 'car_id', 'seller_id')
ORDER BY column_name;

-- 2. Does the admin half of 010's pattern exist here, and is the account that
--    reads the dashboard in it? Without this row an admin sees nothing, which
--    is the failure mode 010 warns about in its own comments.
SELECT email, role
FROM public.user_profiles
WHERE role = 'admin'
ORDER BY email;

-- 3. What identifies a seller in the table 010 uses?
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'sellers'
  AND column_name IN ('id', 'email')
ORDER BY column_name;

-- 4. THE DECIDING ONE. For every enquiry recorded so far, does its car_id
--    point at a catalogue car, at a listing, or at neither?
--
--    Expected for the enquiry just submitted: catalogue, no listing — which
--    means it has no seller and, under the rule chosen, is visible to admins
--    only. If it comes back 'listing' instead, the policy can route it to that
--    listing's seller and the catalogue case is the rarer one.
SELECT
  e.id,
  e.car_id,
  EXISTS (SELECT 1 FROM public.cars c     WHERE c.id = e.car_id) AS is_catalogue_car,
  EXISTS (SELECT 1 FROM public.listings l WHERE l.id = e.car_id) AS is_listing,
  e.created_at
FROM public.car_enquiries e
ORDER BY e.created_at DESC
LIMIT 20;
