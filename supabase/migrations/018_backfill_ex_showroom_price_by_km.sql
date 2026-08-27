-- Finish what 017 started, on a signal that means what it says.
--
-- 017 backfilled ex_showroom_price only where badge_type = 'new'. Run against
-- production, it filled the two `e Vitara 2026` rows and skipped these:
--
--   model         year  badge_type    price     ex_showroom_price
--   Grand Vitara  2025  success       2249000   NULL
--   Grand Vitara  2024  badge-green   1799000   NULL
--
-- WHY 017's FILTER WAS WRONG
--
-- badge_type is not a type. It holds a *display style*:
--
--   scripts/seed-cars.sql          writes 'primary' for new stock
--   my-listings.component.ts:76    writes 'badge-green' / 'badge-gold' /
--                                  'badge-purple' from listing STATUS
--   list-car.component.ts          writes 'new' / 'used'
--
-- Only the third of those makes badge_type mean what 017 assumed. Every
-- catalogue row that predates the listing form carries a CSS class instead,
-- so 017 skipped precisely the rows that have been invisible on New Cars
-- longest. That was my error: I read one writer and generalised from it.
--
-- THE SIGNAL USED HERE
--
-- km. A car with no distance on it is new stock; that is what the column
-- means, and every writer agrees on it:
--
--   seed-cars.sql   '-- NEW CARS (2025, 0 km)', literal 0
--   list-car        km: this.isNew() ? 0 : +this.form.km
--   catalogue rows  never set it, so NULL
--
-- so coalesce(km, 0) = 0 selects new and catalogue rows and excludes used
-- adverts, without depending on a column that means three things.
--
-- Used adverts stay NULL, for the reason 017 gave and which still holds: on
-- a used advert `price` is one seller's asking figure for one car, and
-- recording it as ex_showroom_price would state it as the manufacturer's
-- published price for the model — which the discrepancy warnings then trust.
--
-- Idempotent: rows it fills stop matching. NULL, never 0, where there is no
-- usable price — 0 reads as "free" downstream, NULL reads as unpriced.

UPDATE public.cars
   SET ex_showroom_price = price
 WHERE ex_showroom_price IS NULL
   AND price IS NOT NULL
   AND price > 0
   AND coalesce(km, 0) = 0;

-- What is still invisible on New Cars, and why. cars-data.service.ts:519
-- drops any catalogue row with a NULL ex_showroom_price before it filters on
-- anything else, so these rows cannot be found by fuel, body type or search.
DO $$
DECLARE
  unpriced integer;
  used_rows integer;
BEGIN
  SELECT count(*) INTO unpriced
    FROM public.cars
   WHERE ex_showroom_price IS NULL AND coalesce(km, 0) = 0;

  SELECT count(*) INTO used_rows
    FROM public.cars
   WHERE ex_showroom_price IS NULL AND coalesce(km, 0) > 0;

  IF unpriced > 0 THEN
    RAISE NOTICE
      '% new/catalogue row(s) still have no ex_showroom_price and stay '
      'invisible on New Cars — they have no usable price to copy.', unpriced;
  END IF;

  RAISE NOTICE
    '% used advert(s) deliberately left NULL: an asking price is not a '
    'manufacturer price.', used_rows;
END $$;

NOTIFY pgrst, 'reload schema';
