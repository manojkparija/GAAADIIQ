-- New cars listed through the form never appeared on New Cars.
--
-- Reported: an e Vitara stayed missing from Electric even after its
-- photographs were approved and 016 filled in its fuel_type.
--
-- fuel_type was a real bug and a real fix, but it was not this one.
-- cars-data.service.ts:519 builds the New Cars list like so:
--
--   .filter(c => c.ex_showroom_price != null && c.year >= NEW_CAR_MIN_YEAR)
--
-- A catalogue row with a NULL ex_showroom_price is dropped *before* fuel or
-- body type is considered. The car was never in the list to be filtered by
-- fuel, so no amount of correcting fuel_type could have revealed it.
--
-- The list-car form wrote the figure to `price` only, by a deliberate earlier
-- decision taken when this column's existence could not be confirmed from the
-- repository. It exists.
--
-- WHY ONLY badge_type = 'new'
--
-- ex_showroom_price is the manufacturer's published price for a model. For a
-- used advert, `price` is one seller's asking price for one car — copying it
-- here would state a second-hand asking price as the manufacturer's, and the
-- discrepancy warnings and valuation reads that trust this column would then
-- be comparing against a number nobody published. Used rows are left NULL,
-- which is the honest value: nobody has entered one.
--
-- Idempotent: rows it fills stop matching. Rows with no usable price stay
-- NULL rather than being given a zero, because 0 reads as "free" everywhere
-- downstream and NULL reads as "unpriced" — the distinction the Car model's
-- own comment insists on.

-- Declared before use. Production has it, but listing-columns.spec.ts holds
-- every column the insert names to "a migration adds it", not "someone saw it
-- in a query once" — the standard that would have caught 014's wrong fix.
ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS ex_showroom_price numeric(12,2);

UPDATE public.cars
   SET ex_showroom_price = price
 WHERE ex_showroom_price IS NULL
   AND badge_type = 'new'
   AND price IS NOT NULL
   AND price > 0;

-- New-stock rows this could not price, for a human to look at. Silence here
-- would look exactly like success, and they stay invisible on New Cars.
DO $$
DECLARE
  unpriced integer;
BEGIN
  SELECT count(*) INTO unpriced
    FROM public.cars
   WHERE ex_showroom_price IS NULL AND badge_type = 'new';

  IF unpriced > 0 THEN
    RAISE NOTICE
      '% new-stock row(s) still have no ex_showroom_price and will not '
      'appear on New Cars; they have no usable price to copy.', unpriced;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
