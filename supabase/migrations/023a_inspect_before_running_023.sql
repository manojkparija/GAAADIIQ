-- Read-only. Run this BEFORE 023 and paste the three results back.
--
-- Written because today has already produced two surprises from assuming the
-- live schema matched the files in this repository: car_listings does not
-- exist, and the seller-read policy in 009 therefore never applied. Neither
-- was visible from the source.
--
-- Nothing here writes anything.

-- 1. Which of the tables this migration reasons about actually exist?
--    car_listings and sellers are expected to be ABSENT — that is the finding
--    from the 42P01 error. listings, users and cars are expected to be
--    present, and are the tables a corrected seller-read policy would use.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('car_enquiries', 'car_listings', 'listings', 'sellers', 'users', 'cars')
ORDER BY table_name;

-- 2. What shape is car_enquiries in right now?
--    The claim being tested: car_id is `integer`, which is why every enquiry
--    insert fails with 22P02. If it comes back `uuid` already, the diagnosis
--    is wrong and 023 must not be run.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'car_enquiries'
ORDER BY ordinal_position;

-- 3. Which policies are actually on it?
--    Expected: enquiries_insert only. If enquiries_seller_select appears here
--    after all, then it was created some other way and 023's DROP is not the
--    no-op its comments claim — say so before running it.
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'car_enquiries'
ORDER BY policyname;
