#!/usr/bin/env node
/**
 * Seeds Maruti Suzuki Dzire 2025 into Supabase for the Angular app.
 *
 * Run from your LOCAL machine (not Railway):
 *   cd GAAADIIQ
 *   npm install @supabase/supabase-js   # one-time
 *   node scripts/seed_dzire_supabase.mjs
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://gnhixykdvnuoxeccntjo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_K-cu3EbiH3uDIsonlonRmw_tqsKfp_K';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const VARIANTS = [
  { variant: 'LXi MT',     fuel: 'Petrol', transmission: 'Manual', price: 649000  },
  { variant: 'VXi MT',     fuel: 'Petrol', transmission: 'Manual', price: 749000  },
  { variant: 'VXi AMT',    fuel: 'Petrol', transmission: 'AMT',    price: 799000  },
  { variant: 'VXi CNG MT', fuel: 'CNG',    transmission: 'Manual', price: 820000  },
  { variant: 'ZXi MT',     fuel: 'Petrol', transmission: 'Manual', price: 860000  },
  { variant: 'ZXi AMT',    fuel: 'Petrol', transmission: 'AMT',    price: 910000  },
  { variant: 'ZXi CNG MT', fuel: 'CNG',    transmission: 'Manual', price: 925000  },
  { variant: 'ZXi+ MT',    fuel: 'Petrol', transmission: 'Manual', price: 960000  },
  { variant: 'ZXi+ AMT',   fuel: 'Petrol', transmission: 'AMT',    price: 1010000 },
];

const SPECS = [
  { label: 'Engine',     value: '1.2L DualJet Petrol / CNG' },
  { label: 'Power',      value: '89 bhp (Petrol) / 78 bhp (CNG)' },
  { label: 'Mileage',    value: '24.12 kmpl (Petrol) / 31.12 km/kg (CNG)' },
  { label: 'Seating',    value: '5' },
  { label: 'Boot Space', value: '378 L' },
  { label: 'Kerb Weight',value: '870–925 kg' },
];

const FEATURES = [
  '6 Airbags (ZXi+)',
  'SmartPlay Pro+ 9" Infotainment',
  '360° Surround-View Camera (ZXi+)',
  'Suzuki Connect Telematics',
  'Wireless Charging (ZXi+)',
  'Cruise Control',
  'Automatic Climate Control',
  'Smart Sunroof (ZXi+)',
  'TECT Body Structure',
  'LED Projector Headlamps',
  'Rear AC Vent',
  'AGS Auto Gear Shift',
  'Tyre Pressure Monitoring System',
];

for (const v of VARIANTS) {
  // Skip if already exists
  const { data: existing } = await supabase
    .from('cars').select('id')
    .eq('make', 'Maruti Suzuki').eq('model', 'Dzire')
    .eq('variant', v.variant).eq('year', 2025)
    .maybeSingle();

  if (existing) {
    console.log(`  SKIP (exists): Dzire ${v.variant}`);
    continue;
  }

  const badge = v.variant.startsWith('ZXi+') ? 'Top Model'
              : v.fuel === 'CNG' ? 'Eco'
              : '';

  const { data: car, error } = await supabase.from('cars').insert({
    make: 'Maruti Suzuki',
    model: 'Dzire',
    variant: v.variant,
    year: 2025,
    price: v.price,
    km: 0,
    fuel: v.fuel,
    transmission: v.transmission,
    body_type: 'Sedan',
    badge,
    badge_type: badge ? 'featured' : '',
    rating: 4.3,
    reviews: 0,
    verified: true,
    city: 'Pan India',
    image: '',
  }).select('id').single();

  if (error) {
    console.error(`  ERROR Dzire ${v.variant}:`, error.message);
    continue;
  }

  console.log(`  Created: Dzire ${v.variant.padEnd(12)}  id=${car.id}  ₹${(v.price/100000).toFixed(2)}L`);

  const { error: specErr } = await supabase.from('car_specs')
    .insert(SPECS.map(s => ({ car_id: car.id, label: s.label, value: s.value })));
  if (specErr) console.error(`    Specs error:`, specErr.message);

  const { error: featErr } = await supabase.from('car_features')
    .insert(FEATURES.map(f => ({ car_id: car.id, feature: f })));
  if (featErr) console.error(`    Features error:`, featErr.message);
}

console.log('\nDone! Refresh the New Cars page to see all 9 Dzire variants.');
