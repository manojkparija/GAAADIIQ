/**
 * Shared valuation engine — single source of truth used by both
 * /ai-valuation page and /list-car flow. Identical inputs → identical mid.
 */

export interface Variant { name: string; basePrice: number; }

export interface ValuationResult {
  low: number;
  mid: number;
  high: number;
  confidence: number;
  depreciation: number;
  marketTrend: string;
  tips: string[];
  /** How the estimate was produced */
  method: 'claude' | 'heuristic';
}

// Ex-showroom base prices (₹) keyed by make → model → variants
export const CATALOGUE: Record<string, Record<string, Variant[]>> = {
  'Maruti Suzuki': {
    'Swift':    [{ name:'LXi', basePrice:649000 }, { name:'VXi', basePrice:749000 }, { name:'ZXi', basePrice:849000 }, { name:'ZXi+', basePrice:949000 }],
    'Baleno':   [{ name:'Sigma', basePrice:669000 }, { name:'Delta', basePrice:769000 }, { name:'Zeta', basePrice:869000 }, { name:'Alpha', basePrice:969000 }],
    'Brezza':   [{ name:'LXi', basePrice:799000 }, { name:'VXi', basePrice:949000 }, { name:'ZXi', basePrice:1099000 }, { name:'ZXi+', basePrice:1299000 }],
    'Ertiga':   [{ name:'VXi', basePrice:849000 }, { name:'ZXi', basePrice:1049000 }, { name:'ZXi+', basePrice:1149000 }],
    'Ciaz':     [{ name:'Sigma', basePrice:899000 }, { name:'Delta', basePrice:999000 }, { name:'Zeta', basePrice:1099000 }, { name:'Alpha', basePrice:1199000 }],
    'Alto K10': [{ name:'STD', basePrice:349000 }, { name:'LXi', basePrice:399000 }, { name:'VXi', basePrice:449000 }],
    'WagonR':   [{ name:'LXi', basePrice:549000 }, { name:'VXi', basePrice:649000 }, { name:'ZXi', basePrice:749000 }],
    'Dzire':    [{ name:'LXi', basePrice:649000 }, { name:'VXi', basePrice:749000 }, { name:'ZXi', basePrice:849000 }, { name:'ZXi+', basePrice:949000 }],
    'S-Presso': [{ name:'STD', basePrice:399000 }, { name:'LXi', basePrice:449000 }, { name:'VXi', basePrice:499000 }],
    'Celerio':  [{ name:'LXi', basePrice:549000 }, { name:'VXi', basePrice:649000 }, { name:'ZXi', basePrice:749000 }],
    'Ignis':    [{ name:'Sigma', basePrice:599000 }, { name:'Delta', basePrice:699000 }, { name:'Zeta', basePrice:799000 }, { name:'Alpha', basePrice:899000 }],
    'Fronx':    [{ name:'Sigma', basePrice:749000 }, { name:'Delta', basePrice:849000 }, { name:'Zeta', basePrice:999000 }, { name:'Alpha', basePrice:1149000 }],
    'Grand Vitara': [{ name:'Sigma', basePrice:1069000 }, { name:'Delta', basePrice:1299000 }, { name:'Zeta', basePrice:1449000 }, { name:'Alpha', basePrice:1699000 }],
    'Jimny':    [{ name:'Zeta', basePrice:1249000 }, { name:'Alpha', basePrice:1499000 }],
  },
  'Hyundai': {
    'Creta':    [{ name:'E', basePrice:1099000 }, { name:'S', basePrice:1299000 }, { name:'S(O)', basePrice:1399000 }, { name:'SX', basePrice:1699000 }, { name:'SX(O)', basePrice:1999000 }],
    'Venue':    [{ name:'E', basePrice:799000 }, { name:'S', basePrice:949000 }, { name:'S+', basePrice:1049000 }, { name:'SX', basePrice:1249000 }, { name:'SX(O)', basePrice:1449000 }],
    'i20':      [{ name:'Magna', basePrice:749000 }, { name:'Sportz', basePrice:899000 }, { name:'Asta', basePrice:1049000 }, { name:'Asta(O)', basePrice:1149000 }],
    'Verna':    [{ name:'EX', basePrice:1099000 }, { name:'S', basePrice:1299000 }, { name:'SX', basePrice:1599000 }, { name:'SX(O)', basePrice:1799000 }],
    'Alcazar':  [{ name:'Prestige', basePrice:1699000 }, { name:'Platinum', basePrice:1999000 }, { name:'Signature', basePrice:2099000 }],
    'Tucson':   [{ name:'Platinum', basePrice:2999000 }, { name:'Signature', basePrice:3399000 }],
    'Grand i10 Nios': [{ name:'Era', basePrice:549000 }, { name:'Magna', basePrice:649000 }, { name:'Sportz', basePrice:749000 }, { name:'Asta', basePrice:849000 }],
    'Aura':     [{ name:'E', basePrice:699000 }, { name:'S', basePrice:799000 }, { name:'SX', basePrice:899000 }],
    'Exter':    [{ name:'EX', basePrice:599000 }, { name:'S', basePrice:749000 }, { name:'SX', basePrice:899000 }],
  },
  'Tata': {
    'Nexon':    [{ name:'Smart', basePrice:799000 }, { name:'Pure', basePrice:899000 }, { name:'Creative', basePrice:1149000 }, { name:'Fearless', basePrice:1299000 }, { name:'Fearless+', basePrice:1499000 }],
    'Punch':    [{ name:'Pure', basePrice:599000 }, { name:'Adventure', basePrice:699000 }, { name:'Accomplished', basePrice:799000 }, { name:'Creative', basePrice:899000 }],
    'Harrier':  [{ name:'Smart', basePrice:1499000 }, { name:'Pure', basePrice:1699000 }, { name:'Adventure', basePrice:1899000 }, { name:'Fearless', basePrice:2099000 }, { name:'Fearless+', basePrice:2299000 }],
    'Safari':   [{ name:'Smart', basePrice:1599000 }, { name:'Pure+', basePrice:1899000 }, { name:'Adventure+', basePrice:2099000 }, { name:'Accomplished+', basePrice:2399000 }],
    'Tigor':    [{ name:'XE', basePrice:599000 }, { name:'XM', basePrice:699000 }, { name:'XZ', basePrice:799000 }, { name:'XZ+', basePrice:899000 }],
    'Tiago':    [{ name:'XE', basePrice:499000 }, { name:'XM', basePrice:549000 }, { name:'XT', basePrice:649000 }, { name:'XZ', basePrice:749000 }, { name:'XZ+', basePrice:849000 }],
    'Altroz':   [{ name:'XE', basePrice:699000 }, { name:'XM', basePrice:799000 }, { name:'XT', basePrice:899000 }, { name:'XZ', basePrice:999000 }, { name:'XZ+', basePrice:1099000 }],
    'Nexon EV': [{ name:'Medium Range', basePrice:1449900 }, { name:'Long Range', basePrice:1699900 }, { name:'Max LR', basePrice:1999900 }],
  },
  'Mahindra': {
    'Scorpio N':  [{ name:'Z2', basePrice:1349000 }, { name:'Z4', basePrice:1549000 }, { name:'Z6', basePrice:1799000 }, { name:'Z8', basePrice:2099000 }, { name:'Z8 L', basePrice:2399000 }],
    'XUV700':     [{ name:'MX', basePrice:1399000 }, { name:'AX3', basePrice:1799000 }, { name:'AX5', basePrice:1999000 }, { name:'AX7', basePrice:2299000 }, { name:'AX7 L', basePrice:2599000 }],
    'Thar':       [{ name:'AX (O) STD', basePrice:1099000 }, { name:'AX (O)', basePrice:1399000 }, { name:'LX', basePrice:1599000 }],
    'XUV300':     [{ name:'W4', basePrice:799000 }, { name:'W6', basePrice:949000 }, { name:'W8', basePrice:1149000 }, { name:'W8(O)', basePrice:1249000 }],
    'Bolero':     [{ name:'B2', basePrice:949000 }, { name:'B4', basePrice:1049000 }, { name:'B6', basePrice:1099000 }],
    'Scorpio Classic': [{ name:'S', basePrice:1149000 }, { name:'S11', basePrice:1299000 }],
    'BE 6':       [{ name:'Pack One', basePrice:1899000 }, { name:'Pack Two', basePrice:2099000 }, { name:'Pack Three', basePrice:2399000 }],
  },
  'Honda': {
    'City':       [{ name:'SV', basePrice:1199000 }, { name:'V', basePrice:1399000 }, { name:'VX', basePrice:1549000 }, { name:'ZX', basePrice:1699000 }],
    'Amaze':      [{ name:'E', basePrice:749000 }, { name:'S', basePrice:899000 }, { name:'V', basePrice:999000 }, { name:'VX', basePrice:1099000 }],
    'Elevate':    [{ name:'SV', basePrice:1099000 }, { name:'V', basePrice:1349000 }, { name:'VX', basePrice:1549000 }, { name:'ZX', basePrice:1699000 }],
    'Jazz':       [{ name:'V', basePrice:799000 }, { name:'VX', basePrice:899000 }, { name:'ZX', basePrice:999000 }],
    'WR-V':       [{ name:'S', basePrice:899000 }, { name:'V', basePrice:1049000 }, { name:'VX', basePrice:1149000 }],
  },
  'Toyota': {
    'Innova Crysta':  [{ name:'GX', basePrice:1899000 }, { name:'VX', basePrice:2199000 }, { name:'ZX', basePrice:2499000 }],
    'Innova HyCross': [{ name:'G', basePrice:1899000 }, { name:'GX', basePrice:2199000 }, { name:'VX', basePrice:2499000 }, { name:'ZX', basePrice:2899000 }],
    'Fortuner':       [{ name:'2WD MT', basePrice:3299000 }, { name:'2WD AT', basePrice:3599000 }, { name:'4WD AT', basePrice:3999000 }, { name:'Legender', basePrice:4499000 }],
    'Glanza':         [{ name:'E', basePrice:649000 }, { name:'S', basePrice:749000 }, { name:'G', basePrice:849000 }, { name:'V', basePrice:949000 }],
    'Urban Cruiser HyRyder': [{ name:'E', basePrice:1099000 }, { name:'S', basePrice:1299000 }, { name:'G', basePrice:1499000 }, { name:'V', basePrice:1699000 }],
    'Camry': [{ name:'Hybrid', basePrice:4799000 }],
  },
  'Kia': {
    'Seltos':  [{ name:'HTK', basePrice:1099000 }, { name:'HTK+', basePrice:1299000 }, { name:'HTX', basePrice:1499000 }, { name:'HTX+', basePrice:1699000 }, { name:'GTX+', basePrice:1999000 }],
    'Sonet':   [{ name:'HTE', basePrice:799000 }, { name:'HTK', basePrice:949000 }, { name:'HTK+', basePrice:1099000 }, { name:'HTX', basePrice:1249000 }, { name:'GTX+', basePrice:1449000 }],
    'Carens':  [{ name:'Premium', basePrice:1099000 }, { name:'Prestige', basePrice:1299000 }, { name:'Prestige+', basePrice:1499000 }, { name:'Luxury', basePrice:1699000 }],
    'EV6':     [{ name:'GT Line RWD', basePrice:5999000 }, { name:'GT Line AWD', basePrice:6999000 }],
  },
  'MG Motor': {
    'Hector':  [{ name:'Style', basePrice:1399000 }, { name:'Super', basePrice:1599000 }, { name:'Smart', basePrice:1799000 }, { name:'Sharp', basePrice:1999000 }, { name:'Savvy', basePrice:2199000 }],
    'Astor':   [{ name:'Style', basePrice:999000 }, { name:'Super', basePrice:1199000 }, { name:'Smart', basePrice:1399000 }, { name:'Sharp', basePrice:1599000 }],
    'ZS EV':   [{ name:'Excite', basePrice:2199000 }, { name:'Exclusive', basePrice:2499000 }],
    'Gloster': [{ name:'Super', basePrice:3399000 }, { name:'Sharp', basePrice:3599000 }, { name:'Savvy', basePrice:3899000 }],
  },
  'Volkswagen': {
    'Taigun':  [{ name:'Comfortline', basePrice:1149000 }, { name:'Highline', basePrice:1399000 }, { name:'Topline', basePrice:1649000 }, { name:'GT', basePrice:1899000 }],
    'Virtus':  [{ name:'Comfortline', basePrice:1149000 }, { name:'Highline', basePrice:1349000 }, { name:'Topline', basePrice:1649000 }, { name:'GT', basePrice:1849000 }],
    'Polo':    [{ name:'Trendline', basePrice:649000 }, { name:'Comfortline', basePrice:799000 }, { name:'Highline', basePrice:899000 }, { name:'GT TSI', basePrice:999000 }],
  },
  'Skoda': {
    'Kushaq':  [{ name:'Active', basePrice:1149000 }, { name:'Ambition', basePrice:1399000 }, { name:'Style', basePrice:1699000 }, { name:'Monte Carlo', basePrice:1899000 }],
    'Slavia':  [{ name:'Active', basePrice:1149000 }, { name:'Ambition', basePrice:1349000 }, { name:'Style', basePrice:1649000 }, { name:'Monte Carlo', basePrice:1849000 }],
    'Octavia': [{ name:'Style', basePrice:2699000 }, { name:'Style Plus', basePrice:2899000 }],
    'Superb':  [{ name:'L&K', basePrice:3499000 }],
  },
  'Renault': {
    'Kwid':    [{ name:'STD', basePrice:449000 }, { name:'RXE', basePrice:549000 }, { name:'RXT', basePrice:649000 }, { name:'RXT(O)', basePrice:699000 }],
    'Triber':  [{ name:'RXE', basePrice:599000 }, { name:'RXL', basePrice:699000 }, { name:'RXT', basePrice:799000 }, { name:'RXZ', basePrice:899000 }],
    'Kiger':   [{ name:'RXE', basePrice:599000 }, { name:'RXL', basePrice:699000 }, { name:'RXT', basePrice:849000 }, { name:'RXZ', basePrice:949000 }],
  },
  'Nissan': {
    'Magnite': [{ name:'XE', basePrice:599000 }, { name:'XL', basePrice:699000 }, { name:'XV', basePrice:849000 }, { name:'XV Premium', basePrice:949000 }, { name:'Kuro', basePrice:1049000 }],
    'Kicks':   [{ name:'XL', basePrice:999000 }, { name:'XV', basePrice:1199000 }, { name:'XV Premium', basePrice:1399000 }],
  },
  'BMW': {
    '3 Series':  [{ name:'320i', basePrice:4699000 }, { name:'330i', basePrice:5499000 }, { name:'M340i', basePrice:6999000 }],
    '5 Series':  [{ name:'520i', basePrice:6499000 }, { name:'530i', basePrice:7499000 }, { name:'530d', basePrice:7999000 }],
    'X1':        [{ name:'sDrive18i', basePrice:4599000 }, { name:'xDrive20i', basePrice:5499000 }],
    'X3':        [{ name:'xDrive20i', basePrice:6999000 }, { name:'xDrive30i', basePrice:7999000 }, { name:'M Sport', basePrice:8999000 }],
    'X5':        [{ name:'xDrive40i', basePrice:9399000 }, { name:'xDrive30d', basePrice:9799000 }, { name:'M50i', basePrice:13999000 }],
  },
  'Mercedes-Benz': {
    'C-Class':  [{ name:'C 200', basePrice:5599000 }, { name:'C 220d', basePrice:5999000 }, { name:'C 300', basePrice:6799000 }],
    'E-Class':  [{ name:'E 200', basePrice:7599000 }, { name:'E 220d', basePrice:7999000 }, { name:'E 350', basePrice:9099000 }],
    'GLA':      [{ name:'200d', basePrice:4999000 }, { name:'220d', basePrice:5499000 }],
    'GLC':      [{ name:'220d', basePrice:6799000 }, { name:'300d', basePrice:7499000 }],
    'GLE':      [{ name:'300d', basePrice:9299000 }, { name:'400d', basePrice:11499000 }],
  },
  'Audi': {
    'A4':   [{ name:'Premium', basePrice:4399000 }, { name:'Premium Plus', basePrice:4899000 }, { name:'Technology', basePrice:5399000 }],
    'A6':   [{ name:'Premium', basePrice:5999000 }, { name:'Technology', basePrice:6699000 }],
    'Q3':   [{ name:'Premium', basePrice:4399000 }, { name:'Premium Plus', basePrice:4799000 }, { name:'Technology', basePrice:5299000 }],
    'Q5':   [{ name:'Premium', basePrice:5899000 }, { name:'Premium Plus', basePrice:6499000 }, { name:'Technology', basePrice:7199000 }],
    'Q7':   [{ name:'Premium', basePrice:8299000 }, { name:'Technology', basePrice:8999000 }],
  },
};

