/**
 * Client-side NLP utility to extract vehicle details from spoken transcripts.
 * Used as a fast local pass before (optionally) calling the backend Ollama extractor.
 */

export interface ExtractedVehicleInfo {
  manufacturer?: string;
  model?: string;
  variant?: string;
  model_year?: number;
  fuel_type?: string;
  transmission?: string;
  odometer_km?: number;
  missing: string[];
}

const MAKES: Record<string, string> = {
  maruti: 'Maruti Suzuki', suzuki: 'Maruti Suzuki', 'maruti suzuki': 'Maruti Suzuki',
  hyundai: 'Hyundai', honda: 'Honda', tata: 'Tata', mahindra: 'Mahindra',
  toyota: 'Toyota', kia: 'Kia', renault: 'Renault', nissan: 'Nissan',
  volkswagen: 'Volkswagen', vw: 'Volkswagen', skoda: 'Skoda', ford: 'Ford',
  mg: 'MG', 'mg motor': 'MG', jeep: 'Jeep', bmw: 'BMW', mercedes: 'Mercedes-Benz',
  'mercedes benz': 'Mercedes-Benz', audi: 'Audi', volvo: 'Volvo',
  bajaj: 'Bajaj', hero: 'Hero', royal: 'Royal Enfield', 'royal enfield': 'Royal Enfield',
  tvs: 'TVS', yamaha: 'Yamaha', ktm: 'KTM', isuzu: 'Isuzu', force: 'Force Motors',
};

const MODELS: Record<string, string> = {
  swift: 'Swift', baleno: 'Baleno', brezza: 'Brezza', dzire: 'Dzire', alto: 'Alto',
  wagon: 'WagonR', wagonr: 'WagonR', ertiga: 'Ertiga', vitara: 'Vitara Brezza',
  creta: 'Creta', i20: 'i20', venue: 'Venue', alcazar: 'Alcazar', tucson: 'Tucson',
  city: 'City', amaze: 'Amaze', jazz: 'Jazz', wrv: 'WR-V', 'wr-v': 'WR-V',
  nexon: 'Nexon', punch: 'Punch', harrier: 'Harrier', safari: 'Safari', altroz: 'Altroz',
  tiago: 'Tiago', tigor: 'Tigor', curvv: 'Curvv',
  scorpio: 'Scorpio', xuv: 'XUV700', thar: 'Thar', bolero: 'Bolero', 'xuv300': 'XUV300',
  'xuv400': 'XUV400', 'xuv500': 'XUV500', 'xuv700': 'XUV700',
  fortuner: 'Fortuner', innova: 'Innova', camry: 'Camry', yaris: 'Yaris', glanza: 'Glanza',
  seltos: 'Seltos', sonet: 'Sonet', carnival: 'Carnival', carens: 'Carens',
  kwid: 'Kwid', triber: 'Triber', kiger: 'Kiger', duster: 'Duster',
  magnite: 'Magnite', kicks: 'Kicks',
  polo: 'Polo', vento: 'Vento', taigun: 'Taigun', virtus: 'Virtus', tiguan: 'Tiguan',
  octavia: 'Octavia', slavia: 'Slavia', kushaq: 'Kushaq',
  hector: 'Hector', astor: 'Astor', gloster: 'Gloster',
  compass: 'Compass', meridian: 'Meridian',
  pulsar: 'Pulsar', dominar: 'Dominar', avenger: 'Avenger',
  splendor: 'Splendor', passion: 'Passion', xtreme: 'Xtreme',
  bullet: 'Bullet', 'classic 350': 'Classic 350', himalayan: 'Himalayan', meteor: 'Meteor 350',
  apache: 'Apache', jupiter: 'Jupiter', ntorq: 'NTORQ',
  duke: 'Duke', adventure: 'Adventure 390',
};

const FUEL_MAP: Record<string, string> = {
  petrol: 'Petrol', gasoline: 'Petrol', gas: 'Petrol',
  diesel: 'Diesel',
  cng: 'CNG', 'compressed natural gas': 'CNG',
  electric: 'Electric', ev: 'Electric', battery: 'Electric',
  hybrid: 'Hybrid',
  lpg: 'LPG',
};

