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
  // English
  maruti: 'Maruti Suzuki', suzuki: 'Maruti Suzuki', 'maruti suzuki': 'Maruti Suzuki',
  hyundai: 'Hyundai', honda: 'Honda', tata: 'Tata', mahindra: 'Mahindra',
  toyota: 'Toyota', kia: 'Kia', renault: 'Renault', nissan: 'Nissan',
  volkswagen: 'Volkswagen', vw: 'Volkswagen', skoda: 'Skoda', ford: 'Ford',
  mg: 'MG', 'mg motor': 'MG', jeep: 'Jeep', bmw: 'BMW', mercedes: 'Mercedes-Benz',
  'mercedes benz': 'Mercedes-Benz', audi: 'Audi', volvo: 'Volvo',
  bajaj: 'Bajaj', hero: 'Hero', royal: 'Royal Enfield', 'royal enfield': 'Royal Enfield',
  tvs: 'TVS', yamaha: 'Yamaha', ktm: 'KTM', isuzu: 'Isuzu', force: 'Force Motors',
  // Hindi (Devanagari)
  'मारुति': 'Maruti Suzuki', 'मारुती': 'Maruti Suzuki', 'मारुति सुजुकी': 'Maruti Suzuki',
  'मारुती सुजुकी': 'Maruti Suzuki', 'सुजुकी': 'Maruti Suzuki',
  'हुंडई': 'Hyundai', 'ह्युंडई': 'Hyundai',
  'होंडा': 'Honda', 'हौंडा': 'Honda',
  'टाटा': 'Tata',
  'महिंद्रा': 'Mahindra', 'महींद्रा': 'Mahindra',
  'टोयोटा': 'Toyota', 'टोयोटो': 'Toyota',
  'किआ': 'Kia', 'केआ': 'Kia',
  'रेनो': 'Renault', 'रेनॉल्ट': 'Renault',
  'निसान': 'Nissan',
  'फोर्ड': 'Ford',
  'जीप': 'Jeep',
  'बीएमडब्ल्यू': 'BMW',
  'मर्सिडीज': 'Mercedes-Benz', 'मर्सडीज': 'Mercedes-Benz',
  'ऑडी': 'Audi',
  'स्कोडा': 'Skoda',
  'वोक्सवैगन': 'Volkswagen',
  'एमजी': 'MG',
  'बजाज': 'Bajaj',
  'यामाहा': 'Yamaha',
  'हीरो': 'Hero',
  'रॉयल एनफील्ड': 'Royal Enfield', 'रॉयल': 'Royal Enfield',
  // Tamil
  'மாருதி': 'Maruti Suzuki', 'சுசுகி': 'Maruti Suzuki',
  'ஹூண்டாய்': 'Hyundai', 'ஹோண்டா': 'Honda', 'டாடா': 'Tata',
  'மஹிந்திரா': 'Mahindra', 'டொயோட்டா': 'Toyota', 'கியா': 'Kia',
  // Bengali
  'মারুতি': 'Maruti Suzuki', 'হুন্ডাই': 'Hyundai', 'হোন্ডা': 'Honda',
  'টাটা': 'Tata', 'মাহিন্দ্রা': 'Mahindra', 'টয়োটা': 'Toyota',
  // Telugu
  'మారుతి': 'Maruti Suzuki', 'హ్యుండాయ్': 'Hyundai', 'హోండా': 'Honda',
  'టాటా': 'Tata', 'మహీంద్రా': 'Mahindra', 'టొయోటా': 'Toyota',
};

const MODELS: Record<string, string> = {
  // English
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
  // Hindi model names
  'स्विफ्ट': 'Swift', 'बलेनो': 'Baleno', 'ब्रेजा': 'Brezza', 'डिजायर': 'Dzire',
  'अल्टो': 'Alto', 'वैगनआर': 'WagonR', 'एर्टिगा': 'Ertiga',
  'क्रेटा': 'Creta', 'वेन्यू': 'Venue', 'नेक्सन': 'Nexon', 'पंच': 'Punch',
  'हैरियर': 'Harrier', 'सफारी': 'Safari', 'स्कॉर्पियो': 'Scorpio',
  'थार': 'Thar', 'बोलेरो': 'Bolero', 'फॉर्च्यूनर': 'Fortuner', 'इनोवा': 'Innova',
  'सिटी': 'City', 'अमेज': 'Amaze', 'सेल्टोस': 'Seltos', 'सोनेट': 'Sonet',
  // Bengali model names
  'সুইফট': 'Swift', 'বালেনো': 'Baleno', 'ব্রেজা': 'Brezza',
  'ক্রেটা': 'Creta', 'নেক্সন': 'Nexon', 'পাঞ্চ': 'Punch',
  // Tamil model names
  'ஸ்விஃப்ட்': 'Swift', 'க்ரெட்டா': 'Creta', 'நெக்ஸான்': 'Nexon',
};

