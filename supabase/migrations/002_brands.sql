-- Brand logo table
-- logo_url: update any row in Supabase dashboard to swap in a real logo image URL
CREATE TABLE IF NOT EXISTS public.brands (
  id          serial PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  slug        text NOT NULL UNIQUE,
  logo_url    text,           -- URL or Supabase Storage path
  country     text,
  sort_order  int DEFAULT 0,  -- controls display order
  active      boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

-- Allow public read
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brands_public_read" ON public.brands FOR SELECT USING (true);

-- Seed data — replace logo_url values with real image URLs via the Supabase dashboard
INSERT INTO public.brands (name, slug, logo_url, country, sort_order) VALUES
  ('Tata',          'tata',          'assets/brand-logos/tata.svg',          'India',   1),
  ('Maruti Suzuki', 'maruti-suzuki',  'assets/brand-logos/maruti-suzuki.svg', 'India',   2),
  ('Mahindra',      'mahindra',       'assets/brand-logos/mahindra.svg',      'India',   3),
  ('Nissan',        'nissan',         'assets/brand-logos/nissan.svg',        'Japan',   4),
  ('Hyundai',       'hyundai',        'assets/brand-logos/hyundai.svg',       'Korea',   5),
  ('Toyota',        'toyota',         'assets/brand-logos/toyota.svg',        'Japan',   6),
  ('Kia',           'kia',            'assets/brand-logos/kia.svg',           'Korea',   7),
  ('BMW',           'bmw',            'assets/brand-logos/bmw.svg',           'Germany', 8),
  ('Skoda',         'skoda',          'assets/brand-logos/skoda.svg',         'Czech',   9),
  ('MG',            'mg',             'assets/brand-logos/mg.svg',            'UK',      10),
  ('Renault',       'renault',        'assets/brand-logos/renault.svg',       'France',  11),
  ('Volkswagen',    'volkswagen',     'assets/brand-logos/volkswagen.svg',    'Germany', 12),
  ('Mercedes-Benz', 'mercedes-benz',  'assets/brand-logos/mercedes-benz.svg', 'Germany', 13),
  ('Honda',         'honda',          'assets/brand-logos/honda.svg',         'Japan',   14),
  ('Land Rover',    'land-rover',     'assets/brand-logos/land-rover.svg',    'UK',      15),
  ('Citroen',       'citroen',        'assets/brand-logos/citroen.svg',       'France',  16),
  ('VinFast',       'vinfast',        'assets/brand-logos/vinfast.svg',       'Vietnam', 17),
  ('BYD',           'byd',            'assets/brand-logos/byd.svg',           'China',   18),
  ('Jeep',          'jeep',           'assets/brand-logos/jeep.svg',          'USA',     19),
  ('Audi',          'audi',           'assets/brand-logos/audi.svg',          'Germany', 20),
  ('Porsche',       'porsche',        'assets/brand-logos/porsche.svg',       'Germany', 21),
  ('Volvo',         'volvo',          'assets/brand-logos/volvo.svg',         'Sweden',  22),
  ('Lexus',         'lexus',          'assets/brand-logos/lexus.svg',         'Japan',   23),
  ('Mini',          'mini',           'assets/brand-logos/mini.svg',          'UK',      24),
  ('Force Motors',  'force-motors',   'assets/brand-logos/force-motors.svg',  'India',   25),
  ('Lamborghini',   'lamborghini',    'assets/brand-logos/lamborghini.svg',   'Italy',   26),
  ('Jaguar',        'jaguar',         'assets/brand-logos/jaguar.svg',        'UK',      27),
  ('Rolls-Royce',   'rolls-royce',    'assets/brand-logos/rolls-royce.svg',   'UK',      28),
  ('Ferrari',       'ferrari',        'assets/brand-logos/ferrari.svg',       'Italy',   29),
  ('Tesla',         'tesla',          'assets/brand-logos/tesla.svg',         'USA',     30),
  ('Isuzu',         'isuzu',          'assets/brand-logos/isuzu.svg',         'Japan',   31),
  ('Maserati',      'maserati',       'assets/brand-logos/maserati.svg',      'Italy',   32),
  ('Aston Martin',  'aston-martin',   'assets/brand-logos/aston-martin.svg',  'UK',      33),
  ('McLaren',       'mclaren',        'assets/brand-logos/mclaren.svg',       'UK',      34),
  ('Bentley',       'bentley',        'assets/brand-logos/bentley.svg',       'UK',      35),
  ('Lotus',         'lotus',          'assets/brand-logos/lotus.svg',         'UK',      36),
  ('OLA Electric',  'ola-electric',   'assets/brand-logos/ola-electric.svg',  'India',   37),
  ('Genesis',       'genesis',        'assets/brand-logos/genesis.svg',       'Korea',   38)
ON CONFLICT (slug) DO UPDATE SET
  logo_url   = EXCLUDED.logo_url,
  country    = EXCLUDED.country,
  sort_order = EXCLUDED.sort_order;
