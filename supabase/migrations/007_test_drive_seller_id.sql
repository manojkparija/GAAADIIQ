-- Add seller_id to test_drive_requests so each booking is linked to a seller
ALTER TABLE public.test_drive_requests
  ADD COLUMN IF NOT EXISTS seller_id int REFERENCES public.sellers(id);
