-- Fill in cars.fuel_type from cars.fuel, so listed cars appear under their fuel.
--
-- Reported: an e Vitara whose photographs were approved never showed under
-- Electric. Approving had nothing to do with it.
--
-- `cars` carries the fuel twice and the two halves of the app disagree about
-- which one is real:
--
--   fuel       text   written by the list-car form (Supabase, direct)
--   fuel_type  enum   what the API filters on (routers/cars.py:57)
--
-- Measured in production rather than assumed:
--
--   model         year  fuel      fuel_type
--   e Vitara      2026  Electric  NULL       <- listed via the form
--   e Vitara      2026  Petrol    NULL       <- listed via the form
--   Grand Vitara  2026  NULL      electric   <- created by the image upload
--
-- Exactly inverted, because the two paths populate different columns. Every
-- car listed through the form is therefore invisible to every fuel filter.
--
-- This backfills the column for rows that have a fuel recorded and no
-- fuel_type. It never overwrites a fuel_type that is already set: where the
-- two disagree, the enum is the one the API has been serving and the one a
-- human may have corrected, so it wins.
--
-- The IN clause is a guard, not decoration. `fuel` is free text and a value
-- outside the enum's labels would abort the whole statement on a cast; those
-- rows are skipped and left for a human instead.
--
-- Idempotent: re-running matches nothing, because every row it touched now
-- has a fuel_type.

-- Declared before it is used, even though production already has it.
--
-- The listing form now writes this column, and listing-columns.spec.ts holds
-- every column that insert names to the same standard: accounted for by a
-- migration, not by someone having seen it in a query once. That guard failed
-- this PR's first CI run for exactly this reason, which is the guard working.
--
-- The column and its enum type both exist in production (measured: Grand
-- Vitara 2026 carries fuel_type 'electric'), so this is a no-op there. It
-- matters for any environment rebuilt from these files, where the backfill
-- below would otherwise fail on a column that does not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fuel_type') THEN
    ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS fuel_type fuel_type;
  END IF;
END $$;

UPDATE public.cars
   SET fuel_type = lower(btrim(fuel))::fuel_type
 WHERE fuel_type IS NULL
   AND fuel IS NOT NULL
   AND lower(btrim(fuel)) IN ('petrol', 'diesel', 'electric', 'cng', 'hybrid');

-- What this could not convert, for a human to look at. Rows with a fuel that
-- is not one of the enum's labels keep a NULL fuel_type and stay invisible to
-- the filters — reporting that is the point, since silence here would look
-- exactly like success.
DO $$
DECLARE
  leftover integer;
BEGIN
  SELECT count(*) INTO leftover
    FROM public.cars
   WHERE fuel_type IS NULL AND nullif(btrim(fuel), '') IS NOT NULL;

  IF leftover > 0 THEN
    RAISE NOTICE
      'still % row(s) with a fuel this could not map to the enum; '
      'run: SELECT DISTINCT fuel FROM public.cars WHERE fuel_type IS NULL '
      'AND nullif(btrim(fuel), '''') IS NOT NULL;', leftover;
  END IF;
END $$;
