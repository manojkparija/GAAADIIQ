-- GAADIIQ Car Seed — paste into Supabase SQL Editor
-- https://supabase.com/dashboard/project/gnhixykdvnuoxeccntjo/sql

-- Fix: ensure id column has an auto-increment default
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'cars_id_seq') THEN
    CREATE SEQUENCE cars_id_seq;
  END IF;
END $$;
ALTER TABLE cars ALTER COLUMN id SET DEFAULT nextval('cars_id_seq');
SELECT setval('cars_id_seq', COALESCE((SELECT MAX(id) FROM cars), 0) + 1, false);

-- Optional: clear existing cars first (uncomment if needed)
-- TRUNCATE cars CASCADE;

-- ── INSERT ALL CARS ──────────────────────────────────────────────────────────

INSERT INTO cars (make, model, variant, year, price, km, fuel, transmission, badge, badge_type, rating, reviews, city, body_type, color, owners, verified, image) VALUES

-- ── NEW CARS (2025, 0 km) ────────────────────────────────────────────────────

-- Maruti Suzuki
('Maruti Suzuki','Swift','ZXi+ AMT',2025,899000,0,'Petrol','AMT','Best Seller','primary',4.7,312,'Mumbai','Hatchback','Sizzling Red',NULL,true,''),
('Maruti Suzuki','Swift','VXi',2025,699000,0,'Petrol','Manual','Brand New','success',4.6,198,'Pune','Hatchback','Luster Blue',NULL,true,''),
('Maruti Suzuki','Swift','S-CNG ZXi',2025,849000,0,'CNG','Manual','Brand New','success',4.5,87,'Delhi','Hatchback','Magma Grey',NULL,true,''),
('Maruti Suzuki','Baleno','Alpha CVT',2025,995000,0,'Petrol','CVT','Brand New','success',4.6,154,'Bangalore','Hatchback','Midnight Black',NULL,true,''),
('Maruti Suzuki','Baleno','Delta MT',2025,699000,0,'Petrol','Manual','Brand New','success',4.5,89,'Chennai','Hatchback','Splendid Silver',NULL,true,''),
('Maruti Suzuki','Brezza','ZXi+ AT',2025,1399000,0,'Petrol','Automatic','Brand New','success',4.6,201,'Hyderabad','SUV','Brave Khaki',NULL,true,''),
('Maruti Suzuki','Brezza','VXi CNG',2025,1099000,0,'CNG','Manual','Brand New','success',4.4,76,'Mumbai','SUV','Pearl White',NULL,true,''),
('Maruti Suzuki','Ertiga','ZXi+ AT',2025,1399000,0,'Petrol','Automatic','Brand New','success',4.5,143,'Kolkata','MUV','Auburn Silver',NULL,true,''),
('Maruti Suzuki','Grand Vitara','Alpha+ AWD',2025,2249000,0,'Hybrid','Automatic','Brand New','success',4.7,178,'Delhi','SUV','Grandeur Grey',NULL,true,''),
('Maruti Suzuki','Ciaz','Alpha AT',2025,1199000,0,'Petrol','Automatic','Brand New','success',4.4,98,'Jaipur','Sedan','Pearl White',NULL,true,''),
('Maruti Suzuki','Fronx','Alpha 1.0T AT',2025,1149000,0,'Petrol','Automatic','Brand New','success',4.6,167,'Bangalore','SUV','Nexa Blue',NULL,true,''),
('Maruti Suzuki','Jimny','Alpha 4WD MT',2025,1499000,0,'Petrol','Manual','Brand New','success',4.8,132,'Jaipur','SUV','Sizzling Red',NULL,true,''),

