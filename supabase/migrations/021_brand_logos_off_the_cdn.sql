-- Point every brand logo at the local asset instead of a third-party CDN.
--
-- REPORTED FROM THE LIVE SITE
--
-- The /new-cars brand grid renders dark navy tiles reading "No Image
-- Available" for every brand except Mahindra and VinFast.
--
-- WHAT IS ACTUALLY ON SCREEN
--
-- Those tiles are not broken images. They are src/assets/placeholder.svg —
-- a #0B1220 rectangle with a blue car outline and the text "No Image
-- Available" — swapped in by new-cars.component.ts::onImgError when the real
-- image fails to load. So the browser IS failing to fetch the logo, and the
-- app is dutifully showing its fallback.
--
-- WHY EXACTLY THOSE TWO BRANDS SURVIVE
--
-- 003_update_logo_urls.sql set logo_url for 35 brands to
-- cdn.jsdelivr.net/gh/filippofilip95/car-logos-dataset@latest/logos/thumb/...
--
-- 004_fix_mahindra_logo.sql pointed Mahindra back at a local SVG. VinFast was
-- never in 003, so its logo_url is NULL and brands.service falls back to
-- `assets/brand-logos/<slug>.svg`.
--
-- Mahindra and VinFast are precisely the two brands NOT pointed at the CDN,
-- and precisely the two that render. Every tile fed by jsDelivr is a
-- placeholder. That is the whole of it.
--
-- 004's own comment already named the risk it was avoiding for one brand:
-- the local SVG "needs no third-party CDN to be reachable for the tile to
-- render". This applies that reasoning to the other 34.
--
-- WHY NOT JUST FIX THE CDN URL
--
-- The URL is pinned to `@latest`, which is not a pin at all — it resolves to
-- whatever that GitHub repo's newest tag happens to be, and neither the tag
-- nor the repo nor the file layout is ours. Whatever is wrong today, the same
-- class of failure recurs the next time somebody else's repository changes,
-- and it recurs silently: nothing errors, the grid just quietly fills with
-- "No Image Available".
--
-- The logos are already in this repository. 38 SVGs live in
-- apps/gaadiiq-angular/src/assets/brand-logos/, and all 35 CDN-backed brands
-- have one — verified by listing both sets and diffing them, so no brand
-- loses its logo to this change. They are served from our own origin, cached
-- by the service worker's `assets` group, and cannot be changed by anyone
-- outside this repo.
--
-- WHAT THIS DOES NOT CHANGE
--
-- Nothing about how the app reads logos. brands.service already renders
-- whatever logo_url holds and falls back to the local SVG when it is NULL;
-- both paths stay exactly as they are. An admin uploading a logo through the
-- admin-brands screen still overwrites logo_url and still wins — this only
-- changes the value sitting in the column today.
--
-- Idempotent: re-running matches nothing, because the rows it touches no
-- longer point at the CDN.


-- ── 1. Look before touching ─────────────────────────────────────────────────
-- How many brands are still on the CDN, and which. Mahindra should already be
-- absent from this list; VinFast should be NULL rather than listed.
SELECT slug, logo_url
  FROM public.brands
 WHERE logo_url LIKE '%jsdelivr.net%'
 ORDER BY slug;


-- ── 2. Move them onto the local assets ──────────────────────────────────────
-- Every slug here has a matching file in
-- apps/gaadiiq-angular/src/assets/brand-logos/<slug>.svg. The list is spelled
-- out rather than derived, because the database cannot see the filesystem: a
-- generated path would silently point at a file that may not exist, and the
-- result would be another grid of placeholders — the same failure this is
-- fixing, arrived at from the other direction.
UPDATE public.brands
   SET logo_url = 'assets/brand-logos/' || slug || '.svg'
 WHERE logo_url LIKE '%jsdelivr.net%'
   AND slug IN (
     'aston-martin', 'audi',          'bentley',       'bmw',
     'byd',          'citroen',       'ferrari',       'genesis',
     'honda',        'hyundai',       'isuzu',         'jaguar',
     'jeep',         'kia',           'lamborghini',   'land-rover',
     'lexus',        'lotus',         'mahindra',      'maruti-suzuki',
     'maserati',     'mclaren',       'mercedes-benz', 'mg',
     'mini',         'nissan',        'porsche',       'renault',
     'rolls-royce',  'skoda',         'tata',          'tesla',
     'toyota',       'volkswagen',    'volvo'
   );


-- ── 3. Read it back ─────────────────────────────────────────────────────────
-- Expect zero rows. Any row still listed is a brand whose slug is not in the
-- list above — it has no local SVG and needs one committed to the repo before
-- it can be moved off the CDN. Leave it pointing at the CDN until then; a
-- logo_url pointing at a file that does not exist renders the same "No Image
-- Available" tile.
SELECT slug, logo_url
  FROM public.brands
 WHERE logo_url LIKE '%jsdelivr.net%'
 ORDER BY slug;


-- ── 4. The whole grid, as the app will read it ──────────────────────────────
-- Every active brand in the order the page renders them. A NULL logo_url is
-- fine — brands.service falls back to the same local path.
SELECT slug, coalesce(logo_url, '(null → assets/brand-logos/' || slug || '.svg)') AS resolves_to
  FROM public.brands
 WHERE active
 ORDER BY sort_order;
