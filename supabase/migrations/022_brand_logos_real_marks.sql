-- Point brand logos at the real marks, not the hand-drawn stand-ins.
--
-- WHAT 021 GOT WRONG
--
-- 021_brand_logos_off_the_cdn.sql moved 35 brands off jsDelivr and onto SVGs
-- already sitting in src/assets/brand-logos/. That fixed the symptom it was
-- aimed at — the grid had been a wall of "No Image Available" placeholders —
-- and introduced a worse one, because nobody had opened those files.
--
-- They are not logos. They are approximations somebody sketched:
--
--   kia.svg       the word "KIA" set in Arial Black italic
--   hyundai.svg   a navy ellipse with a literal Arial letter H
--   tata.svg      a blue ellipse with a plain white T-bar
--   toyota.svg    three bare ellipses
--   nissan.svg    an ellipse, a grey bar, and the word NISSAN
--
-- Reported from the live site as "except mahindra all the logos are wrong",
-- which was exactly right. A wrong logo is worse than an absent one: a missing
-- image reads as a fault, a wrong trademark reads as the brand.
--
-- Mahindra was the single exception because mahindra.svg is properly drawn —
-- the M-peaks path in the correct red gradient. That is why migration 004
-- singled it out, and why it was the only tile that looked right.
--
-- WHAT THIS POINTS AT
--
-- The genuine marks, now committed to the repo as
-- assets/brand-logos/<slug>.png. They were downloaded once from the same
-- dataset the old CDN URLs referenced (filippofilip95/car-logos-dataset, from
-- `master`) and checked by eye against the brands before being committed —
-- 35 files, 276 KB in total.
--
-- THE ORIGINAL BUG, FOR THE RECORD
--
-- 003 used `@latest` in the jsDelivr path. For a GitHub-backed URL jsDelivr
-- resolves `@latest` to the newest *version tag*, and that repository
-- publishes none, so every logo URL 404'd. Pinning the ref (`@master`) would
-- have fixed the outage and left an unpinned dependency on a stranger's
-- repository in the page. Committing the files removes it: the logos now come
-- from our own origin and are cached by the service worker's `assets` group.
--
-- WHAT KEEPS ITS SVG
--
-- Mahindra, Force Motors and OLA Electric. Mahindra's is the good one, and the
-- dataset carries no mark for the other two. They are untouched below.
--
-- The superseded SVGs stay in the repo on purpose: brands.service falls back
-- to `assets/brand-logos/<slug>.svg` when logo_url is NULL, so deleting them
-- would put a placeholder under any brand row that has no logo_url.
--
-- Idempotent: re-running matches nothing, because the rows it touches no
-- longer end in .svg.


-- ── 1. Look before touching ─────────────────────────────────────────────────
-- What each active brand resolves to today. Expect the 35 below on .svg,
-- Mahindra/Force Motors/OLA Electric on .svg too, and four on Supabase
-- Storage — those four are admin uploads and must not be touched.
SELECT slug, logo_url
  FROM public.brands
 WHERE active
 ORDER BY sort_order;


-- ── 2. Move the 35 onto the real marks ──────────────────────────────────────
-- Only rows currently pointing at a local .svg, and only the slugs that have a
-- .png committed. A brand outside this list keeps whatever it has: an admin
-- upload on Supabase Storage, or the SVG that is still the best mark we hold.
--
-- Spelled out rather than derived, for the same reason 021 spelled its list
-- out: the database cannot see the filesystem, so a generated path would
-- happily name a file that does not exist and put the placeholders back.
UPDATE public.brands
   SET logo_url = 'assets/brand-logos/' || slug || '.png'
 WHERE logo_url LIKE 'assets/brand-logos/%.svg'
   AND slug IN (
     'aston-martin', 'audi',          'bentley',       'bmw',
     'byd',          'citroen',       'ferrari',       'genesis',
     'honda',        'hyundai',       'isuzu',         'jaguar',
     'jeep',         'kia',           'lamborghini',   'land-rover',
     'lexus',        'lotus',         'maruti-suzuki', 'maserati',
     'mclaren',      'mercedes-benz', 'mg',            'mini',
     'nissan',       'porsche',       'renault',       'rolls-royce',
     'skoda',        'tata',          'tesla',         'toyota',
     'vinfast',      'volkswagen',    'volvo'
   );


-- ── 3. Read it back ─────────────────────────────────────────────────────────
-- Expect exactly three rows: mahindra, force-motors, ola-electric. Anything
-- else still on a .svg is a brand with no real mark committed — it will render
-- a hand-drawn stand-in until one is added.
SELECT slug, logo_url
  FROM public.brands
 WHERE active
   AND logo_url LIKE '%.svg'
 ORDER BY slug;


-- ── 4. The whole grid, as the app will read it ──────────────────────────────
SELECT
    CASE
      WHEN logo_url IS NULL           THEN 'NULL -> local fallback'
      WHEN logo_url LIKE 'assets/%png' THEN 'real mark (png)'
      WHEN logo_url LIKE 'assets/%svg' THEN 'drawn svg'
      ELSE 'uploaded -> ' || logo_url
    END AS logo_source,
    count(*) AS brands
  FROM public.brands
 WHERE active
 GROUP BY 1
 ORDER BY 2 DESC;