-- Hyundai
('Hyundai','i20','Asta(O) 1.0T DCT',2025,1099000,0,'Petrol','DCT','Brand New','success',4.6,221,'Chennai','Hatchback','Atlas White',NULL,true,''),
('Hyundai','Creta','SX(O) 1.5T DCT',2025,1999000,0,'Petrol','DCT','Top Rated','warning',4.8,387,'Mumbai','SUV','Abyss Black',NULL,true,''),
('Hyundai','Creta','S 1.5 MT Diesel',2025,1499000,0,'Diesel','Manual','Brand New','success',4.6,156,'Hyderabad','SUV','Titan Grey',NULL,true,''),
('Hyundai','Creta Electric','Excellence LR',2025,2399000,0,'Electric','Automatic','EV Deal','primary',4.8,203,'Bangalore','SUV','Starry Night',NULL,true,''),
('Hyundai','Venue','SX+ 1.0T DCT',2025,1349000,0,'Petrol','DCT','Brand New','success',4.5,167,'Delhi','SUV','Fiery Red',NULL,true,''),
('Hyundai','Verna','SX(O) 1.5T CVT',2025,1799000,0,'Petrol','CVT','Brand New','success',4.7,143,'Pune','Sedan','Tellurian Brown',NULL,true,''),
('Hyundai','Alcazar','Platinum 6-str AT',2025,2199000,0,'Petrol','Automatic','Brand New','success',4.6,112,'Kolkata','SUV','Typhoon Silver',NULL,true,''),
('Hyundai','Tucson','Signature AT 4WD',2025,3699000,0,'Petrol','Automatic','Premium','primary',4.7,89,'Mumbai','SUV','Titan Grey',NULL,true,''),
('Hyundai','Exter','SX(O) AMT',2025,949000,0,'Petrol','AMT','Brand New','success',4.5,143,'Chennai','SUV','Atlas White',NULL,true,''),

-- Tata
('Tata','Punch','Adventure AMT',2025,899000,0,'Petrol','AMT','Brand New','success',4.5,198,'Nagpur','SUV','Daytona Grey',NULL,true,''),
('Tata','Punch','Empowered+ iCNG',2025,999000,0,'CNG','Manual','Brand New','success',4.4,87,'Ahmedabad','SUV','Tornado Blue',NULL,true,''),
('Tata','Nexon','Creative Plus AMT',2025,1599000,0,'Petrol','AMT','Brand New','success',4.6,231,'Mumbai','SUV','Pristine White',NULL,true,''),
('Tata','Nexon EV','Max LR 40.5 kWh',2025,1999000,0,'Electric','Automatic','EV Deal','primary',4.7,176,'Delhi','SUV','Midnight Plum',NULL,true,''),
('Tata','Harrier','Adventure Plus AT',2025,2199000,0,'Diesel','Automatic','Brand New','success',4.7,154,'Bangalore','SUV','Orcus White',NULL,true,''),
('Tata','Safari','Gold 6-str AT',2025,2699000,0,'Diesel','Automatic','Brand New','success',4.7,143,'Pune','SUV','Tropical Mist',NULL,true,''),
('Tata','Curvv','Creative Plus 1.2T',2025,1599000,0,'Petrol','DCT','Brand New','success',4.6,98,'Chennai','SUV','Pristine White',NULL,true,''),
('Tata','Curvv EV','Long Range',2025,2199000,0,'Electric','Automatic','EV Deal','primary',4.7,67,'Hyderabad','SUV','Flame Orange',NULL,true,''),

-- Kia
('Kia','Seltos','HTX Plus 1.5T DCT',2025,1899000,0,'Petrol','DCT','Brand New','success',4.7,267,'Delhi','SUV','Pewter Olive',NULL,true,''),
('Kia','Seltos','X-Line 1.5 AT Diesel',2025,2099000,0,'Diesel','Automatic','Brand New','success',4.6,189,'Mumbai','SUV','Aurora Black',NULL,true,''),
('Kia','Sonet','HTX Plus 1.0T DCT',2025,1399000,0,'Petrol','DCT','Brand New','success',4.5,154,'Bangalore','SUV','Imperial Blue',NULL,true,''),
('Kia','Carens','Prestige+ 1.5T AT',2025,1899000,0,'Petrol','Automatic','Brand New','success',4.6,123,'Chennai','MUV','Gravity Grey',NULL,true,''),
('Kia','EV6','GT-Line AWD',2025,6099000,0,'Electric','Automatic','Premium EV','primary',4.9,76,'Delhi','SUV','Snow White Pearl',NULL,true,''),

