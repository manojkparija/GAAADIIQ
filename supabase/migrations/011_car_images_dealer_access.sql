-- Photographs of one specific car, owned by the dealer selling it.
--
-- WHY THIS FILE EXISTS
--
-- `car_images` is written to by the List Your Car flow and has never been
-- declared in a migration — it was created by hand in the Supabase dashboard,
-- so its columns and its policies are whatever someone typed once. This states
-- it, idempotently, so the table a dealer is about to depend on is described
-- somewhere other than a browser session.
--
-- WHAT THIS IS NOT
--
-- Not `vehicle_media`. That is the shared catalogue, matched on make + model +
-- year, and an image in it appears on every car of that model across the site.
-- A dealer must not write there: their photograph would show on a competitor's
-- listing of the same model. These two stores look similar and are not
-- interchangeable, which is exactly why the dealer dashboard pointed at the
-- wrong one and sent dealers to the admin portal to use it.

CREATE TABLE IF NOT EXISTS public.car_images (
  id         serial PRIMARY KEY,
  car_id     int NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  url        text NOT NULL,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Deleting a listing must take its photographs with it. Stated separately
-- because the hand-made table may predate the reference.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'car_images_car_id_fkey'
  ) THEN
    ALTER TABLE public.car_images
      ADD CONSTRAINT car_images_car_id_fkey
      FOREIGN KEY (car_id) REFERENCES public.cars(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS car_images_car_id_idx
  ON public.car_images (car_id, sort_order);

ALTER TABLE public.car_images ENABLE ROW LEVEL SECURITY;

-- Postgres has no CREATE POLICY IF NOT EXISTS, and a half-applied file is
-- worse than one that does nothing.
DROP POLICY IF EXISTS "car_images_public_read"   ON public.car_images;
DROP POLICY IF EXISTS "car_images_seller_insert" ON public.car_images;
DROP POLICY IF EXISTS "car_images_seller_update" ON public.car_images;
DROP POLICY IF EXISTS "car_images_seller_delete" ON public.car_images;

-- Read is genuinely public: these are the photographs on a listing, and a
-- buyer who is not signed in still has to see the car.
CREATE POLICY "car_images_public_read" ON public.car_images
  FOR SELECT USING (true);

-- Writes belong to whoever is selling that car, and to admins.
--
-- Ownership is `cars.seller_email` against the JWT, matching how the rest of
-- this schema identifies a seller. It is not a strong link — an email is not
-- an identity — but it is the one the data actually has, and enforcing the
-- real rule badly is better than leaving writes open while a better key is
-- designed.
CREATE POLICY "car_images_seller_insert" ON public.car_images
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cars c
      WHERE c.id = car_images.car_id
        AND lower(c.seller_email) = lower(auth.jwt() ->> 'email')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE lower(p.email) = lower(auth.jwt() ->> 'email')
        AND p.role = 'admin'
    )
  );

CREATE POLICY "car_images_seller_update" ON public.car_images
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.cars c
      WHERE c.id = car_images.car_id
        AND lower(c.seller_email) = lower(auth.jwt() ->> 'email')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE lower(p.email) = lower(auth.jwt() ->> 'email')
        AND p.role = 'admin'
    )
  );

CREATE POLICY "car_images_seller_delete" ON public.car_images
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.cars c
      WHERE c.id = car_images.car_id
        AND lower(c.seller_email) = lower(auth.jwt() ->> 'email')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE lower(p.email) = lower(auth.jwt() ->> 'email')
        AND p.role = 'admin'
    )
  );
