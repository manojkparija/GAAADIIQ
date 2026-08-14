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

// ── Year ─────────────────────────────────────────────────────────────────────
//
// A speech engine almost never returns "2019" for a spoken year. Chrome's
// recogniser transcribes what it hears as words — "twenty nineteen", "two
// thousand and nineteen", "nineteen ninety eight" — or splits the digits
// ("20 19"). The original parser matched a bare four-digit numeral only, so
// every one of those forms produced no year at all and the assistant asked
// again, which is the loop users were hitting.

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};

/** "ninety eight" → 98, "nineteen" → 19, "eight" → 8. Returns undefined otherwise. */
function wordsToUnder100(words: string[]): number | undefined {
  if (words.length === 0 || words.length > 2) return undefined;
  const [a, b] = words;
  if (words.length === 1) {
    if (a in UNITS) return UNITS[a];
    if (a in TENS) return TENS[a];
    if (/^\d{1,2}$/.test(a)) return parseInt(a, 10);
    return undefined;
  }
  const tens = a in TENS ? TENS[a] : undefined;
  const unit = b in UNITS && UNITS[b] < 10 ? UNITS[b] : /^\d$/.test(b) ? parseInt(b, 10) : undefined;
  if (tens === undefined || unit === undefined) return undefined;
  return tens + unit;
}

/** Units that mark a spoken number as a distance rather than a year. */
const DISTANCE_WORDS = new Set(['km', 'kms', 'kilometer', 'kilometers', 'kilometre', 'kilometres']);

function plausible(yr: number): number | undefined {
  const current = new Date().getFullYear();
  return yr >= 1990 && yr <= current + 1 ? yr : undefined;
}

/**
 * Parse a model year out of a transcript. Handles, in order of confidence:
 * a plain numeral, digits split by the recogniser, "two thousand (and) N",
 * century-word forms ("twenty nineteen", "nineteen ninety eight"), and a bare
 * two-digit year when the sentence makes clear it is one ("2019 model", "'19").
 */
function extractYear(text: string): number | undefined {
  const t = normalise(text);

  // 1. A plain four-digit year.
  const plain = t.match(/\b(19\d{2}|20\d{2})\b/);
  if (plain) {
    const yr = plausible(parseInt(plain[1], 10));
    if (yr) return yr;
  }

  // 2. Digits the recogniser split — "20 19", "19 98".
  const split = t.match(/\b(19|20)\s+(\d{2})\b/);
  if (split) {
    const yr = plausible(parseInt(split[1] + split[2], 10));
    if (yr) return yr;
  }

  const words = t.split(' ');

  // 3. "two thousand", "two thousand nineteen", "two thousand and nineteen".
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i] !== 'two' || words[i + 1] !== 'thousand') continue;
    let rest = words.slice(i + 2);
    if (rest[0] === 'and') rest = rest.slice(1);
    // "two thousand kilometres" is an odometer reading, not the year 2000.
    if (DISTANCE_WORDS.has(rest[0])) continue;
    // Try the longest tail first: "twenty three" before "twenty".
    // A bare "two thousand" only means 2000 when no number follows it —
    // otherwise "two thousand and fifty" would silently degrade to 2000
    // instead of being rejected as implausible.
    const tail = wordsToUnder100(rest.slice(0, 2)) ?? wordsToUnder100(rest.slice(0, 1));
    const yr = plausible(2000 + (tail ?? 0));
    if (yr) return yr;
    if (tail !== undefined) return undefined;  // a year was spoken, and it is not plausible
  }

  // 4. Century-word forms — "twenty nineteen", "twenty twenty three",
  //    "nineteen ninety eight". The first word names the century.
  for (let i = 0; i < words.length; i++) {
    const century = words[i] === 'twenty' ? 2000 : words[i] === 'nineteen' ? 1900 : undefined;
    if (century === undefined) continue;
    for (const take of [2, 1]) {
      const n = wordsToUnder100(words.slice(i + 1, i + 1 + take));
      if (n === undefined) continue;
      const yr = plausible(century + n);
      if (yr) return yr;
    }
    // "twenty twenty" → 2020: the tail repeats the century word.
    if (century === 2000 && words[i + 1] === 'twenty') {
      const yr = plausible(2020);
      if (yr) return yr;
    }
  }

  // 5. A two-digit year, but only where the sentence says it is one —
  //    "19 model", "model 19", "year 19". Without that anchor a stray "19"
  //    is far more likely to be part of a model name (i20, XUV700) or a
  //    quantity than a year.
  const anchored = t.match(/\b(?:year|model|make|mfg|manufactured|registration|reg)\s+(\d{2})\b/)
    ?? t.match(/\b(\d{2})\s+(?:model|make|reg|registration)\b/);
  if (anchored) {
    const two = parseInt(anchored[1], 10);
    const yr = plausible(two >= 90 ? 1900 + two : 2000 + two);
    if (yr) return yr;
  }

  // 6. The same anchored form spoken as words — "model twenty nineteen" is
  //    already covered by 4; this catches "model ninety eight".
  const wordAnchor = words.indexOf('model');
  if (wordAnchor !== -1) {
    for (const take of [2, 1]) {
      const n = wordsToUnder100(words.slice(wordAnchor + 1, wordAnchor + 1 + take));
      if (n === undefined || n < 10) continue;
      const yr = plausible(n >= 90 ? 1900 + n : 2000 + n);
      if (yr) return yr;
    }
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