-- Toyota
('Toyota','Innova Hycross','ZX(O) Hybrid AT',2025,2999000,0,'Hybrid','Automatic','Brand New','success',4.8,198,'Hyderabad','MUV','Super White II',NULL,true,''),
('Toyota','Urban Cruiser Hyryder','V Hybrid',2025,2099000,0,'Hybrid','Automatic','Brand New','success',4.7,143,'Bangalore','SUV','Midnight Black',NULL,true,''),
('Toyota','Fortuner','Legender 4x4 AT',2025,4699000,0,'Diesel','Automatic','Premium','primary',4.9,267,'Delhi','SUV','Sparkling Black',NULL,true,''),
('Toyota','Camry','Hybrid AT',2025,4699000,0,'Hybrid','Automatic','Premium','primary',4.8,89,'Mumbai','Sedan','Emotional Red',NULL,true,''),
('Toyota','Glanza','V MT',2025,799000,0,'Petrol','Manual','Brand New','success',4.5,98,'Pune','Hatchback','Sporty Blue',NULL,true,''),

-- Honda
('Honda','City','ZX CVT',2025,1699000,0,'Petrol','CVT','Brand New','success',4.6,176,'Mumbai','Sedan','Lunar Silver',NULL,true,''),
('Honda','City','e:HEV',2025,2099000,0,'Hybrid','Automatic','Brand New','success',4.7,112,'Bangalore','Sedan','Radiant Red',NULL,true,''),
('Honda','Elevate','ZX CVT',2025,1899000,0,'Petrol','CVT','Brand New','success',4.6,143,'Delhi','SUV','Ignite Red',NULL,true,''),
('Honda','Amaze','VX CVT',2025,999000,0,'Petrol','CVT','Brand New','success',4.4,89,'Chennai','Sedan','Meteoroid Grey',NULL,true,''),

-- Mahindra
('Mahindra','Thar Roxx','MX5 4WD AT',2025,1699000,0,'Diesel','Automatic','Top Rated','warning',4.8,234,'Jaipur','SUV','Everest White',NULL,true,''),
('Mahindra','XUV 3XO','AX7 Turbo AT',2025,1599000,0,'Petrol','Automatic','Brand New','success',4.6,167,'Mumbai','SUV','Midnight Black',NULL,true,''),
('Mahindra','XUV700','AX7 L 4WD AT',2025,2999000,0,'Diesel','Automatic','Top Rated','warning',4.8,312,'Delhi','SUV','Dazzling Silver',NULL,true,''),
('Mahindra','Scorpio N','Z8 L MT',2025,1999000,0,'Diesel','Manual','Brand New','success',4.7,198,'Nagpur','SUV','Everest White',NULL,true,''),
('Mahindra','BE 6','Pack Three',2025,2699000,0,'Electric','Automatic','EV Deal','primary',4.8,134,'Bangalore','SUV','Copper',NULL,true,''),
('Mahindra','XEV 9e','Pack Three',2025,3699000,0,'Electric','Automatic','Premium EV','primary',4.8,89,'Mumbai','SUV','Stealth Black',NULL,true,''),

-- MG
('MG','Hector','Savvy Pro Turbo AT',2025,2199000,0,'Petrol','Automatic','Brand New','success',4.5,154,'Ahmedabad','SUV','Starry Black',NULL,true,''),
('MG','ZS EV','Excite Pro',2025,2299000,0,'Electric','Automatic','EV Deal','primary',4.6,123,'Bangalore','SUV','Aurora Silver',NULL,true,''),
('MG','Windsor EV','Excite',2025,1399000,0,'Electric','Automatic','EV Deal','primary',4.7,198,'Delhi','SUV','Starburst White',NULL,true,''),
('MG','Comet EV','Pace',2025,699000,0,'Electric','Automatic','EV Deal','primary',4.3,67,'Mumbai','Hatchback','Candy White',NULL,true,''),

