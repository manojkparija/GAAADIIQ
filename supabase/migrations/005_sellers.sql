-- Sellers / dealers table
CREATE TABLE IF NOT EXISTS public.sellers (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  business_name text,
  phone         text NOT NULL,
  email         text,
  city          text,
  address       text,
  verified      boolean DEFAULT false,
  rating        numeric(2,1) DEFAULT 4.5,
  total_reviews int DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.sellers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sellers_public_read" ON public.sellers FOR SELECT USING (true);

-- Dummy sellers for testing
INSERT INTO public.sellers (name, business_name, phone, email, city, address, verified, rating, total_reviews) VALUES
  ('Rajesh Kumar',   'RK Motors',          '+91 98765 43210', 'rajesh@rkmotors.in',      'Mumbai',    'Shop 12, Andheri West, Mumbai',       true,  4.8, 312),
  ('Priya Sharma',   'Sharma Auto Gallery', '+91 87654 32109', 'priya@sharmaauto.in',     'Delhi',     '45 Lajpat Nagar, New Delhi',         true,  4.6, 198),
  ('Suresh Nair',    'Nair Car Bazaar',     '+91 76543 21098', 'suresh@naircars.in',      'Bangalore', '78 Koramangala, Bangalore',          true,  4.7, 245),
  ('Deepak Rao',     'Rao Automobiles',     '+91 95432 10987', 'deepak@raoauto.in',       'Hyderabad', '23 Banjara Hills, Hyderabad',        false, 4.3, 89),
  ('Anita Mehta',    'Mehta Premium Cars',  '+91 94321 09876', 'anita@mehtacars.in',      'Pune',      '56 Koregaon Park, Pune',             true,  4.9, 421),
  ('Vikram Singh',   'Singh Motors',        '+91 93210 98765', 'vikram@singhmotors.in',   'Chennai',   '34 Anna Nagar, Chennai',             true,  4.5, 167),
  ('Kavita Reddy',   'Reddy Auto World',    '+91 92109 87654', 'kavita@reddyauto.in',     'Kolkata',   '89 Park Street, Kolkata',            true,  4.4, 203),
  ('Manoj Parija',   'GAADIIQ Direct',      '+91 99034 11202', 'manoj@gaadiiq.in',        'Rourkela',  '12 Civil Township, Rourkela',        true,  5.0, 54)
ON CONFLICT DO NOTHING;

-- Link cars to sellers (car_id → seller_id mapping)
-- In a real app this would be a FK on the cars table; here we use a mapping table
CREATE TABLE IF NOT EXISTS public.car_seller_map (
  car_id    int PRIMARY KEY,
  seller_id int REFERENCES public.sellers(id)
);

ALTER TABLE public.car_seller_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "car_seller_map_public_read" ON public.car_seller_map FOR SELECT USING (true);
