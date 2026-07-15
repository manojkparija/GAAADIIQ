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

-- Anyone can submit an enquiry; no public read via anon key
DROP POLICY IF EXISTS "enquiries_insert" ON public.car_enquiries;
CREATE POLICY "enquiries_insert" ON public.car_enquiries FOR INSERT WITH CHECK (true);
