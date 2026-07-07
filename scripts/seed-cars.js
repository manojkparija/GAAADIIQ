#!/usr/bin/env node
/**
 * Seed GAADIIQ cars database with popular Indian cars (2025 new + used).
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=<service-role-key> node scripts/seed-cars.js
 *
 * Pass --clear to delete all existing cars before seeding:
 *   SUPABASE_SERVICE_KEY=... node scripts/seed-cars.js --clear
 */

const https = require('https');

const SUPABASE_URL = 'https://gnhixykdvnuoxeccntjo.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CLEAR = process.argv.includes('--clear');

if (!SERVICE_KEY) {
  console.error('ERROR: Set SUPABASE_SERVICE_KEY environment variable.');
  process.exit(1);
}

// ── REST helper ───────────────────────────────────────────────────────────────

function rest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'gnhixykdvnuoxeccntjo.supabase.co',
      path: `/rest/v1/${path}`,
      method,
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data ? JSON.parse(data) : null);
        } else {
          reject(new Error(`HTTP ${res.statusCode} ${path}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Car data ──────────────────────────────────────────────────────────────────

const CARS = [
  // ── NEW CARS (2025, km=0) ──────────────────────────────────────────────────

  // Maruti Suzuki
  { make:'Maruti Suzuki', model:'Swift',        variant:'ZXi+ AMT',      year:2025, price:899000,  km:0,     fuel:'Petrol',   transmission:'AMT',       badge:'Best Seller', badge_type:'primary',   rating:4.7, reviews:312, city:'Mumbai',    body_type:'Hatchback', color:'Sizzling Red'    },
  { make:'Maruti Suzuki', model:'Swift',        variant:'VXi',           year:2025, price:699000,  km:0,     fuel:'Petrol',   transmission:'Manual',    badge:'Brand New',   badge_type:'success',   rating:4.6, reviews:198, city:'Pune',      body_type:'Hatchback', color:'Luster Blue'     },
  { make:'Maruti Suzuki', model:'Swift',        variant:'S-CNG ZXi',     year:2025, price:849000,  km:0,     fuel:'CNG',      transmission:'Manual',    badge:'Brand New',   badge_type:'success',   rating:4.5, reviews:87,  city:'Delhi',     body_type:'Hatchback', color:'Magma Grey'      },
  { make:'Maruti Suzuki', model:'Baleno',       variant:'Alpha CVT',     year:2025, price:995000,  km:0,     fuel:'Petrol',   transmission:'CVT',       badge:'Brand New',   badge_type:'success',   rating:4.6, reviews:154, city:'Bangalore', body_type:'Hatchback', color:'Midnight Black'  },
  { make:'Maruti Suzuki', model:'Baleno',       variant:'Delta MT',      year:2025, price:699000,  km:0,     fuel:'Petrol',   transmission:'Manual',    badge:'Brand New',   badge_type:'success',   rating:4.5, reviews:89,  city:'Chennai',   body_type:'Hatchback', color:'Splendid Silver' },
  { make:'Maruti Suzuki', model:'Brezza',       variant:'ZXi+ AT',       year:2025, price:1399000, km:0,     fuel:'Petrol',   transmission:'Automatic', badge:'Brand New',   badge_type:'success',   rating:4.6, reviews:201, city:'Hyderabad', body_type:'SUV',       color:'Brave Khaki'     },
  { make:'Maruti Suzuki', model:'Brezza',       variant:'VXi CNG',       year:2025, price:1099000, km:0,     fuel:'CNG',      transmission:'Manual',    badge:'Brand New',   badge_type:'success',   rating:4.4, reviews:76,  city:'Mumbai',    body_type:'SUV',       color:'Pearl White'     },
  { make:'Maruti Suzuki', model:'Ertiga',       variant:'ZXi+ AT',       year:2025, price:1399000, km:0,     fuel:'Petrol',   transmission:'Automatic', badge:'Brand New',   badge_type:'success',   rating:4.5, reviews:143, city:'Kolkata',   body_type:'MUV',       color:'Auburn Silver'   },
  { make:'Maruti Suzuki', model:'Grand Vitara', variant:'Alpha+ AWD',    year:2025, price:2249000, km:0,     fuel:'Hybrid',   transmission:'Automatic', badge:'Brand New',   badge_type:'success',   rating:4.7, reviews:178, city:'Delhi',     body_type:'SUV',       color:'Grandeur Grey'   },
  { make:'Maruti Suzuki', model:'Ciaz',         variant:'Alpha AT',      year:2025, price:1199000, km:0,     fuel:'Petrol',   transmission:'Automatic', badge:'Brand New',   badge_type:'success',   rating:4.4, reviews:98,  city:'Jaipur',    body_type:'Sedan',     color:'Pearl White'     },

  // Hyundai
  { make:'Hyundai', model:'i20',           variant:'Asta(O) 1.0T DCT',   year:2025, price:1099000, km:0,     fuel:'Petrol',   transmission:'DCT',       badge:'Brand New',   badge_type:'success',   rating:4.6, reviews:221, city:'Chennai',   body_type:'Hatchback', color:'Atlas White'     },
  { make:'Hyundai', model:'Creta',         variant:'SX(O) 1.5T DCT',     year:2025, price:1999000, km:0,     fuel:'Petrol',   transmission:'DCT',       badge:'Top Rated',   badge_type:'warning',   rating:4.8, reviews:387, city:'Mumbai',    body_type:'SUV',       color:'Abyss Black'     },
  { make:'Hyundai', model:'Creta',         variant:'S 1.5 MT Diesel',    year:2025, price:1499000, km:0,     fuel:'Diesel',   transmission:'Manual',    badge:'Brand New',   badge_type:'success',   rating:4.6, reviews:156, city:'Hyderabad', body_type:'SUV',       color:'Titan Grey'      },
  { make:'Hyundai', model:'Creta Electric','variant':'Excellence LR',    year:2025, price:2399000, km:0,     fuel:'Electric', transmission:'Automatic', badge:'EV Deal',     badge_type:'primary',   rating:4.8, reviews:203, city:'Bangalore', body_type:'SUV',       color:'Starry Night'    },
  { make:'Hyundai', model:'Venue',         variant:'SX+ 1.0T DCT',       year:2025, price:1349000, km:0,     fuel:'Petrol',   transmission:'DCT',       badge:'Brand New',   badge_type:'success',   rating:4.5, reviews:167, city:'Delhi',     body_type:'SUV',       color:'Fiery Red'       },
  { make:'Hyundai', model:'Verna',         variant:'SX(O) 1.5T CVT',     year:2025, price:1799000, km:0,     fuel:'Petrol',   transmission:'CVT',       badge:'Brand New',   badge_type:'success',   rating:4.7, reviews:143, city:'Pune',      body_type:'Sedan',     color:'Tellurian Brown' },
  { make:'Hyundai', model:'Alcazar',       variant:'Platinum 6-str AT',  year:2025, price:2199000, km:0,     fuel:'Petrol',   transmission:'Automatic', badge:'Brand New',   badge_type:'success',   rating:4.6, reviews:112, city:'Kolkata',   body_type:'SUV',       color:'Typhoon Silver'  },
  { make:'Hyundai', model:'Tucson',        variant:'Signature AT 4WD',   year:2025, price:3699000, km:0,     fuel:'Petrol',   transmission:'Automatic', badge:'Premium',     badge_type:'primary',   rating:4.7, reviews:89,  city:'Mumbai',    body_type:'SUV',       color:'Titan Grey'      },

  // Tata
  { make:'Tata', model:'Punch',   variant:'Adventure AMT',       year:2025, price:899000,  km:0,     fuel:'Petrol',   transmission:'AMT',       badge:'Brand New',   badge_type:'success',   rating:4.5, reviews:198, city:'Nagpur',    body_type:'SUV',       color:'Daytona Grey'    },
  { make:'Tata', model:'Punch',   variant:'Empowered+ iCNG',     year:2025, price:999000,  km:0,     fuel:'CNG',      transmission:'Manual',    badge:'Brand New',   badge_type:'success',   rating:4.4, reviews:87,  city:'Ahmedabad', body_type:'SUV',       color:'Tornado Blue'    },
  { make:'Tata', model:'Nexon',   variant:'Creative Plus AMT',   year:2025, price:1599000, km:0,     fuel:'Petrol',   transmission:'AMT',       badge:'Brand New',   badge_type:'success',   rating:4.6, reviews:231, city:'Mumbai',    body_type:'SUV',       color:'Pristine White'  },
  { make:'Tata', model:'Nexon EV','variant':'Max LR 40.5 kWh',   year:2025, price:1999000, km:0,     fuel:'Electric', transmission:'Automatic', badge:'EV Deal',     badge_type:'primary',   rating:4.7, reviews:176, city:'Delhi',     body_type:'SUV',       color:'Midnight Plum'   },
  { make:'Tata', model:'Harrier', variant:'Adventure Plus AT',   year:2025, price:2199000, km:0,     fuel:'Diesel',   transmission:'Automatic', badge:'Brand New',   badge_type:'success',   rating:4.7, reviews:154, city:'Bangalore', body_type:'SUV',       color:'Orcus White'     },
  { make:'Tata', model:'Safari',  variant:'Gold 6-str AT',       year:2025, price:2699000, km:0,     fuel:'Diesel',   transmission:'Automatic', badge:'Brand New',   badge_type:'success',   rating:4.7, reviews:143, city:'Pune',      body_type:'SUV',       color:'Tropical Mist'   },
  { make:'Tata', model:'Curvv',   variant:'Creative Plus 1.2T',  year:2025, price:1599000, km:0,     fuel:'Petrol',   transmission:'DCT',       badge:'Brand New',   badge_type:'success',   rating:4.6, reviews:98,  city:'Chennai',   body_type:'SUV',       color:'Pristine White'  },
  { make:'Tata', model:'Curvv EV','variant':'Long Range',         year:2025, price:2199000, km:0,     fuel:'Electric', transmission:'Automatic', badge:'EV Deal',     badge_type:'primary',   rating:4.7, reviews:67,  city:'Hyderabad', body_type:'SUV',       color:'Flame Orange'    },

  // Kia
  { make:'Kia', model:'Seltos',   variant:'HTX Plus 1.5T DCT',   year:2025, price:1899000, km:0,     fuel:'Petrol',   transmission:'DCT',       badge:'Brand New',   badge_type:'success',   rating:4.7, reviews:267, city:'Delhi',     body_type:'SUV',       color:'Pewter Olive'    },
  { make:'Kia', model:'Seltos',   variant:'X-Line 1.5 AT Diesel',year:2025, price:2099000, km:0,     fuel:'Diesel',   transmission:'Automatic', badge:'Brand New',   badge_type:'success',   rating:4.6, reviews:189, city:'Mumbai',    body_type:'SUV',       color:'Aurora Black'    },
  { make:'Kia', model:'Sonet',    variant:'HTX Plus 1.0T DCT',   year:2025, price:1399000, km:0,     fuel:'Petrol',   transmission:'DCT',       badge:'Brand New',   badge_type:'success',   rating:4.5, reviews:154, city:'Bangalore', body_type:'SUV',       color:'Imperial Blue'   },
  { make:'Kia', model:'Carens',   variant:'Prestige+ 1.5T AT',   year:2025, price:1899000, km:0,     fuel:'Petrol',   transmission:'Automatic', badge:'Brand New',   badge_type:'success',   rating:4.6, reviews:123, city:'Chennai',   body_type:'MUV',       color:'Gravity Grey'    },
  { make:'Kia', model:'EV6',      variant:'GT-Line AWD',          year:2025, price:6099000, km:0,     fuel:'Electric', transmission:'Automatic', badge:'Premium EV',  badge_type:'primary',   rating:4.9, reviews:76,  city:'Delhi',     body_type:'SUV',       color:'Snow White Pearl'},

  // Toyota
  { make:'Toyota', model:'Innova Hycross', variant:'ZX(O) Hybrid AT', year:2025, price:2999000, km:0, fuel:'Hybrid',   transmission:'Automatic', badge:'Brand New',   badge_type:'success',   rating:4.8, reviews:198, city:'Hyderabad', body_type:'MUV',       color:'Super White II'  },
  { make:'Toyota', model:'Urban Cruiser Hyryder','variant':'V Hybrid', year:2025, price:2099000, km:0, fuel:'Hybrid',  transmission:'Automatic', badge:'Brand New',   badge_type:'success',   rating:4.7, reviews:143, city:'Bangalore', body_type:'SUV',       color:'Midnight Black'  },
  { make:'Toyota', model:'Fortuner',      variant:'Legender 4x4 AT', year:2025, price:4699000, km:0, fuel:'Diesel',   transmission:'Automatic', badge:'Premium',     badge_type:'primary',   rating:4.9, reviews:267, city:'Delhi',     body_type:'SUV',       color:'Sparkling Black' },
  { make:'Toyota', model:'Camry',         variant:'Hybrid AT',       year:2025, price:4699000, km:0, fuel:'Hybrid',   transmission:'Automatic', badge:'Premium',     badge_type:'primary',   rating:4.8, reviews:89,  city:'Mumbai',    body_type:'Sedan',     color:'Emotional Red'   },
  { make:'Toyota', model:'Glanza',        variant:'V MT',            year:2025, price:799000,  km:0, fuel:'Petrol',   transmission:'Manual',    badge:'Brand New',   badge_type:'success',   rating:4.5, reviews:98,  city:'Pune',      body_type:'Hatchback', color:'Sporty Blue'     },

  // Honda
  { make:'Honda', model:'City',    variant:'ZX CVT',              year:2025, price:1699000, km:0,     fuel:'Petrol',   transmission:'CVT',       badge:'Brand New',   badge_type:'success',   rating:4.6, reviews:176, city:'Mumbai',    body_type:'Sedan',     color:'Lunar Silver'    },
  { make:'Honda', model:'City',    variant:'e:HEV',               year:2025, price:2099000, km:0,     fuel:'Hybrid',   transmission:'Automatic', badge:'Brand New',   badge_type:'success',   rating:4.7, reviews:112, city:'Bangalore', body_type:'Sedan',     color:'Radiant Red'     },
  { make:'Honda', model:'Elevate', variant:'ZX CVT',              year:2025, price:1899000, km:0,     fuel:'Petrol',   transmission:'CVT',       badge:'Brand New',   badge_type:'success',   rating:4.6, reviews:143, city:'Delhi',     body_type:'SUV',       color:'Ignite Red'      },
  { make:'Honda', model:'Amaze',   variant:'VX CVT',              year:2025, price:999000,  km:0,     fuel:'Petrol',   transmission:'CVT',       badge:'Brand New',   badge_type:'success',   rating:4.4, reviews:89,  city:'Chennai',   body_type:'Sedan',     color:'Meteoroid Grey'  },

  // Mahindra
  { make:'Mahindra', model:'Thar Roxx',  variant:'MX5 4WD AT',   year:2025, price:1699000, km:0,     fuel:'Diesel',   transmission:'Automatic', badge:'Top Rated',   badge_type:'warning',   rating:4.8, reviews:234, city:'Jaipur',    body_type:'SUV',       color:'Everest White'   },
  { make:'Mahindra', model:'XUV 3XO',   variant:'AX7 Turbo AT', year:2025, price:1599000, km:0,     fuel:'Petrol',   transmission:'Automatic', badge:'Brand New',   badge_type:'success',   rating:4.6, reviews:167, city:'Mumbai',    body_type:'SUV',       color:'Midnight Black'  },
  { make:'Mahindra', model:'XUV700',    variant:'AX7 L 4WD AT', year:2025, price:2999000, km:0,     fuel:'Diesel',   transmission:'Automatic', badge:'Top Rated',   badge_type:'warning',   rating:4.8, reviews:312, city:'Delhi',     body_type:'SUV',       color:'Dazzling Silver' },
  { make:'Mahindra', model:'Scorpio N', variant:'Z8 L MT',      year:2025, price:1999000, km:0,     fuel:'Diesel',   transmission:'Manual',    badge:'Brand New',   badge_type:'success',   rating:4.7, reviews:198, city:'Nagpur',    body_type:'SUV',       color:'Everest White'   },
  { make:'Mahindra', model:'BE 6',      variant:'Pack Three',   year:2025, price:2699000, km:0,     fuel:'Electric', transmission:'Automatic', badge:'EV Deal',     badge_type:'primary',   rating:4.8, reviews:134, city:'Bangalore', body_type:'SUV',       color:'Copper'          },
  { make:'Mahindra', model:'XEV 9e',   variant:'Pack Three',   year:2025, price:3699000, km:0,     fuel:'Electric', transmission:'Automatic', badge:'Premium EV',  badge_type:'primary',   rating:4.8, reviews:89,  city:'Mumbai',    body_type:'SUV',       color:'Stealth Black'   },

  // MG
  { make:'MG', model:'Hector',        variant:'Savvy Pro Turbo AT',  year:2025, price:2199000, km:0, fuel:'Petrol',   transmission:'Automatic', badge:'Brand New',   badge_type:'success',   rating:4.5, reviews:154, city:'Ahmedabad', body_type:'SUV',       color:'Starry Black'    },
  { make:'MG', model:'ZS EV',         variant:'Excite Pro',          year:2025, price:2299000, km:0, fuel:'Electric', transmission:'Automatic', badge:'EV Deal',     badge_type:'primary',   rating:4.6, reviews:123, city:'Bangalore', body_type:'SUV',       color:'Aurora Silver'   },
  { make:'MG', model:'Windsor EV',    variant:'Excite',              year:2025, price:1399000, km:0, fuel:'Electric', transmission:'Automatic', badge:'EV Deal',     badge_type:'primary',   rating:4.7, reviews:198, city:'Delhi',     body_type:'SUV',       color:'Starburst White' },
  { make:'MG', model:'Comet EV',      variant:'Pace',                year:2025, price:699000,  km:0, fuel:'Electric', transmission:'Automatic', badge:'EV Deal',     badge_type:'primary',   rating:4.3, reviews:67,  city:'Mumbai',    body_type:'Hatchback', color:'Candy White'     },

  // Renault
  { make:'Renault', model:'Kiger',    variant:'RXZ Turbo MT',        year:2025, price:999000,  km:0, fuel:'Petrol',   transmission:'Manual',    badge:'Brand New',   badge_type:'success',   rating:4.4, reviews:112, city:'Chennai',   body_type:'SUV',       color:'Moonlight Silver'},
  { make:'Renault', model:'Triber',   variant:'RXZ AMT',             year:2025, price:899000,  km:0, fuel:'Petrol',   transmission:'AMT',       badge:'Brand New',   badge_type:'success',   rating:4.4, reviews:87,  city:'Kolkata',   body_type:'MUV',       color:'Ice Cool White'  },

  // Nissan
  { make:'Nissan', model:'Magnite',   variant:'Turbo CVT XV Premium', year:2025, price:1099000, km:0, fuel:'Petrol',   transmission:'CVT',       badge:'Brand New',   badge_type:'success',   rating:4.4, reviews:98,  city:'Pune',      body_type:'SUV',       color:'Blade Silver'    },

  // Skoda
  { make:'Skoda', model:'Slavia',     variant:'Style 1.5T DSG',      year:2025, price:1999000, km:0, fuel:'Petrol',   transmission:'DCT',       badge:'Premium',     badge_type:'primary',   rating:4.7, reviews:134, city:'Mumbai',    body_type:'Sedan',     color:'Carbon Steel'    },
  { make:'Skoda', model:'Kushaq',     variant:'Monte Carlo 1.5T DSG',year:2025, price:2099000, km:0, fuel:'Petrol',   transmission:'DCT',       badge:'Premium',     badge_type:'primary',   rating:4.7, reviews:112, city:'Delhi',     body_type:'SUV',       color:'Candy White'     },
  { make:'Skoda', model:'Kodiaq',     variant:'Laurin & Klement',    year:2025, price:4699000, km:0, fuel:'Petrol',   transmission:'DCT',       badge:'Premium',     badge_type:'primary',   rating:4.8, reviews:67,  city:'Bangalore', body_type:'SUV',       color:'Quartz Grey'     },

  // Volkswagen
  { make:'Volkswagen', model:'Taigun', variant:'GT Plus 1.5T DSG',   year:2025, price:2099000, km:0, fuel:'Petrol',   transmission:'DCT',       badge:'Premium',     badge_type:'primary',   rating:4.7, reviews:123, city:'Chennai',   body_type:'SUV',       color:'Reflex Silver'   },
  { make:'Volkswagen', model:'Virtus', variant:'GT Plus 1.5T DSG',   year:2025, price:1999000, km:0, fuel:'Petrol',   transmission:'DCT',       badge:'Premium',     badge_type:'primary',   rating:4.7, reviews:112, city:'Mumbai',    body_type:'Sedan',     color:'Limestone Grey'  },

  // Jeep
  { make:'Jeep', model:'Compass',     variant:'Model S Plus AT 4x4', year:2025, price:3299000, km:0, fuel:'Diesel',   transmission:'Automatic', badge:'Premium',     badge_type:'primary',   rating:4.7, reviews:89,  city:'Delhi',     body_type:'SUV',       color:'Techno Green'    },
  { make:'Jeep', model:'Meridian',    variant:'Limited Plus AT 4x4', year:2025, price:3799000, km:0, fuel:'Diesel',   transmission:'Automatic', badge:'Premium',     badge_type:'primary',   rating:4.7, reviews:67,  city:'Mumbai',    body_type:'SUV',       color:'Granite Crystal' },

  // ── USED CARS (pre-owned, various years) ───────────────────────────────────

  { make:'Maruti Suzuki', model:'Swift',     variant:'ZXi AMT',        year:2022, price:649000,  km:28000,  fuel:'Petrol',   transmission:'AMT',       badge:'Certified',   badge_type:'success',   rating:4.5, reviews:45,  city:'Mumbai',    body_type:'Hatchback', color:'Sizzling Red',    owners:'1st Owner' },
  { make:'Maruti Suzuki', model:'Swift',     variant:'VXi',            year:2021, price:529000,  km:45000,  fuel:'Petrol',   transmission:'Manual',    badge:'Certified',   badge_type:'success',   rating:4.4, reviews:32,  city:'Delhi',     body_type:'Hatchback', color:'Pearl White',     owners:'1st Owner' },
  { make:'Maruti Suzuki', model:'Baleno',    variant:'Alpha CVT',      year:2022, price:749000,  km:32000,  fuel:'Petrol',   transmission:'CVT',       badge:'Certified',   badge_type:'success',   rating:4.5, reviews:38,  city:'Pune',      body_type:'Hatchback', color:'Midnight Black',  owners:'1st Owner' },
  { make:'Maruti Suzuki', model:'Brezza',    variant:'ZXi+',           year:2023, price:999000,  km:18000,  fuel:'Petrol',   transmission:'Automatic', badge:'Certified',   badge_type:'success',   rating:4.6, reviews:29,  city:'Bangalore', body_type:'SUV',       color:'Brave Khaki',     owners:'1st Owner' },
  { make:'Maruti Suzuki', model:'Ertiga',    variant:'VXi CNG',        year:2021, price:749000,  km:55000,  fuel:'CNG',      transmission:'Manual',    badge:'Verified',    badge_type:'info',      rating:4.3, reviews:21,  city:'Ahmedabad', body_type:'MUV',       color:'Auburn Silver',   owners:'2nd Owner' },

  { make:'Hyundai', model:'i20',       variant:'Asta 1.2 MT',          year:2022, price:749000,  km:38000,  fuel:'Petrol',   transmission:'Manual',    badge:'Certified',   badge_type:'success',   rating:4.4, reviews:34,  city:'Chennai',   body_type:'Hatchback', color:'Fiery Red',       owners:'1st Owner' },
  { make:'Hyundai', model:'Creta',     variant:'SX 1.5 MT Diesel',     year:2022, price:1299000, km:42000,  fuel:'Diesel',   transmission:'Manual',    badge:'Certified',   badge_type:'success',   rating:4.6, reviews:56,  city:'Delhi',     body_type:'SUV',       color:'Titan Grey',      owners:'1st Owner' },
  { make:'Hyundai', model:'Creta',     variant:'E 1.5 MT Petrol',      year:2021, price:1049000, km:61000,  fuel:'Petrol',   transmission:'Manual',    badge:'Verified',    badge_type:'info',      rating:4.4, reviews:43,  city:'Hyderabad', body_type:'SUV',       color:'Polar White',     owners:'2nd Owner' },
  { make:'Hyundai', model:'Venue',     variant:'SX+ DCT',              year:2023, price:1049000, km:22000,  fuel:'Petrol',   transmission:'DCT',       badge:'Certified',   badge_type:'success',   rating:4.5, reviews:28,  city:'Mumbai',    body_type:'SUV',       color:'Fiery Red',       owners:'1st Owner' },
  { make:'Hyundai', model:'Verna',     variant:'SX(O) CVT',            year:2023, price:1349000, km:19000,  fuel:'Petrol',   transmission:'CVT',       badge:'Certified',   badge_type:'success',   rating:4.6, reviews:31,  city:'Pune',      body_type:'Sedan',     color:'Tellurian Brown', owners:'1st Owner' },

  { make:'Tata', model:'Nexon',    variant:'XZ+ AMT',                  year:2022, price:1099000, km:35000,  fuel:'Petrol',   transmission:'AMT',       badge:'Certified',   badge_type:'success',   rating:4.5, reviews:47,  city:'Kolkata',   body_type:'SUV',       color:'Calgary White',   owners:'1st Owner' },
  { make:'Tata', model:'Harrier',  variant:'XZ Plus AT',               year:2021, price:1499000, km:48000,  fuel:'Diesel',   transmission:'Automatic', badge:'Certified',   badge_type:'success',   rating:4.6, reviews:38,  city:'Mumbai',    body_type:'SUV',       color:'Orcus White',     owners:'1st Owner' },
  { make:'Tata', model:'Safari',   variant:'XZA Plus 6-str',           year:2022, price:1899000, km:31000,  fuel:'Diesel',   transmission:'Automatic', badge:'Certified',   badge_type:'success',   rating:4.6, reviews:29,  city:'Delhi',     body_type:'SUV',       color:'Tropical Mist',   owners:'1st Owner' },
  { make:'Tata', model:'Punch',    variant:'Accomplished AMT',         year:2023, price:749000,  km:17000,  fuel:'Petrol',   transmission:'AMT',       badge:'Certified',   badge_type:'success',   rating:4.4, reviews:23,  city:'Nagpur',    body_type:'SUV',       color:'Daytona Grey',    owners:'1st Owner' },

  { make:'Kia', model:'Seltos',    variant:'HTX 1.5T DCT',             year:2022, price:1399000, km:39000,  fuel:'Petrol',   transmission:'DCT',       badge:'Certified',   badge_type:'success',   rating:4.6, reviews:52,  city:'Bangalore', body_type:'SUV',       color:'Aurora Black',    owners:'1st Owner' },
  { make:'Kia', model:'Sonet',     variant:'HTX Plus DCT',             year:2022, price:1049000, km:33000,  fuel:'Petrol',   transmission:'DCT',       badge:'Certified',   badge_type:'success',   rating:4.4, reviews:37,  city:'Chennai',   body_type:'SUV',       color:'Imperial Blue',   owners:'1st Owner' },
  { make:'Kia', model:'Carens',    variant:'Luxury Plus 6-str AT',     year:2023, price:1599000, km:21000,  fuel:'Diesel',   transmission:'Automatic', badge:'Certified',   badge_type:'success',   rating:4.5, reviews:26,  city:'Delhi',     body_type:'MUV',       color:'Gravity Grey',    owners:'1st Owner' },

  { make:'Mahindra', model:'Scorpio N', variant:'Z8 L AT',             year:2022, price:1699000, km:41000,  fuel:'Diesel',   transmission:'Automatic', badge:'Certified',   badge_type:'success',   rating:4.7, reviews:61,  city:'Jaipur',    body_type:'SUV',       color:'Galaxy Grey',     owners:'1st Owner' },
  { make:'Mahindra', model:'XUV700',   variant:'AX7 L AT',             year:2022, price:2299000, km:36000,  fuel:'Diesel',   transmission:'Automatic', badge:'Certified',   badge_type:'success',   rating:4.7, reviews:54,  city:'Hyderabad', body_type:'SUV',       color:'Dazzling Silver', owners:'1st Owner' },
  { make:'Mahindra', model:'Thar',     variant:'LX AT 4WD Hard Top',  year:2021, price:1299000, km:52000,  fuel:'Diesel',   transmission:'Automatic', badge:'Verified',    badge_type:'info',      rating:4.6, reviews:47,  city:'Pune',      body_type:'SUV',       color:'Rocky Beige',     owners:'1st Owner' },

  { make:'Toyota', model:'Innova Crysta','variant':'ZX AT',            year:2020, price:1699000, km:68000,  fuel:'Diesel',   transmission:'Automatic', badge:'Verified',    badge_type:'info',      rating:4.7, reviews:76,  city:'Mumbai',    body_type:'MUV',       color:'Super White II',  owners:'1st Owner' },
  { make:'Toyota', model:'Fortuner',    variant:'4x2 AT Diesel',       year:2021, price:3299000, km:44000,  fuel:'Diesel',   transmission:'Automatic', badge:'Certified',   badge_type:'success',   rating:4.8, reviews:89,  city:'Delhi',     body_type:'SUV',       color:'Sparkling Black', owners:'1st Owner' },

  { make:'Honda', model:'City',    variant:'ZX CVT',                   year:2022, price:1099000, km:37000,  fuel:'Petrol',   transmission:'CVT',       badge:'Certified',   badge_type:'success',   rating:4.5, reviews:41,  city:'Bangalore', body_type:'Sedan',     color:'Lunar Silver',    owners:'1st Owner' },
  { make:'Honda', model:'Amaze',   variant:'VX CVT',                   year:2021, price:699000,  km:49000,  fuel:'Petrol',   transmission:'CVT',       badge:'Certified',   badge_type:'success',   rating:4.3, reviews:28,  city:'Chennai',   body_type:'Sedan',     color:'Meteoroid Grey',  owners:'1st Owner' },

  { make:'MG', model:'Hector',     variant:'Sharp Turbo AT',           year:2021, price:1499000, km:53000,  fuel:'Petrol',   transmission:'Automatic', badge:'Verified',    badge_type:'info',      rating:4.4, reviews:36,  city:'Ahmedabad', body_type:'SUV',       color:'Starry Black',    owners:'2nd Owner' },

  { make:'Renault', model:'Kiger', variant:'RXZ Turbo MT',             year:2022, price:749000,  km:34000,  fuel:'Petrol',   transmission:'Manual',    badge:'Certified',   badge_type:'success',   rating:4.3, reviews:24,  city:'Kolkata',   body_type:'SUV',       color:'Moonlight Silver',owners:'1st Owner' },

  { make:'Maruti Suzuki', model:'Fronx',  variant:'Alpha 1.0T AT',     year:2024, price:1049000, km:12000,  fuel:'Petrol',   transmission:'Automatic', badge:'Certified',   badge_type:'success',   rating:4.6, reviews:198, city:'Bangalore', body_type:'SUV',       color:'Nexa Blue',       owners:'1st Owner' },
  { make:'Maruti Suzuki', model:'Jimny',  variant:'Zeta 4WD MT',       year:2024, price:1299000, km:8000,   fuel:'Petrol',   transmission:'Manual',    badge:'Certified',   badge_type:'success',   rating:4.9, reviews:143, city:'Jaipur',    body_type:'SUV',       color:'Sizzling Red',    owners:'1st Owner' },
  { make:'Hyundai',       model:'Exter',  variant:'SX(O) AMT',         year:2024, price:849000,  km:9500,   fuel:'Petrol',   transmission:'AMT',       badge:'Certified',   badge_type:'success',   rating:4.5, reviews:156, city:'Chennai',   body_type:'SUV',       color:'Atlas White',     owners:'1st Owner' },
];

// ── Specs per model (shared across variants) ──────────────────────────────────

const MODEL_SPECS = {
  'Maruti Suzuki Swift':        [{ label:'Engine', value:'1.2L Z12E NA' }, { label:'Power', value:'82 bhp' }, { label:'Torque', value:'112 Nm' }, { label:'Mileage', value:'25.75 km/l' }, { label:'Seating', value:'5' }, { label:'Boot', value:'268 L' }],
  'Maruti Suzuki Baleno':       [{ label:'Engine', value:'1.2L K12N Dual Jet' }, { label:'Power', value:'90 bhp' }, { label:'Torque', value:'113 Nm' }, { label:'Mileage', value:'22.94 km/l' }, { label:'Seating', value:'5' }, { label:'Boot', value:'318 L' }],
  'Maruti Suzuki Brezza':       [{ label:'Engine', value:'1.5L K15C Mild Hybrid' }, { label:'Power', value:'103 bhp' }, { label:'Torque', value:'137 Nm' }, { label:'Mileage', value:'19.89 km/l' }, { label:'Seating', value:'5' }, { label:'Boot', value:'328 L' }],
  'Maruti Suzuki Grand Vitara': [{ label:'Engine', value:'1.5L Strong Hybrid' }, { label:'Power', value:'115 bhp' }, { label:'Torque', value:'141 Nm' }, { label:'Mileage', value:'27.97 km/l' }, { label:'Seating', value:'5' }, { label:'Boot', value:'265 L' }],
  'Hyundai Creta':              [{ label:'Engine', value:'1.5L Turbo GDi' }, { label:'Power', value:'160 bhp' }, { label:'Torque', value:'253 Nm' }, { label:'Mileage', value:'17 km/l' }, { label:'Seating', value:'5' }, { label:'Boot', value:'433 L' }],
  'Hyundai Creta Electric':     [{ label:'Battery', value:'51.4 kWh' }, { label:'Range', value:'473 km' }, { label:'Power', value:'171 bhp' }, { label:'0-100', value:'7.9 s' }, { label:'Seating', value:'5' }, { label:'Boot', value:'433 L' }],
  'Tata Nexon EV':              [{ label:'Battery', value:'40.5 kWh' }, { label:'Range', value:'465 km' }, { label:'Power', value:'143 bhp' }, { label:'0-100', value:'8.9 s' }, { label:'Seating', value:'5' }, { label:'Boot', value:'350 L' }],
  'Tata Harrier':               [{ label:'Engine', value:'2.0L Kryotec Diesel' }, { label:'Power', value:'170 bhp' }, { label:'Torque', value:'350 Nm' }, { label:'Mileage', value:'16.35 km/l' }, { label:'Seating', value:'5' }, { label:'Boot', value:'425 L' }],
  'Mahindra XUV700':            [{ label:'Engine', value:'2.2L mHawk Diesel' }, { label:'Power', value:'185 bhp' }, { label:'Torque', value:'450 Nm' }, { label:'Mileage', value:'16.04 km/l' }, { label:'Seating', value:'7' }, { label:'Boot', value:'194 L' }],
  'Kia Seltos':                 [{ label:'Engine', value:'1.5L Turbo GDi' }, { label:'Power', value:'160 bhp' }, { label:'Torque', value:'253 Nm' }, { label:'Mileage', value:'16.5 km/l' }, { label:'Seating', value:'5' }, { label:'Boot', value:'433 L' }],
  'Toyota Fortuner':            [{ label:'Engine', value:'2.8L GD Diesel' }, { label:'Power', value:'204 bhp' }, { label:'Torque', value:'500 Nm' }, { label:'Mileage', value:'10 km/l' }, { label:'Seating', value:'7' }, { label:'Boot', value:'220 L' }],
};

const MODEL_FEATURES = {
  'Maruti Suzuki Swift':    ['6 Airbags', 'Suzuki Connect', 'HUD', 'Wireless Charging', 'Push Start/Stop', 'Rear Parking Camera', 'LED DRLs', 'Cruise Control'],
  'Hyundai Creta':          ['Bose Sound System', 'Ventilated Seats', 'Panoramic Sunroof', 'ADAS Level 2', 'Wireless Charging', '360° Camera', 'Ambient Lighting', 'Blind Spot Monitor'],
  'Tata Harrier':           ['JBL Sound System', 'Panoramic Sunroof', 'Ventilated Seats', '360° Camera', 'ADAS', 'Wireless Charging', 'Ambient Lighting', 'iRA Connected Car'],
  'Mahindra XUV700':        ['Sony 3D Sound System', 'Advanced ADAS', 'Panoramic Sunroof', 'Smart Door Handles', 'AdrenoX Connect', 'Wireless Charging', 'Driver Drowsiness Alert'],
  'Kia Seltos':             ['Bose Sound System', 'Panoramic Sunroof', 'ADAS Level 2', 'Wireless Charging', '360° Camera', 'Ventilated Seats', 'Connected Car Tech', 'Ambient Lighting'],
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚗 GAADIIQ Car Seed Script');
  console.log(`   Seeding ${CARS.length} cars...`);
  console.log('');

  if (CLEAR) {
    console.log('🗑️  Clearing existing cars...');
    await rest('DELETE', 'cars?id=gt.0', null);
    console.log('✅ Cleared.');
  }

  let inserted = 0;
  let errors = 0;

  for (const car of CARS) {
    const { make, model, variant, year, price, km, fuel, transmission,
            badge, badge_type, rating, reviews, city, body_type, color, owners } = car;

    try {
      const rows = await rest('POST', 'cars', [{
        make, model, variant, year, price, km, fuel, transmission,
        badge, badge_type, rating, reviews, city, body_type, color, owners,
        verified: true,
        image: '',
      }]);

      const carId = rows?.[0]?.id;
      if (!carId) throw new Error('No ID returned');

      // Insert specs
      const specKey = `${make} ${model}`;
      const specs = MODEL_SPECS[specKey];
      if (specs) {
        await rest('POST', 'car_specs', specs.map(s => ({ car_id: carId, ...s })));
      }

      // Insert features
      const features = MODEL_FEATURES[specKey];
      if (features) {
        await rest('POST', 'car_features', features.map(f => ({ car_id: carId, feature: f })));
      }

      inserted++;
      process.stdout.write(`\r   Inserted ${inserted}/${CARS.length}...`);
    } catch (err) {
      errors++;
      console.error(`\n   ❌ ${make} ${model} ${year}: ${err.message}`);
    }
  }

  console.log('');
  console.log('');
  console.log(`✅ Done! ${inserted} cars inserted, ${errors} errors.`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
