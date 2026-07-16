-- Car Enquiries: buyer → seller contact requests via the listing detail page
CREATE TABLE IF NOT EXISTS public.car_enquiries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id       int  NOT NULL,
  buyer_name   text NOT NULL,
  buyer_phone  text NOT NULL,
  buyer_email  text,
  notes        text,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_car_enquiries_car_id ON public.car_enquiries(car_id);

ALTER TABLE public.car_enquiries ENABLE ROW LEVEL SECURITY;

-- Anyone can submit an enquiry
DROP POLICY IF EXISTS "enquiries_insert" ON public.car_enquiries;
CREATE POLICY "enquiries_insert" ON public.car_enquiries FOR INSERT WITH CHECK (true);

-- Sellers can read enquiries for their own listings (via car_listings.seller_id)
DROP POLICY IF EXISTS "enquiries_seller_select" ON public.car_enquiries;
CREATE POLICY "enquiries_seller_select" ON public.car_enquiries
  FOR SELECT USING (
    car_id IN (
      SELECT id FROM public.car_listings
      WHERE seller_id = (
        SELECT id FROM public.sellers
        WHERE email = auth.jwt() ->> 'email'
        LIMIT 1
      )
    )
  );