-- Renault / Nissan
('Renault','Kiger','RXZ Turbo MT',2025,999000,0,'Petrol','Manual','Brand New','success',4.4,112,'Chennai','SUV','Moonlight Silver',NULL,true,''),
('Renault','Triber','RXZ AMT',2025,899000,0,'Petrol','AMT','Brand New','success',4.4,87,'Kolkata','MUV','Ice Cool White',NULL,true,''),
('Nissan','Magnite','Turbo CVT XV Premium',2025,1099000,0,'Petrol','CVT','Brand New','success',4.4,98,'Pune','SUV','Blade Silver',NULL,true,''),

-- Skoda / Volkswagen
('Skoda','Slavia','Style 1.5T DSG',2025,1999000,0,'Petrol','DCT','Premium','primary',4.7,134,'Mumbai','Sedan','Carbon Steel',NULL,true,''),
('Skoda','Kushaq','Monte Carlo 1.5T DSG',2025,2099000,0,'Petrol','DCT','Premium','primary',4.7,112,'Delhi','SUV','Candy White',NULL,true,''),
('Skoda','Kodiaq','Laurin & Klement',2025,4699000,0,'Petrol','DCT','Premium','primary',4.8,67,'Bangalore','SUV','Quartz Grey',NULL,true,''),
('Volkswagen','Taigun','GT Plus 1.5T DSG',2025,2099000,0,'Petrol','DCT','Premium','primary',4.7,123,'Chennai','SUV','Reflex Silver',NULL,true,''),
('Volkswagen','Virtus','GT Plus 1.5T DSG',2025,1999000,0,'Petrol','DCT','Premium','primary',4.7,112,'Mumbai','Sedan','Limestone Grey',NULL,true,''),

-- Jeep
('Jeep','Compass','Model S Plus AT 4x4',2025,3299000,0,'Diesel','Automatic','Premium','primary',4.7,89,'Delhi','SUV','Techno Green',NULL,true,''),
('Jeep','Meridian','Limited Plus AT 4x4',2025,3799000,0,'Diesel','Automatic','Premium','primary',4.7,67,'Mumbai','SUV','Granite Crystal',NULL,true,''),

-- ── USED CARS ────────────────────────────────────────────────────────────────

('Maruti Suzuki','Swift','ZXi AMT',2022,649000,28000,'Petrol','AMT','Certified','success',4.5,45,'Mumbai','Hatchback','Sizzling Red','1st Owner',true,''),
('Maruti Suzuki','Swift','VXi',2021,529000,45000,'Petrol','Manual','Certified','success',4.4,32,'Delhi','Hatchback','Pearl White','1st Owner',true,''),
('Maruti Suzuki','Baleno','Alpha CVT',2022,749000,32000,'Petrol','CVT','Certified','success',4.5,38,'Pune','Hatchback','Midnight Black','1st Owner',true,''),
('Maruti Suzuki','Brezza','ZXi+',2023,999000,18000,'Petrol','Automatic','Certified','success',4.6,29,'Bangalore','SUV','Brave Khaki','1st Owner',true,''),
('Maruti Suzuki','Ertiga','VXi CNG',2021,749000,55000,'CNG','Manual','Verified','info',4.3,21,'Ahmedabad','MUV','Auburn Silver','2nd Owner',true,''),
('Maruti Suzuki','Fronx','Alpha 1.0T AT',2024,1049000,12000,'Petrol','Automatic','Certified','success',4.6,198,'Bangalore','SUV','Nexa Blue','1st Owner',true,''),
('Maruti Suzuki','Jimny','Zeta 4WD MT',2024,1299000,8000,'Petrol','Manual','Certified','success',4.9,143,'Jaipur','SUV','Sizzling Red','1st Owner',true,''),