const FUEL_MAP: Record<string, string> = {
  petrol: 'Petrol', gasoline: 'Petrol', gas: 'Petrol',
  diesel: 'Diesel',
  cng: 'CNG', 'compressed natural gas': 'CNG',
  electric: 'Electric', ev: 'Electric', battery: 'Electric',
  hybrid: 'Hybrid',
  lpg: 'LPG',
  // Hindi
  'पेट्रोल': 'Petrol', 'डीजल': 'Diesel', 'सीएनजी': 'CNG',
  'इलेक्ट्रिक': 'Electric', 'हाइब्रिड': 'Hybrid',
  // Bengali
  'পেট্রোল': 'Petrol', 'ডিজেল': 'Diesel',
  // Tamil
  'பெட்ரோல்': 'Petrol', 'டீசல்': 'Diesel',
};

const TRANSMISSION_MAP: Record<string, string> = {
  manual: 'Manual', mt: 'Manual', stick: 'Manual', 'gear': 'Manual',
  automatic: 'Automatic', auto: 'Automatic', at: 'Automatic',
  cvt: 'CVT',
  dct: 'DCT', 'dual clutch': 'DCT',
  amt: 'AMT', 'auto gear': 'AMT', 'ags': 'AMT',
  // Hindi
  'मैनुअल': 'Manual', 'ऑटोमैटिक': 'Automatic', 'ऑटोमेटिक': 'Automatic',
  // Bengali
  'ম্যানুয়াল': 'Manual', 'অটোমেটিক': 'Automatic',
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

/**
 * Parse an odometer reading. Must be given the ORIGINAL transcript, not the
 * normalised one: normalise() strips the separators these patterns depend on,
 * turning "1,20,000" into "1 20 000" and "1.5 lakh" into "1 5 lakh".
 */
function extractOdometer(text: string): number | undefined {
  // Lakh first — "1.5 lakh km" also matches the plain-km pattern below,
  // which would read it as 5 km.
  const lakh = text.match(/(\d+(?:\.\d+)?)\s*lakh/i);
  if (lakh) return Math.round(parseFloat(lakh[1]) * 100000);
  // "50,000 km" / "1,20,000 kms" / "50000 kilometres" — Indian digit grouping included.
  const km = text.match(/(\d[\d,]*)\s*k(?:ms?\b|ilometers?|ilometres?)/i);
  if (km) return parseInt(km[1].replace(/,/g, ''), 10);
  // "45k" shorthand
  const kAbbr = text.match(/(\d+)\s*k\b/i);
  if (kAbbr) return parseInt(kAbbr[1], 10) * 1000;
  return undefined;
}

/**
 * Match a dictionary key against the transcript.
 *
 * ASCII keys are matched on whole-word boundaries — a naive substring test
 * makes short keys catastrophically greedy ("at" matches inside "weather",
 * "gas" inside "gasket"). Non-ASCII keys are matched against the original
 * text, since normalise() strips non-Latin scripts entirely, and are compared
 * as plain substrings because JS \b is defined over ASCII word characters and
 * never fires between Indic codepoints.
 */
function matchesAny(key: string, norm: string, original: string): boolean {
  if (/^[\x00-\x7F]+$/.test(key)) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\s)${escaped}($|\\s)`, 'i').test(norm);
  }
  return original.includes(key);
}

export function extractVehicleInfo(transcript: string): ExtractedVehicleInfo {
  const norm = normalise(transcript);
  const orig = transcript; // keep original for script-aware matching
  const result: ExtractedVehicleInfo = { missing: [] };

  // Manufacturer — try longer keys first (e.g. "मारुति सुजुकी" before "मारुति")
  const makeKeys = Object.keys(MAKES).sort((a, b) => b.length - a.length);
  for (const key of makeKeys) {
    if (matchesAny(key, norm, orig)) { result.manufacturer = MAKES[key]; break; }
  }

  // Model — longer keys first
  const modelKeys = Object.keys(MODELS).sort((a, b) => b.length - a.length);
  for (const key of modelKeys) {
    if (matchesAny(key, norm, orig)) { result.model = MODELS[key]; break; }
  }

  // Year
  result.model_year = extractYear(norm);

  // Fuel
  for (const [key, value] of Object.entries(FUEL_MAP)) {
    if (matchesAny(key, norm, orig)) { result.fuel_type = value; break; }
  }

  // Transmission
  for (const [key, value] of Object.entries(TRANSMISSION_MAP)) {
    if (matchesAny(key, norm, orig)) { result.transmission = value; break; }
  }

  // Odometer — parsed from the original text, which still has the separators.
  result.odometer_km = extractOdometer(orig);

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

  // Hindi and Marathi share the Devanagari script, so separate them on
  // vocabulary. \b is not usable here — it is defined over ASCII word
  // characters and never matches between Devanagari codepoints — so these are
  // plain substring probes on markers that are distinctively Marathi.
  // "गाडी" is deliberately excluded: it is common to both languages.
  if (dominant[0] === 'deva') {
    const MARATHI_MARKERS = ['माझ', 'आहे', 'मला', 'तुमच', 'नाही', 'आणि', 'येतो', 'काय'];
    return MARATHI_MARKERS.some(m => text.includes(m)) ? 'mr-IN' : 'hi-IN';
  }

  return scriptToLang[dominant[0]] ?? 'en-IN';
}
