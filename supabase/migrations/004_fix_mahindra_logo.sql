-- Point Mahindra back at the local asset.
--
-- 003_update_logo_urls.sql swapped every brand onto the jsDelivr car-logos
-- dataset, which is the right call for most of them. Mahindra is the exception:
-- that dataset's thumbnail is the older mark set beneath a wordmark, so at the
-- size the brand grid renders it the mark is a few pixels tall and the wordmark
-- is unreadable. It is visibly the faintest tile in a row of crisp ones.
--
-- The local SVG is the mark alone, scales without blurring, and needs no
-- third-party CDN to be reachable for the tile to render.
--
-- Run this in the Supabase SQL Editor. The brands table is what the app reads;
-- the TypeScript fallback in src/app/data/brands.ts only applies when this
-- table has no matching row, so changing the code alone will not update a
-- deployment whose database has already run 003.

UPDATE public.brands
SET logo_url = 'assets/brand-logos/mahindra.svg'
WHERE slug = 'mahindra';
