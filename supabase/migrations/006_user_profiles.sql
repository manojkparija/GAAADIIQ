-- User profiles with roles
-- role: 'user' (default buyer) | 'seller' | 'admin'
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id          serial PRIMARY KEY,
  email       text NOT NULL UNIQUE,
  name        text,
  role        text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'seller', 'admin')),
  seller_id   int REFERENCES public.sellers(id),  -- set for role='seller'
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_public_read" ON public.user_profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert"      ON public.user_profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "profiles_update"      ON public.user_profiles FOR UPDATE USING (true);

-- Seed: admin and seller test accounts
INSERT INTO public.user_profiles (email, name, role, seller_id) VALUES
  ('admin@gaadiiq.in',       'GAADIIQ Admin',  'admin',  NULL),
  ('rajesh@rkmotors.in',     'Rajesh Kumar',   'seller', 1),
  ('priya@sharmaauto.in',    'Priya Sharma',   'seller', 2),
  ('suresh@naircars.in',     'Suresh Nair',    'seller', 3),
  ('anita@mehtacars.in',     'Anita Mehta',    'seller', 5),
  ('manoj@gaadiiq.in',       'Manoj Parija',   'seller', 8)
ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, seller_id = EXCLUDED.seller_id;
