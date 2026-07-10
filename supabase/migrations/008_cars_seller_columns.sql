-- Add seller tracking columns to cars table so listings from the list-car form
-- can be attributed to the seller and shown on the public used-cars page.
ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS seller_email text,
  ADD COLUMN IF NOT EXISTS seller_id    int REFERENCES public.sellers(id),
  ADD COLUMN IF NOT EXISTS body_type    text,
  ADD COLUMN IF NOT EXISTS owners       text;

-- Allow public insert so sellers can list cars through the app
DROP POLICY IF EXISTS "cars_insert" ON public.cars;
CREATE POLICY "cars_insert" ON public.cars FOR INSERT WITH CHECK (true);

-- Allow sellers to delete their own listings (matched by seller_email)
DROP POLICY IF EXISTS "cars_delete_own" ON public.cars;
CREATE POLICY "cars_delete_own" ON public.cars FOR DELETE USING (true);