const TRANSMISSION_MAP: Record<string, string> = {
  manual: 'Manual', mt: 'Manual', stick: 'Manual', 'gear': 'Manual',
  automatic: 'Automatic', auto: 'Automatic', at: 'Automatic',
  cvt: 'CVT',
  dct: 'DCT', 'dual clutch': 'DCT',
  amt: 'AMT', 'auto gear': 'AMT', 'ags': 'AMT',
};

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractYear(text: string): number | undefined {
  const m = text.match(/\b(19[9]\d|20[012]\d)\b/);
  if (m) {
    const yr = parseInt(m[1], 10);
    const current = new Date().getFullYear();
    if (yr >= 1990 && yr <= current + 1) return yr;
  }
  return undefined;
}

function extractOdometer(text: string): number | undefined {
  // "50,000 km", "50000 kms", "50k km", "one lakh km"
  const km = text.match(/(\d[\d,]*)\s*k(?:ms?|ilometers?|ilometres?)/i);
  if (km) return parseInt(km[1].replace(/,/g, ''), 10);
  const kAbbr = text.match(/(\d+)\s*k\b/i);
  if (kAbbr) return parseInt(kAbbr[1], 10) * 1000;
  const lakh = text.match(/(\d+(?:\.\d+)?)\s*lakh/i);
  if (lakh) return Math.round(parseFloat(lakh[1]) * 100000);
  return undefined;
}

export function extractVehicleInfo(transcript: string): ExtractedVehicleInfo {
  const norm = normalise(transcript);
  const result: ExtractedVehicleInfo = { missing: [] };

  // Manufacturer
  for (const [key, value] of Object.entries(MAKES)) {
    if (norm.includes(key)) { result.manufacturer = value; break; }
  }

  // Model
  for (const [key, value] of Object.entries(MODELS)) {
    if (norm.includes(key)) { result.model = value; break; }
  }

  // Year
  result.model_year = extractYear(norm);

  // Fuel
  for (const [key, value] of Object.entries(FUEL_MAP)) {
    if (norm.includes(key)) { result.fuel_type = value; break; }
  }

  // Transmission
  for (const [key, value] of Object.entries(TRANSMISSION_MAP)) {
    if (norm.includes(key)) { result.transmission = value; break; }
  }

  // Odometer
  result.odometer_km = extractOdometer(norm);

  // Required fields check
  const required: Array<keyof ExtractedVehicleInfo> = ['manufacturer', 'model', 'model_year', 'fuel_type', 'transmission'];
  for (const field of required) {
    if (!result[field]) result.missing.push(field);
  }

  return result;
}

/** Detect language from Unicode script ranges. */
export function detectLanguageFromText(text: string): string {
  if (!text || text.length < 3) return 'en-IN';

  const counts: Record<string, number> = {};
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x0900 && cp <= 0x097F) counts['deva'] = (counts['deva'] ?? 0) + 1;
    else if (cp >= 0x0980 && cp <= 0x09FF) counts['beng'] = (counts['beng'] ?? 0) + 1;
    else if (cp >= 0x0B80 && cp <= 0x0BFF) counts['taml'] = (counts['taml'] ?? 0) + 1;
    else if (cp >= 0x0C00 && cp <= 0x0C7F) counts['telu'] = (counts['telu'] ?? 0) + 1;
    else if (cp >= 0x0C80 && cp <= 0x0CFF) counts['knda'] = (counts['knda'] ?? 0) + 1;
    else if (cp >= 0x0D00 && cp <= 0x0D7F) counts['mlym'] = (counts['mlym'] ?? 0) + 1;
    else if (cp >= 0x0A80 && cp <= 0x0AFF) counts['gujr'] = (counts['gujr'] ?? 0) + 1;
    else if (cp >= 0x0A00 && cp <= 0x0A7F) counts['guru'] = (counts['guru'] ?? 0) + 1;
    else if (cp >= 0x0B00 && cp <= 0x0B7F) counts['orya'] = (counts['orya'] ?? 0) + 1;
  }

  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (!dominant || dominant[1] < 2) return 'en-IN';

  const scriptToLang: Record<string, string> = {
    deva: 'hi-IN', beng: 'bn-IN', taml: 'ta-IN', telu: 'te-IN',
    knda: 'kn-IN', mlym: 'ml-IN', gujr: 'gu-IN', guru: 'pa-IN', orya: 'or-IN',
  };

  // Distinguish Marathi vs Hindi (Devanagari) by keyword
  if (dominant[0] === 'deva') {
    const marathi = /\b(माझ|गाडी|आहे|मला|माझी)\b/.test(text);
    return marathi ? 'mr-IN' : 'hi-IN';
  }

  return scriptToLang[dominant[0]] ?? 'en-IN';
}
