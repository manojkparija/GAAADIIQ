-- Columns the list-car form inserts that public.cars does not have.
--
-- Reported from production: submitting a listing failed with
--   PGRST204: Could not find the 'description' column of 'cars'
--             in the schema cache
--
-- WHY THIS HAPPENS
--
-- The list-car form writes a flattened advert straight into public.cars via
-- Supabase, naming ~23 columns and bypassing both the API and the ORM. Nothing
-- checks that list against the live table, so a column the table lacks rejects
-- the whole row, every time, identically. PostgREST reports only the FIRST
-- column it cannot find, so fixing one at a time surfaces the next one on the
-- next attempt — one failed submission per deploy.
--
-- This adds all of them at once instead.
--
-- WHAT IS AND IS NOT KNOWN TO BE MISSING
--
-- public.cars was created directly in Supabase before this directory existed,
-- so no file in this repository states its columns and they cannot be derived
-- by reading. What *can* be established is which columns are definitely
-- present: my-listings.service.ts runs this select against production and it
-- works, so every column in it exists —
--
--   id, make, model, variant, year, km, fuel, transmission, owners, color,
--   city, price, body_type, seller_email, verified, created_at, image_url
--
-- and 008 added seller_id and is_seller_listing.
--
-- That leaves the columns below: named by the insert, present in no select we
-- can point at, and unverifiable from here. `description` is confirmed missing
-- by the error above; the rest are unknown, which is exactly why every one is
-- guarded with IF NOT EXISTS. A column that already exists is a no-op — this
-- file asserts nothing about the current state and is safe to run repeatedly.
--
-- Corroboration for `description` specifically: my-listings.service.ts maps it
-- as a hardcoded empty string rather than reading r.description, which is what
-- you would write if the column had never been there.
--
-- Types follow what the form actually sends (list-car.component.ts:628).
-- Deliberately permissive `text` for the string columns, matching 008 — the
-- form applies no length limit, so a varchar(n) here would trade this failure
-- for a different one.

ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS description  text,
  ADD COLUMN IF NOT EXISTS badge        text,
  ADD COLUMN IF NOT EXISTS badge_type   text,
  ADD COLUMN IF NOT EXISTS seller_phone text,
  ADD COLUMN IF NOT EXISTS rating       numeric(2,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reviews      integer      DEFAULT 0;

-- PGRST204 is a *schema cache* error, not a Postgres one: PostgREST answers
-- from a cached copy of the catalogue and will keep rejecting the insert after
-- the columns exist until it reloads. It reloads on its own eventually; this
-- makes the fix take effect immediately rather than after an unpredictable
-- delay that looks exactly like the migration not having worked.
NOTIFY pgrst, 'reload schema';
