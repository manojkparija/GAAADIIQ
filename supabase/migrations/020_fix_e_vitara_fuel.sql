-- The e Vitara is electric. One of its rows says Petrol.
--
-- Reported from the live site: the model page shows "Fuel: Petrol" beside
-- "Motor Type: Permanent Magnet Synchronous" and "Battery Capacity: 49 kWh /
-- 61 kWh" — the EV fields are right and the fuel contradicts them.
--
-- HOW IT GOT THERE
--
-- Not a bug in 016; 016 did exactly what it said. That migration recorded the
-- production data it measured:
--
--   model         year  fuel      fuel_type
--   e Vitara      2026  Electric  NULL
--   e Vitara      2026  Petrol    NULL       <- entered wrong in the form
--   Grand Vitara  2026  NULL      electric
--
-- `cars.fuel` is free text written by the list-car form. Someone listed an
-- e Vitara and picked Petrol. 016 then backfilled `fuel_type` FROM `fuel`, so
-- the typo was faithfully promoted into the enum the API filters on. The bad
-- value is upstream of the backfill, which is why fixing it means correcting
-- the source column too, not just the enum.
--
-- BOTH COLUMNS, OR IT COMES BACK
--
-- `cars` carries the fuel twice — `fuel` (text, the form) and `fuel_type`
-- (enum, the API). Setting only the enum leaves `fuel` saying Petrol, which is
-- what any future backfill or form re-save would read from. Setting only the
-- text leaves every fuel filter still calling it petrol. Both.
--
-- GRAND VITARA MUST NOT BE TOUCHED
--
-- Maruti sells a Grand Vitara, and it is petrol/hybrid. `LIKE '%vitara%'` would
-- convert it to electric and be a worse bug than the one being fixed — 016's
-- own table lists it one line below the row we are correcting. The match below
-- is an exact comparison after normalising case and dashes, so 'e Vitara',
-- 'E Vitara' and 'e-Vitara' all match and 'Grand Vitara' cannot.
--
-- Idempotent: re-running matches nothing, because the rows it touches no
-- longer say petrol.


-- ── 1. Look before touching ─────────────────────────────────────────────────
-- Every Vitara-ish row, so the Grand Vitara is visibly excluded from what
-- follows and any duplicate e Vitara rows are visible rather than assumed.
SELECT id, make, model, year, fuel, fuel_type, engine_cc
  FROM public.cars
 WHERE model ILIKE '%vitara%'
 ORDER BY model, year;


-- ── 2. The catalogue row ────────────────────────────────────────────────────
UPDATE public.cars
   SET fuel      = 'Electric',
       fuel_type = 'electric'::fuel_type
 WHERE replace(lower(btrim(model)), '-', ' ') = 'e vitara'
   AND (
         fuel_type IS DISTINCT FROM 'electric'::fuel_type
      OR lower(btrim(coalesce(fuel, ''))) IS DISTINCT FROM 'electric'
       );


-- ── 3. Its trims ────────────────────────────────────────────────────────────
-- car_variants.fuel_type is free text (String(40)), deliberately — one model
-- sells in several fuels, so this is not the catalogue's enum. Only rows that
-- currently disagree are touched, and only for this model.
UPDATE public.car_variants v
   SET fuel_type = 'Electric'
  FROM public.cars c
 WHERE v.car_id = c.id
   AND replace(lower(btrim(c.model)), '-', ' ') = 'e vitara'
   AND lower(btrim(coalesce(v.fuel_type, ''))) IS DISTINCT FROM 'electric';


-- ── 4. Read it back ─────────────────────────────────────────────────────────
-- Every e Vitara row should now read Electric / electric, and the Grand Vitara
-- should be exactly as it was in step 1.
SELECT id, make, model, year, fuel, fuel_type, engine_cc
  FROM public.cars
 WHERE model ILIKE '%vitara%'
 ORDER BY model, year;


-- ── 5. Anything else claiming to be an EV and a petrol car at once ──────────
-- A REPORT, not an update. Deliberately not automated: "the name contains EV"
-- is a guess, and a wrong guess here writes a false fact into the catalogue
-- that reads exactly like a checked one. A human decides each of these.
SELECT id, make, model, year, fuel, fuel_type
  FROM public.cars
 WHERE fuel_type IS DISTINCT FROM 'electric'::fuel_type
   AND (
         model ~* '(^|[^a-z])e[ -]'      -- "e Vitara", "e-tron"
      OR model ~* '(^|[^a-z])ev([^a-z]|$)'
      OR model ILIKE '%electric%'
       )
 ORDER BY make, model;