// Segment-level fallback when make+model not in CATALOGUE
const SEGMENT_BASE: Record<string, number> = {
  'BMW': 5000000, 'Mercedes-Benz': 6000000, 'Audi': 5000000,
  'Toyota': 1800000, 'Honda': 1200000, 'Hyundai': 1200000,
  'Kia': 1200000, 'MG Motor': 1500000, 'Tata': 900000,
  'Mahindra': 1200000, 'Maruti Suzuki': 750000, 'Skoda': 1500000,
  'Volkswagen': 1300000, 'Renault': 700000, 'Nissan': 800000,
};

export interface ComputeParams {
  make: string;
  model: string;
  variant?: string;
  year: number | string;
  km: number | string;
  fuel: string;
  transmission?: string;
  owners: string;  // '1st Owner' | '2nd Owner' | ...
  condition: string; // 'Excellent' | 'Good' | 'Fair' | 'Needs Work'
}

/**
 * HOW THIS CURVE WAS SET
 *
 * From three cars actually on sale in New Town, Kolkata in August 2026, against
 * today's ex-showroom price of the same variant:
 *
 *     2022 Swift VXi AMT, 21,000 km   Rs 5.31L   69% retained at 4 years
 *     2018 Swift LXi,     29,000 km   Rs 3.59L   55% retained at 8 years
 *     2014 Swift VXi,     33,500 km   Rs 2.90L   39% retained at 12 years
 *
 * A flat 7.5% a year fits all three within 6% on its own. With the first-year
 * cliff below applied as well, the ongoing rate has to come down to 7.0% or
 * the two together undershoot every point — which they did on the first
 * attempt, by 2%, 11% and 7%. At 7.0% the three land within about 7%, with the
 * error no longer all in one direction.
 *
 * That is a small sample and one model, so it is a starting point rather than
 * a calibration — but it is measured, which the previous curve was not.
 *
 * WHAT THE PREVIOUS MODEL GOT WRONG
 *
 * It subtracted flat percentage points of the original price (15% for year one,
 * 10% a year to year five, 7% after) and capped the total at 75%. Three
 * consequences, all of them visible in the numbers above:
 *
 *   - It valued those three cars 20%, 55% and 36% BELOW what they are on sale
 *     for. A seller was being told their car was worth roughly half of what a
 *     dealer three kilometres away was asking.
 *   - Past the cap, age stopped mattering at all: a 2006 and a 2018 Swift came
 *     out identical, and because the cap made trim the only remaining
 *     difference, the 2018 LXi valued Rs 25,000 BELOW the older 2014 VXi.
 *   - The kilometre and owner penalties were subtracted outside the cap, so
 *     they could push the total past 100% — a 2012 Swift with 4 lakh km
 *     returned MINUS Rs 55,000.
 */
