-- Merge catalogue rows that a variant tag split apart.
--
-- Uploads used to create one `cars` row per (make, model, year, variant), so
-- photographing an S-Presso as VXi and again as ZXi produced two listings
-- holding half the photographs each. Uploads no longer do this — the row now
-- stands for the model — but rows created before that change are still split,
-- and nothing in the application merges them.
--
-- This script does the merge. For each (make, model, year) it keeps one row —
-- the variant-less one if there is one, otherwise the oldest — moves any
-- listings onto it, clears its variant, fills in whatever the duplicates knew
-- that it did not, and deletes them.
--
-- Images need no repair: they are matched to a car by make, model and year at
-- read time, so a merged row picks up every photograph automatically.
--
-- Run inside the transaction. Read the SELECT at the end before COMMIT — it
-- shows exactly what will be merged. ROLLBACK if it is not what you expect.

BEGIN;

-- The survivor of each split, and the rows that will fold into it.
CREATE TEMP TABLE car_merge ON COMMIT DROP AS
WITH grouped AS (
    SELECT
        id,
        lower(trim(make))  AS k_make,
        lower(trim(model)) AS k_model,
        year               AS k_year,
        first_value(id) OVER (
            PARTITION BY lower(trim(make)), lower(trim(model)), year
            ORDER BY (variant IS NULL) DESC, created_at, id
        ) AS keep_id
    FROM cars
    WHERE make IS NOT NULL AND model IS NOT NULL AND year IS NOT NULL
)
SELECT id AS drop_id, keep_id, k_make, k_model, k_year
FROM grouped
WHERE id <> keep_id;

-- What is about to happen. Nothing is merged if this is empty.
SELECT
    c.make, c.model, c.year,
    count(*) + 1                       AS rows_before,
    string_agg(d.variant, ', ')        AS variants_folded_in
FROM car_merge m
JOIN cars c ON c.id = m.keep_id
JOIN cars d ON d.id = m.drop_id
GROUP BY c.make, c.model, c.year
ORDER BY c.make, c.model, c.year;

-- Anything pointing at a duplicate now points at the survivor.
UPDATE listings l
SET car_id = m.keep_id
FROM car_merge m
WHERE l.car_id = m.drop_id;

-- The survivor stands for the model, so it carries no variant of its own.
-- Where it was missing a fact a duplicate had, take the duplicate's.
UPDATE cars c
SET variant           = NULL,
    ex_showroom_price = COALESCE(c.ex_showroom_price, best.ex_showroom_price),
    body_type         = COALESCE(c.body_type,         best.body_type),
    fuel_type         = COALESCE(c.fuel_type,         best.fuel_type),
    transmission      = COALESCE(c.transmission,      best.transmission)
FROM (
    SELECT
        m.keep_id,
        min(d.ex_showroom_price) AS ex_showroom_price,
        min(d.body_type)         AS body_type,
        min(d.fuel_type)         AS fuel_type,
        min(d.transmission)      AS transmission
    FROM car_merge m
    JOIN cars d ON d.id = m.drop_id
    GROUP BY m.keep_id
) AS best
WHERE c.id = best.keep_id;

DELETE FROM cars WHERE id IN (SELECT drop_id FROM car_merge);

-- Proof: no (make, model, year) should have more than one row left.
SELECT lower(trim(make)) AS make, lower(trim(model)) AS model, year, count(*)
FROM cars
GROUP BY 1, 2, 3
HAVING count(*) > 1;

COMMIT;
