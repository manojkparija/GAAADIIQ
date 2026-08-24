-- Brand logos, uploadable from the admin screen instead of committed to the repo.
--
-- WHAT WAS ACTUALLY IN THE WAY
--
-- 002 created public.brands, enabled row level security, and declared exactly
-- one policy: brands_public_read, FOR SELECT. With RLS on and no write policy,
-- Postgres denies every INSERT and UPDATE from the browser — including an
-- admin's. So the table has never been writable from the application at all,
-- and every logo change so far has gone through the SQL editor (003 repointed
-- the set at a CDN, 004 put Mahindra back on a local file). That is the reason
-- "uploading a logo" has meant "commit a file and ask someone to run SQL".
--
-- This adds the write policies and somewhere for the file to live.
--
-- WHERE THE IMAGE GOES
--
-- Into Supabase Storage, with public.brands.logo_url pointing at it — the same
-- shape the car-images bucket already uses. The bytes are deliberately NOT in a
-- column: the homepage renders ~24 logos on first paint, and served from
-- storage they come off a CDN with normal browser caching, where a bytea column
-- would put all of them through the API on every cold load.
--
-- logo_url stays a plain text URL, so the rows written by 002/003/004 keep
-- working untouched. A local `assets/...` path, a CDN URL and a bucket URL are
-- all just strings to the frontend.

BEGIN;

-- ── brands: provenance for a logo ───────────────────────────────────────────
--
-- Which of the three sources a row is on is currently guesswork from the URL's
-- shape. These record it, so the admin screen can say "uploaded by you on the
-- 3rd" rather than showing a URL and leaving the reader to parse it.
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS logo_storage_path text,
  ADD COLUMN IF NOT EXISTS logo_updated_at   timestamptz,
  ADD COLUMN IF NOT EXISTS logo_updated_by   text;

COMMENT ON COLUMN public.brands.logo_url IS
  'Where the logo is fetched from: a bucket URL, a CDN URL, or an app-relative assets/ path. Never image bytes.';
COMMENT ON COLUMN public.brands.logo_storage_path IS
  'Object key inside the brand-logos bucket, when the logo was uploaded. NULL for CDN and assets/ rows. Kept so a replaced file can be deleted rather than orphaned.';

-- ── Writes: admins only ─────────────────────────────────────────────────────
--
-- Same admin test the car_images policies use (011): user_profiles.role, keyed
-- on a lowered email from the JWT. Copied deliberately rather than improved —
-- one definition of "is an admin" that is applied consistently is worth more
-- than a better one that exists in only half the policies.
--
-- Read stays open. The brand grid is on the homepage, which signed-out visitors
-- see.
DROP POLICY IF EXISTS "brands_admin_insert" ON public.brands;
DROP POLICY IF EXISTS "brands_admin_update" ON public.brands;

CREATE POLICY "brands_admin_insert" ON public.brands
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE lower(p.email) = lower(auth.jwt() ->> 'email')
        AND p.role = 'admin'
    )
  );

CREATE POLICY "brands_admin_update" ON public.brands
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE lower(p.email) = lower(auth.jwt() ->> 'email')
        AND p.role = 'admin'
    )
  );

-- No DELETE policy, so deletes stay denied.
--
-- Removing a brand from the grid is what `active` is for, and it is reversible.
-- A delete is not: the row carries the sort order and the logo history, and the
-- brand may still be referenced by cars in the catalogue.

COMMIT;

-- ── The bucket ──────────────────────────────────────────────────────────────
--
-- Outside the transaction above: storage.buckets and storage.objects are owned
-- by the storage extension, and on some projects these statements need to be
-- run by the dashboard's SQL editor as the owner. Keeping them separate means a
-- permission error here cannot roll back the table changes, which stand on
-- their own.

INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-logos', 'brand-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Public read: these are rendered on the homepage for signed-out visitors, so
-- the object has to be fetchable without a token. Nothing sensitive is in this
-- bucket by construction — it holds manufacturer logos and nothing else.
DROP POLICY IF EXISTS "brand_logos_public_read"  ON storage.objects;
DROP POLICY IF EXISTS "brand_logos_admin_write"  ON storage.objects;
DROP POLICY IF EXISTS "brand_logos_admin_update" ON storage.objects;
DROP POLICY IF EXISTS "brand_logos_admin_delete" ON storage.objects;

CREATE POLICY "brand_logos_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'brand-logos');

CREATE POLICY "brand_logos_admin_write" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'brand-logos'
    AND EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE lower(p.email) = lower(auth.jwt() ->> 'email')
        AND p.role = 'admin'
    )
  );

CREATE POLICY "brand_logos_admin_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'brand-logos'
    AND EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE lower(p.email) = lower(auth.jwt() ->> 'email')
        AND p.role = 'admin'
    )
  );

CREATE POLICY "brand_logos_admin_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'brand-logos'
    AND EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE lower(p.email) = lower(auth.jwt() ->> 'email')
        AND p.role = 'admin'
    )
  );