const DEPRECIATION_PER_YEAR = 0.070;

/**
 * The drive-off drop, which no compounding rate captures.
 *
 * A car loses more in its first year than in any later one, and the three
 * measured cars are all four years or older, so they say nothing about it.
 * 15% is the conventional figure and is applied to year one alone; the
 * measured rate takes over afterwards.
 */
const FIRST_YEAR_DROP = 0.15;

/** A running car is never worth nothing, whatever the curve says. */
const FLOOR_FRACTION = 0.08;

/**
 * What a private seller gets, as a fraction of what a dealer asks.
 *
 * The prices this curve is fitted to are dealer asking prices — reconditioned,
 * warrantied, sitting in a showroom. A private seller has none of that, and
 * quoting them the dealer's number as "what your car is worth" sets them up to
 * list high and sell nothing.
 */
const PRIVATE_SALE_FRACTION = 0.85;

/** Priced to go quickly, rather than to wait for the right buyer. */
const QUICK_SALE_FRACTION = 0.75;

/** The Indian norm, and what the condition score assumes too. */
const EXPECTED_KM_PER_YEAR = 15000;

/** Fraction of the new price still held after `age` years. */
function retainedFraction(age: number): number {
  if (age <= 0) return 1;
  const afterFirstYear = 1 - FIRST_YEAR_DROP;
  return afterFirstYear * (1 - DEPRECIATION_PER_YEAR) ** (age - 1);
}