('Hyundai','i20','Asta 1.2 MT',2022,749000,38000,'Petrol','Manual','Certified','success',4.4,34,'Chennai','Hatchback','Fiery Red','1st Owner',true,''),
('Hyundai','Creta','SX 1.5 MT Diesel',2022,1299000,42000,'Diesel','Manual','Certified','success',4.6,56,'Delhi','SUV','Titan Grey','1st Owner',true,''),
('Hyundai','Creta','E 1.5 MT Petrol',2021,1049000,61000,'Petrol','Manual','Verified','info',4.4,43,'Hyderabad','SUV','Polar White','2nd Owner',true,''),
('Hyundai','Venue','SX+ DCT',2023,1049000,22000,'Petrol','DCT','Certified','success',4.5,28,'Mumbai','SUV','Fiery Red','1st Owner',true,''),
('Hyundai','Verna','SX(O) CVT',2023,1349000,19000,'Petrol','CVT','Certified','success',4.6,31,'Pune','Sedan','Tellurian Brown','1st Owner',true,''),
('Hyundai','Exter','SX(O) AMT',2024,849000,9500,'Petrol','AMT','Certified','success',4.5,156,'Chennai','SUV','Atlas White','1st Owner',true,''),

('Tata','Nexon','XZ+ AMT',2022,1099000,35000,'Petrol','AMT','Certified','success',4.5,47,'Kolkata','SUV','Calgary White','1st Owner',true,''),
('Tata','Harrier','XZ Plus AT',2021,1499000,48000,'Diesel','Automatic','Certified','success',4.6,38,'Mumbai','SUV','Orcus White','1st Owner',true,''),
('Tata','Safari','XZA Plus 6-str',2022,1899000,31000,'Diesel','Automatic','Certified','success',4.6,29,'Delhi','SUV','Tropical Mist','1st Owner',true,''),
('Tata','Punch','Accomplished AMT',2023,749000,17000,'Petrol','AMT','Certified','success',4.4,23,'Nagpur','SUV','Daytona Grey','1st Owner',true,''),

('Kia','Seltos','HTX 1.5T DCT',2022,1399000,39000,'Petrol','DCT','Certified','success',4.6,52,'Bangalore','SUV','Aurora Black','1st Owner',true,''),
('Kia','Sonet','HTX Plus DCT',2022,1049000,33000,'Petrol','DCT','Certified','success',4.4,37,'Chennai','SUV','Imperial Blue','1st Owner',true,''),
('Kia','Carens','Luxury Plus 6-str AT',2023,1599000,21000,'Diesel','Automatic','Certified','success',4.5,26,'Delhi','MUV','Gravity Grey','1st Owner',true,''),

('Mahindra','Scorpio N','Z8 L AT',2022,1699000,41000,'Diesel','Automatic','Certified','success',4.7,61,'Jaipur','SUV','Galaxy Grey','1st Owner',true,''),
('Mahindra','XUV700','AX7 L AT',2022,2299000,36000,'Diesel','Automatic','Certified','success',4.7,54,'Hyderabad','SUV','Dazzling Silver','1st Owner',true,''),
('Mahindra','Thar','LX AT 4WD Hard Top',2021,1299000,52000,'Diesel','Automatic','Verified','info',4.6,47,'Pune','SUV','Rocky Beige','1st Owner',true,''),

('Toyota','Innova Crysta','ZX AT',2020,1699000,68000,'Diesel','Automatic','Verified','info',4.7,76,'Mumbai','MUV','Super White II','1st Owner',true,''),
('Toyota','Fortuner','4x2 AT Diesel',2021,3299000,44000,'Diesel','Automatic','Certified','success',4.8,89,'Delhi','SUV','Sparkling Black','1st Owner',true,''),

