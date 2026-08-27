-- The rest of the columns the list-car form inserts into public.cars.
--
-- 014 added six columns and the submission then failed on the seventh:
--   PGRST204: Could not find the 'image_url' column of 'cars' in the schema cache
--
-- WHY 014 WAS INCOMPLETE
--
-- 014 treated the select in my-listings.service.ts as proof that the columns
-- it names exist, on the reasoning that the screen works. That reasoning was
-- wrong. The select's result is discarded unless it succeeds:
--
--     if (!error && data && data.length > 0) { ...use it... }
--     } catch { /* keep local data */ }
--
-- plus a 5s timeout that resolves to an error object. A select that fails
-- because a column is missing takes the same path as one that returns nothing:
-- the screen falls back to localStorage and looks completely normal. So it
-- never demonstrated that any of those columns exist — `image_url` was in that
-- select, and it does not exist.
--
-- This file therefore assumes nothing about the live table. It names every
-- remaining column the insert sends (list-car.component.ts:628), each guarded
-- with IF NOT EXISTS so anything already present is a no-op. Combined with 008
-- and 014, all 23 inserted columns are now accounted for by migrations rather
-- than by inference.
--
-- Types follow what the form sends. Where a column already exists with a
-- different but workable type, IF NOT EXISTS leaves it alone — this file
-- cannot and does not try to change existing types.

ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS make         text,
  ADD COLUMN IF NOT EXISTS model        text,
  ADD COLUMN IF NOT EXISTS variant      text,
  ADD COLUMN IF NOT EXISTS year         integer,
  ADD COLUMN IF NOT EXISTS km           integer,
  ADD COLUMN IF NOT EXISTS fuel         text,
  ADD COLUMN IF NOT EXISTS transmission text,
  ADD COLUMN IF NOT EXISTS color        text,
  ADD COLUMN IF NOT EXISTS city         text,
  ADD COLUMN IF NOT EXISTS price        numeric(12,2),
  ADD COLUMN IF NOT EXISTS verified     boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS image_url    text;

-- The follow-up inserts, which run after the car row is committed. Their
-- failures surface as a warning on the success screen rather than as a failed
-- submission, so a missing column here costs the seller their photographs
-- quietly. Guarded the same way; no-ops if these tables already match.
--
-- Deliberately NOT creating the tables themselves: if car_images or
-- ai_valuation do not exist, that is a different problem with a different fix,
-- and CREATE TABLE here would invent a shape nothing has agreed on.
DO $$
BEGIN
  IF to_regclass('public.car_images') IS NOT NULL THEN
    ALTER TABLE public.car_images
      ADD COLUMN IF NOT EXISTS car_id     uuid,
      ADD COLUMN IF NOT EXISTS url        text,
      ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;
  END IF;
END $$;

-- PGRST204 is a *schema cache* error: PostgREST answers from a cached copy of
-- the catalogue and keeps rejecting the insert after the columns exist until
-- it reloads.
NOTIFY pgrst, 'reload schema';