export function computeHeuristicValuation(p: ComputeParams): ValuationResult {
  const age = new Date().getFullYear() - +p.year;
  const km = +p.km;

  const variantEntry = CATALOGUE[p.make]?.[p.model]?.find(v => v.name === p.variant);
  // Use mid-variant base if no variant selected
  const modelVariants = CATALOGUE[p.make]?.[p.model];
  const midVariant = modelVariants ? modelVariants[Math.floor(modelVariants.length / 2)] : undefined;
  const base = variantEntry?.basePrice ?? midVariant?.basePrice ?? SEGMENT_BASE[p.make] ?? 900000;

  // Depreciation, compounding on what is left rather than subtracting flat
  // percentage points of the original price. See DEPRECIATION_PER_YEAR and
  // FIRST_YEAR_DROP above for where the rates come from and what the old model
  // got wrong.
  const retained = retainedFraction(age);

  // Mileage: judged against what this car should have covered by now. Also a
  // multiplier, so it cannot eat the whole value on its own — as an additive
  // penalty outside the cap it was what pushed high-km cars below zero.
  const expectedKm = Math.max(EXPECTED_KM_PER_YEAR, age * EXPECTED_KM_PER_YEAR);
  const kmExcess = Math.max(0, (km - expectedKm) / expectedKm);
  const kmMod = Math.max(0.6, 1 - kmExcess * 0.18);

  const ownerMod = p.owners === '1st Owner' ? 1.0
    : p.owners === '2nd Owner' ? 0.95
    : p.owners === '3rd Owner' ? 0.90 : 0.85;

  const condMod = p.condition === 'Excellent' ? 1.05
    : p.condition === 'Good' ? 1.0
    : p.condition === 'Fair' ? 0.92 : 0.82;

  const fuelMod = p.fuel === 'Electric' ? 1.08
    : p.fuel === 'Hybrid' ? 1.04
    : p.fuel === 'CNG' ? 0.96 : 1.0;

  const transMod = p.transmission === 'Automatic' || p.transmission === 'DCT' ? 1.03 : 1.0;

  // Every adjustment is a multiplier now, so the result cannot go negative
  // however many of them apply. The floor is the other half of that promise:
  // a running car is never worth nothing.
  const dealerRetail = base * retained * kmMod * ownerMod * condMod * fuelMod * transMod;
  const floored = Math.max(dealerRetail, base * FLOOR_FRACTION);

  // The headline is what a private seller would realistically get, not what a
  // dealer asks. See PRIVATE_SALE_FRACTION.
  const mid  = Math.round(floored * PRIVATE_SALE_FRACTION / 1000) * 1000;
  const low  = Math.round(floored * QUICK_SALE_FRACTION / 1000) * 1000;
  const high = Math.round(floored / 1000) * 1000;
  const depPct = Math.round((1 - floored / base) * 100);

  // Deterministic confidence — no Math.random()
  const confidence = variantEntry ? 82 : midVariant ? 74 : 65;

  const tips: string[] = [];
  if (km > 80000) tips.push('High mileage — a complete service record boosts buyer confidence significantly.');
  if (age >= 5) tips.push('A paint polish and interior detailing can improve first impression and price.');
  if (p.owners !== '1st Owner') tips.push('Highlight any warranties or extended service packages in your listing.');
  if (p.condition !== 'Excellent') tips.push('Minor dent/scratch repairs can add ₹20–40k to your selling price.');
  if (tips.length === 0) tips.push('Your car is in great shape — list at the high end of the range!');

  const marketTrend = p.fuel === 'Electric' ? '📈 EVs in strong demand right now'
    : p.fuel === 'Diesel' ? '📉 Diesel resale softening in metros'
    : p.fuel === 'CNG' ? '📈 CNG cars popular due to low running costs'
    : '➡️ Petrol market is stable';

  return { low, mid, high, confidence, depreciation: depPct, marketTrend, tips, method: 'heuristic' };
}