('Honda','City','ZX CVT',2022,1099000,37000,'Petrol','CVT','Certified','success',4.5,41,'Bangalore','Sedan','Lunar Silver','1st Owner',true,''),
('Honda','Amaze','VX CVT',2021,699000,49000,'Petrol','CVT','Certified','success',4.3,28,'Chennai','Sedan','Meteoroid Grey','1st Owner',true,''),

('MG','Hector','Sharp Turbo AT',2021,1499000,53000,'Petrol','Automatic','Verified','info',4.4,36,'Ahmedabad','SUV','Starry Black','2nd Owner',true,''),
('Renault','Kiger','RXZ Turbo MT',2022,749000,34000,'Petrol','Manual','Certified','success',4.3,24,'Kolkata','SUV','Moonlight Silver','1st Owner',true,'');


-- ── SPECS (run after cars are inserted) ──────────────────────────────────────

INSERT INTO car_specs (car_id, label, value)
SELECT c.id, s.label, s.value
FROM cars c
CROSS JOIN (VALUES
  ('Engine','1.2L Z12E NA'),('Power','82 bhp'),('Torque','112 Nm'),('Mileage','25.75 km/l'),('Seating','5'),('Boot','268 L')
) AS s(label, value)
WHERE c.make='Maruti Suzuki' AND c.model='Swift'
  AND NOT EXISTS (SELECT 1 FROM car_specs WHERE car_id=c.id);

INSERT INTO car_specs (car_id, label, value)
SELECT c.id, s.label, s.value
FROM cars c
CROSS JOIN (VALUES
  ('Engine','1.5L Turbo GDi'),('Power','160 bhp'),('Torque','253 Nm'),('Mileage','17 km/l'),('Seating','5'),('Boot','433 L')
) AS s(label, value)
WHERE c.make='Hyundai' AND c.model='Creta'
  AND NOT EXISTS (SELECT 1 FROM car_specs WHERE car_id=c.id);

INSERT INTO car_specs (car_id, label, value)
SELECT c.id, s.label, s.value
FROM cars c
CROSS JOIN (VALUES
  ('Battery','51.4 kWh'),('Range','473 km'),('Power','171 bhp'),('0-100','7.9 s'),('Seating','5'),('Boot','433 L')
) AS s(label, value)
WHERE c.make='Hyundai' AND c.model='Creta Electric'
  AND NOT EXISTS (SELECT 1 FROM car_specs WHERE car_id=c.id);

INSERT INTO car_specs (car_id, label, value)
SELECT c.id, s.label, s.value
FROM cars c
CROSS JOIN (VALUES
  ('Battery','40.5 kWh'),('Range','465 km'),('Power','143 bhp'),('0-100','8.9 s'),('Seating','5'),('Boot','350 L')
) AS s(label, value)
WHERE c.make='Tata' AND c.model='Nexon EV'
  AND NOT EXISTS (SELECT 1 FROM car_specs WHERE car_id=c.id);

INSERT INTO car_specs (car_id, label, value)
SELECT c.id, s.label, s.value
FROM cars c
CROSS JOIN (VALUES
  ('Engine','2.0L Kryotec Diesel'),('Power','170 bhp'),('Torque','350 Nm'),('Mileage','16.35 km/l'),('Seating','5'),('Boot','425 L')
) AS s(label, value)
WHERE c.make='Tata' AND c.model='Harrier'
  AND NOT EXISTS (SELECT 1 FROM car_specs WHERE car_id=c.id);

INSERT INTO car_specs (car_id, label, value)
SELECT c.id, s.label, s.value
FROM cars c
CROSS JOIN (VALUES
  ('Engine','2.2L mHawk Diesel'),('Power','185 bhp'),('Torque','450 Nm'),('Mileage','16.04 km/l'),('Seating','7'),('Boot','194 L')
) AS s(label, value)
WHERE c.make='Mahindra' AND c.model='XUV700'
  AND NOT EXISTS (SELECT 1 FROM car_specs WHERE car_id=c.id);

