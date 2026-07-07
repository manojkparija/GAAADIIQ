-- Update Swift technical specs & features from official S-CNG brochure
-- Run in: https://supabase.com/dashboard/project/gnhixykdvnuoxeccntjo/sql

-- ── 1. Clear old Swift specs & features ──────────────────────────────────────

DELETE FROM car_specs    WHERE car_id IN (SELECT id FROM cars WHERE make='Maruti Suzuki' AND model='Swift');
DELETE FROM car_features WHERE car_id IN (SELECT id FROM cars WHERE make='Maruti Suzuki' AND model='Swift');

-- ── 2. Insert accurate specs (from official brochure) ────────────────────────

INSERT INTO car_specs (car_id, label, value)
SELECT c.id, s.label, s.value
FROM cars c
CROSS JOIN (VALUES
  ('Engine',           '1.2L Z12E 3-Cylinder'),
  ('Displacement',     '1197 cc'),
  ('Max Power',        '81.58 PS @ 5700 rpm'),
  ('Max Torque',       '111.7 Nm @ 4300 rpm'),
  ('Mileage (AMT)',    '25.75 km/l'),
  ('Mileage (MT)',     '24.80 km/l'),
  ('S-CNG Mileage',   '32.85 km/kg'),
  ('Transmission',     '5-Speed MT / AMT'),
  ('Length',           '3860 mm'),
  ('Width',            '1735 mm'),
  ('Height',           '1520 mm'),
  ('Wheelbase',        '2450 mm'),
  ('Ground Clearance', '163 mm'),
  ('Boot Space',       '265 L'),
  ('Fuel Tank',        '37 L (Petrol) / 55 L CNG'),
  ('Seating',          '5'),
  ('Kerb Weight',      '920 kg (MT) / 925 kg (AMT)'),
  ('Tyres (ZXi/ZXi+)','185/65 R15'),
  ('Tyres (LXi/VXi)', '165/80 R14'),
  ('Front Brakes',     'Ventilated Disc'),
  ('Rear Brakes',      'Drums'),
  ('Front Suspension', 'MacPherson Strut'),
  ('Rear Suspension',  'Torsion Beam'),
  ('Emission',         'BS VI')
) AS s(label, value)
WHERE c.make = 'Maruti Suzuki' AND c.model = 'Swift';

-- ── 3. Insert accurate features (ZXi+ highlights from brochure) ──────────────

INSERT INTO car_features (car_id, feature)
SELECT c.id, f.feature
FROM cars c
CROSS JOIN (VALUES
  ('6 Airbags — Standard Across All Variants'),
  ('Electronic Stability Program (ESP)'),
  ('Hill Hold Assist'),
  ('ABS with EBD'),
  ('Wide-Angle Rear Parking Camera'),
  ('Reverse Parking Sensors'),
  ('Front Seatbelts with Pretensioner & Force Limiter'),
  ('ISOFIX Child Seat Anchorages'),
  ('Speed Sensitive Auto Door Lock'),
  ('High Speed Alert System'),
  ('SmartPlay Pro+ 17.78 cm Touchscreen'),
  ('Wireless Android Auto & Apple CarPlay'),
  ('Onboard Voice Assistant (Hi Suzuki)'),
  ('OTA System Upgrades via Smartphone'),
  ('Suzuki Connect — 40+ Connected Features'),
  ('Wireless Charger'),
  ('Cruise Control'),
  ('Engine Push Start-Stop with Smart Key'),
  ('Auto Climate Control (ZXi/ZXi+)'),
  ('LED Projector Headlamps with Boomerang DRLs'),
  ('C-Shaped LED Tail Lamps'),
  ('Precision Cut Dual-Tone Alloy Wheels (ZXi+)'),
  ('Electrically Foldable ORVMs (ZXi+)'),
  ('Rear AC Vent'),
  ('Coloured Multi-Information Display'),
  ('Front Ambient Illumination'),
  ('60/40 Split Rear Seat'),
  ('Auto Headlamps — Lead Me to Vehicle / Follow Me Home'),
  ('4 Speakers + 2 Tweeters'),
  ('Leather Wrapped Steering Wheel (ZXi+)'),
  ('Idle Start-Stop (Petrol variants)')
) AS f(feature)
WHERE c.make = 'Maruti Suzuki' AND c.model = 'Swift';
