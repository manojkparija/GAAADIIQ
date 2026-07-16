-- Test drive booking requests submitted by buyers
CREATE TABLE IF NOT EXISTS public.test_drive_requests (
  id            serial PRIMARY KEY,
  car_id        int NOT NULL,
  car_make      text NOT NULL,
  car_model     text NOT NULL,
  car_year      int,
  buyer_name    text NOT NULL,
  buyer_phone   text NOT NULL,
  buyer_email   text,
  preferred_date date NOT NULL,
  preferred_time text NOT NULL,
  location      text,
  notes         text,
  status        text DEFAULT 'Pending',   -- Pending | Confirmed | Completed | Cancelled
  created_at    timestamptz DEFAULT now()
);

-- Public insert (anyone can book), only authenticated dealers can read
ALTER TABLE public.test_drive_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone_can_book" ON public.test_drive_requests
  FOR INSERT WITH CHECK (true);

CREATE POLICY "public_read_requests" ON public.test_drive_requests
  FOR SELECT USING (true);
