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
-- Run STEP 1 and read it. Run STEP 2 only if STEP 1 describes what you want.
--
-- Both are single statements, because a browser SQL console (Supabase's
-- included) runs each statement in its own transaction: a temp table created
-- by one statement is gone before the next one runs, and a BEGIN/COMMIT pair
-- typed around several statements does not necessarily hold them together.
-- Everything each step needs is therefore inside one statement, which Postgres
-- runs atomically — it either all happens or none of it does.


-- ── STEP 1: what would be merged ───────────────────────────────────────────
-- Read-only. Empty result means nothing is split and STEP 2 has nothing to do.

WITH grouped AS (
    SELECT
        id,
        make,
        model,
        year,
        variant,
        first_value(id) OVER (
            PARTITION BY lower(trim(make)), lower(trim(model)), year
            ORDER BY (variant IS NULL) DESC, created_at, id
        ) AS keep_id
    FROM cars
    WHERE make IS NOT NULL AND model IS NOT NULL AND year IS NOT NULL
)
SELECT
    make,
    model,
    year,
    count(*)                     AS rows_that_become_one,
    string_agg(COALESCE(variant, '(no variant)'), ', ' ORDER BY variant) AS variants
FROM grouped
WHERE keep_id IN (SELECT keep_id FROM grouped GROUP BY keep_id HAVING count(*) > 1)
GROUP BY make, model, year
ORDER BY make, model, year;


-- ── STEP 2: perform the merge ──────────────────────────────────────────────
-- One statement. Listings are moved before their car is deleted; foreign keys
-- are checked at the end of the statement, by which time they point at the
-- surviving row.

DO $$
DECLARE
    merged_rows int;
BEGIN
    CREATE TEMP TABLE car_merge AS
    WITH grouped AS (
        SELECT
            id,
            first_value(id) OVER (
                PARTITION BY lower(trim(make)), lower(trim(model)), year
                ORDER BY (variant IS NULL) DESC, created_at, id
            ) AS keep_id
        FROM cars
        WHERE make IS NOT NULL AND model IS NOT NULL AND year IS NOT NULL
    )
    SELECT id AS drop_id, keep_id FROM grouped WHERE id <> keep_id;

    SELECT count(*) INTO merged_rows FROM car_merge;

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

    DROP TABLE car_merge;

    RAISE NOTICE 'Merged away % duplicate catalogue row(s).', merged_rows;
END $$;


-- ── STEP 3: proof ──────────────────────────────────────────────────────────
-- Must return no rows: no (make, model, year) may hold more than one entry.

SELECT lower(trim(make)) AS make, lower(trim(model)) AS model, year, count(*)
FROM cars
GROUP BY 1, 2, 3
HAVING count(*) > 1;
