-- Fix: ai_valuation.car_id is bigint, cars.id is uuid
--
-- SYMPTOM, FROM PRODUCTION
--
--   Your listing was created, but the AI valuation (invalid input syntax for
--   type bigint: "664045d0-e803-4d85-b022-745184cbaac0") could not be saved
--   with it.
--
-- Every used-car submission hits this. The browser inserts into ai_valuation
-- with car_id set to the uuid that the cars insert returned, and the column
-- cannot hold one.
--
-- WHY IT IS LIKE THIS
--
-- The schema lives in two places (see CLAUDE.md): 25 Alembic migrations, and
-- hand-run schema_setup_batch*.sql files at the repo root. Batch 1 declares
-- cars.id as bigint; the ORM declares it uuid, and the ORM is what production
-- actually has for `cars`. ai_valuation was created from the batch file and
-- kept the bigint it was written against, so the two tables disagree about
-- what a car id is.
--
-- BEFORE YOU RUN THIS
--
-- Check what is actually there. Do not assume this file is right about your
-- database — it was written from the error message, not from a connection to
-- it, because this environment has no access to your Supabase instance.
--
--   SELECT table_name, column_name, data_type
--     FROM information_schema.columns
--    WHERE table_name IN ('ai_valuation', 'cars')
--      AND column_name IN ('id', 'car_id')
--    ORDER BY table_name, column_name;
--
-- Expect: cars.id = uuid, ai_valuation.car_id = bigint. If cars.id comes back
-- as bigint, STOP — the problem is the other way round and this script is
-- wrong for your database.
--
--   SELECT count(*) FROM ai_valuation;
--
-- Any existing rows carry bigint ids that cannot be mapped onto uuids. If the
-- count is greater than zero, decide what those rows are worth before running
-- step 2 — it discards them. A valuation is a derived figure that can be
-- recomputed, so dropping them is usually right, but that is your call and
-- not one this script should make silently.

BEGIN;

-- 1. A foreign key, if one exists, must go before the type changes.
ALTER TABLE ai_valuation DROP CONSTRAINT IF EXISTS ai_valuation_car_id_fkey;

-- 2. Discard rows whose car_id cannot be carried across.
--
-- There is no conversion from bigint to uuid: the old values do not identify
-- any row in the current cars table. Keeping them and casting would invent
-- associations that were never real.
DELETE FROM ai_valuation;

-- 3. The column itself.
ALTER TABLE ai_valuation
  ALTER COLUMN car_id TYPE uuid USING NULL;

-- 4. Point it back at cars, so a valuation cannot outlive the car it describes.
ALTER TABLE ai_valuation
  ADD CONSTRAINT ai_valuation_car_id_fkey
  FOREIGN KEY (car_id) REFERENCES cars (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS ix_ai_valuation_car_id ON ai_valuation (car_id);

COMMIT;

-- AFTERWARDS
--
-- Re-run the first query above and confirm ai_valuation.car_id is uuid. Then
-- submit a used car through /list-car: the warning should be gone.
--
-- WORTH CHECKING WHILE YOU ARE IN HERE
--
-- car_images is written by the same browser path with the same car_id. It has
-- not produced this error, which suggests it is already uuid — but "has not
-- errored yet" is not proof, so include it in the query above and confirm.