INSERT INTO car_specs (car_id, label, value)
SELECT c.id, s.label, s.value
FROM cars c
CROSS JOIN (VALUES
  ('Engine','1.5L Turbo GDi'),('Power','160 bhp'),('Torque','253 Nm'),('Mileage','16.5 km/l'),('Seating','5'),('Boot','433 L')
) AS s(label, value)
WHERE c.make='Kia' AND c.model='Seltos'
  AND NOT EXISTS (SELECT 1 FROM car_specs WHERE car_id=c.id);

INSERT INTO car_specs (car_id, label, value)
SELECT c.id, s.label, s.value
FROM cars c
CROSS JOIN (VALUES
  ('Engine','2.8L GD Diesel'),('Power','204 bhp'),('Torque','500 Nm'),('Mileage','10 km/l'),('Seating','7'),('Boot','220 L')
) AS s(label, value)
WHERE c.make='Toyota' AND c.model='Fortuner'
  AND NOT EXISTS (SELECT 1 FROM car_specs WHERE car_id=c.id);


-- ── FEATURES ─────────────────────────────────────────────────────────────────

INSERT INTO car_features (car_id, feature)
SELECT c.id, f.feature
FROM cars c
CROSS JOIN (VALUES
  ('6 Airbags'),('Suzuki Connect'),('HUD'),('Wireless Charging'),('Push Start/Stop'),('Rear Parking Camera'),('LED DRLs'),('Cruise Control')
) AS f(feature)
WHERE c.make='Maruti Suzuki' AND c.model='Swift'
  AND NOT EXISTS (SELECT 1 FROM car_features WHERE car_id=c.id);

INSERT INTO car_features (car_id, feature)
SELECT c.id, f.feature
FROM cars c
CROSS JOIN (VALUES
  ('Bose Sound System'),('Ventilated Seats'),('Panoramic Sunroof'),('ADAS Level 2'),('Wireless Charging'),('360° Camera'),('Ambient Lighting'),('Blind Spot Monitor')
) AS f(feature)
WHERE c.make='Hyundai' AND c.model='Creta'
  AND NOT EXISTS (SELECT 1 FROM car_features WHERE car_id=c.id);

INSERT INTO car_features (car_id, feature)
SELECT c.id, f.feature
FROM cars c
CROSS JOIN (VALUES
  ('JBL Sound System'),('Panoramic Sunroof'),('Ventilated Seats'),('360° Camera'),('ADAS'),('Wireless Charging'),('Ambient Lighting'),('iRA Connected Car')
) AS f(feature)
WHERE c.make='Tata' AND c.model='Harrier'
  AND NOT EXISTS (SELECT 1 FROM car_features WHERE car_id=c.id);

INSERT INTO car_features (car_id, feature)
SELECT c.id, f.feature
FROM cars c
CROSS JOIN (VALUES
  ('Sony 3D Sound System'),('Advanced ADAS'),('Panoramic Sunroof'),('Smart Door Handles'),('AdrenoX Connect'),('Wireless Charging'),('Driver Drowsiness Alert')
) AS f(feature)
WHERE c.make='Mahindra' AND c.model='XUV700'
  AND NOT EXISTS (SELECT 1 FROM car_features WHERE car_id=c.id);

INSERT INTO car_features (car_id, feature)
SELECT c.id, f.feature
FROM cars c
CROSS JOIN (VALUES
  ('Bose Sound System'),('Panoramic Sunroof'),('ADAS Level 2'),('Wireless Charging'),('360° Camera'),('Ventilated Seats'),('Connected Car Tech'),('Ambient Lighting')
) AS f(feature)
WHERE c.make='Kia' AND c.model='Seltos'
  AND NOT EXISTS (SELECT 1 FROM car_features WHERE car_id=c.id);
