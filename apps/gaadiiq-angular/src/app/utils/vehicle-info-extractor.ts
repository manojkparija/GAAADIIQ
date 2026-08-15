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
  // Kannada
  'ಮಾರುತಿ': 'Maruti Suzuki', 'ಹುಂಡೈ': 'Hyundai', 'ಹೋಂಡಾ': 'Honda',
  'ಟಾಟಾ': 'Tata', 'ಮಹೀಂದ್ರಾ': 'Mahindra', 'ಟೊಯೋಟಾ': 'Toyota', 'ಕಿಯಾ': 'Kia',
  // Malayalam
  'മാരുതി': 'Maruti Suzuki', 'ഹ്യുണ്ടായ്': 'Hyundai', 'ഹോണ്ട': 'Honda',
  'ടാറ്റ': 'Tata', 'മഹീന്ദ്ര': 'Mahindra', 'ടൊയോട്ട': 'Toyota', 'കിയ': 'Kia',
  // Gujarati
  'મારુતિ': 'Maruti Suzuki', 'હ્યુન્ડાઇ': 'Hyundai', 'હોન્ડા': 'Honda',
  'ટાટા': 'Tata', 'મહિન્દ્રા': 'Mahindra', 'ટોયોટા': 'Toyota', 'કિયા': 'Kia',
  // Punjabi
  'ਮਾਰੂਤੀ': 'Maruti Suzuki', 'ਹੁੰਡਈ': 'Hyundai', 'ਹੌਂਡਾ': 'Honda',
  'ਟਾਟਾ': 'Tata', 'ਮਹਿੰਦਰਾ': 'Mahindra', 'ਟੋਯੋਟਾ': 'Toyota', 'ਕੀਆ': 'Kia',
  // Odia
  'ମାରୁତି': 'Maruti Suzuki', 'ହୁଣ୍ଡାଇ': 'Hyundai', 'ହୋଣ୍ଡା': 'Honda',
  'ଟାଟା': 'Tata', 'ମହୀନ୍ଦ୍ରା': 'Mahindra', 'ଟୋୟୋଟା': 'Toyota', 'କିଆ': 'Kia',
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
  'পেট্রোল': 'Petrol', 'ডিজেল': 'Diesel', 'সিএনজি': 'CNG', 'ইলেকট্রিক': 'Electric',
  // Tamil
  'பெட்ரோல்': 'Petrol', 'டீசல்': 'Diesel', 'சிஎன்ஜி': 'CNG', 'மின்சார': 'Electric',
  // Telugu
  'పెట్రోల్': 'Petrol', 'డీజిల్': 'Diesel', 'సిఎన్‌జి': 'CNG', 'ఎలక్ట్రిక్': 'Electric',
  // Kannada
  'ಪೆಟ್ರೋಲ್': 'Petrol', 'ಡೀಸೆಲ್': 'Diesel', 'ಸಿಎನ್‌ಜಿ': 'CNG', 'ಎಲೆಕ್ಟ್ರಿಕ್': 'Electric',
  // Malayalam
  'പെട്രോൾ': 'Petrol', 'ഡീസൽ': 'Diesel', 'സിഎൻജി': 'CNG', 'ഇലക്ട്രിക്': 'Electric',
  // Marathi (Devanagari, but spelled differently enough to list)
  'पेट्रोलवर': 'Petrol', 'डिझेल': 'Diesel',
  // Gujarati
  'પેટ્રોલ': 'Petrol', 'ડીઝલ': 'Diesel', 'સીએનજી': 'CNG', 'ઇલેક્ટ્રિક': 'Electric',
  // Punjabi
  'ਪੈਟਰੋਲ': 'Petrol', 'ਡੀਜ਼ਲ': 'Diesel', 'ਸੀਐਨਜੀ': 'CNG', 'ਇਲੈਕਟ੍ਰਿਕ': 'Electric',
  // Odia
  'ପେଟ୍ରୋଲ': 'Petrol', 'ଡିଜେଲ': 'Diesel', 'ସିଏନଜି': 'CNG', 'ଇଲେକ୍ଟ୍ରିକ': 'Electric',
};

const TRANSMISSION_MAP: Record<string, string> = {
  manual: 'Manual', mt: 'Manual', stick: 'Manual', 'gear': 'Manual',
  automatic: 'Automatic', auto: 'Automatic', at: 'Automatic',
  cvt: 'CVT',
  dct: 'DCT', 'dual clutch': 'DCT',
  amt: 'AMT', 'auto gear': 'AMT', 'ags': 'AMT',
  // Hindi / Marathi (Devanagari)
  'मैनुअल': 'Manual', 'मॅन्युअल': 'Manual',
  'ऑटोमैटिक': 'Automatic', 'ऑटोमेटिक': 'Automatic', 'ऑटोमॅटिक': 'Automatic',
  // Bengali
  'ম্যানুয়াল': 'Manual', 'অটোমেটিক': 'Automatic',
  // Tamil
  'மேனுவல்': 'Manual', 'ஆட்டோமேட்டிக்': 'Automatic',
  // Telugu
  'మాన్యువల్': 'Manual', 'ఆటోమేటిక్': 'Automatic',
  // Kannada
  'ಮ್ಯಾನ್ಯುಯಲ್': 'Manual', 'ಆಟೋಮ್ಯಾಟಿಕ್': 'Automatic',
  // Malayalam
  'മാനുവൽ': 'Manual', 'ഓട്ടോമാറ്റിക്': 'Automatic',
  // Gujarati
  'મેન્યુઅલ': 'Manual', 'ઓટોમેટિક': 'Automatic',
  // Punjabi
  'ਮੈਨੂਅਲ': 'Manual', 'ਆਟੋਮੈਟਿਕ': 'Automatic',
  // Odia
  'ମାନୁଆଲ': 'Manual', 'ଅଟୋମେଟିକ': 'Automatic',
};

/**
 * Indic digits → ASCII. `२०१०`, `২০১০` and `௨௦௧௦` all mean 2010, and every
 * parser below counts digits.
 *
 * Each Indic script lays its digits out contiguously from a base codepoint in
 * the order 0-9, so one arithmetic rule covers all nine scripts the language
 * picker offers rather than nine lookup tables.
 */
const DIGIT_BASES = [
  0x0966, // Devanagari — Hindi, Marathi
  0x09e6, // Bengali
  0x0a66, // Gurmukhi — Punjabi
  0x0ae6, // Gujarati
  0x0b66, // Odia
  0x0be6, // Tamil
  0x0c66, // Telugu
  0x0ce6, // Kannada
  0x0d66, // Malayalam
];

export function foldIndicDigits(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const base = DIGIT_BASES.find(b => code >= b && code <= b + 9);
    out += base === undefined ? ch : String(code - base);
  }
  return out;
}

/**
 * Lowercase, fold Indic digits, and strip punctuation.
 *
 * The character class matters more than it looks. This was `[^\w\s]`, and in
 * JavaScript `\w` is `[A-Za-z0-9_]` — it does not mean "word character" in any
 * script beyond Latin. So every Devanagari, Bengali, Tamil, Telugu, Kannada,
 * Malayalam, Gujarati, Gurmukhi and Odia character was replaced by a space,
 * and `normalise('मेरी गाड़ी दो हजार दस मॉडल है')` returned an empty string.
 *
 * That is why voice diagnosis worked in English and nowhere else: every step
 * built on `norm` — the year, the odometer, the whole keyword path — was
 * reading blank text. Make and model survived only because `matchesAny` falls
 * back to the untouched original for non-ASCII keys.
 *
 * `\p{L}\p{M}\p{N}` with the `u` flag means letters, the combining marks that
 * complete them, and numbers, in ANY script. `\p{M}` is not optional: Devanagari
 * vowel signs are combining marks rather than letters, so without it `मेरी`
 * normalises to `म र` — every Indic word silently loses its vowels.
 */
function normalise(text: string): string {
  return foldIndicDigits(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

/**
 * Spoken years in Indian languages.
 *
 * A recogniser set to hi-IN returns "दो हज़ार दस", not "2010" — the same
 * words-not-digits problem English had, in nine more scripts. Rather than a
 * full numeral grammar per language, this covers the one construction years
 * are actually spoken in: <thousands> <hundreds-or-tens> — "two thousand ten",
 * "two thousand fifteen".
 *
 * Only the words needed for 1990-2030 are listed. A year is the only number
 * this function is allowed to produce, so a partial vocabulary cannot make it
 * confidently wrong — it simply returns nothing and the assistant asks.
 */
const INDIC_THOUSAND = [
  'हजार', 'हज़ार',        // Hindi, Marathi
  'হাজার',                 // Bengali
  'ஆயிரம்',                // Tamil
  'వెయ్యి', 'వేల',          // Telugu
  'ಸಾವಿರ',                 // Kannada
  'ആയിരം',                 // Malayalam
  'હજાર',                  // Gujarati
  'ਹਜ਼ਾਰ', 'ਹਜਾਰ',        // Punjabi
  'ହଜାର',                  // Odia
];

/** Number words 0-30 in the scripts the picker offers, mapped to a value. */
const INDIC_NUMBERS: Record<string, number> = {
  // Hindi / Marathi
  'शून्य': 0, 'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5,
  'छह': 6, 'छः': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10, 'ग्यारह': 11,
  'बारह': 12, 'तेरह': 13, 'चौदह': 14, 'पंद्रह': 15, 'सोलह': 16, 'सत्रह': 17,
  'अठारह': 18, 'उन्नीस': 19, 'बीस': 20, 'इक्कीस': 21, 'बाईस': 22, 'तेईस': 23,
  'चौबीस': 24, 'पच्चीस': 25, 'छब्बीस': 26, 'सत्ताईस': 27, 'अट्ठाईस': 28,
  'उनतीस': 29, 'तीस': 30,
  // Bengali
  'এক': 1, 'দুই': 2, 'তিন': 3, 'চার': 4, 'পাঁচ': 5, 'ছয়': 6, 'সাত': 7,
  'আট': 8, 'নয়': 9, 'দশ': 10, 'পনেরো': 15, 'বিশ': 20, 'পঁচিশ': 25,
  // Tamil
  'ஒன்று': 1, 'இரண்டு': 2, 'மூன்று': 3, 'நான்கு': 4, 'ஐந்து': 5, 'ஆறு': 6,
  'ஏழு': 7, 'எட்டு': 8, 'ஒன்பது': 9, 'பத்து': 10, 'பதினைந்து': 15, 'இருபது': 20,
  // Telugu
  'ఒకటి': 1, 'రెండు': 2, 'మూడు': 3, 'నాలుగు': 4, 'ఐదు': 5, 'ఆరు': 6,
  'ఏడు': 7, 'ఎనిమిది': 8, 'తొమ్మిది': 9, 'పది': 10, 'పదిహేను': 15, 'ఇరవై': 20,
  // Kannada
  'ಒಂದು': 1, 'ಎರಡು': 2, 'ಮೂರು': 3, 'ನಾಲ್ಕು': 4, 'ಐದು': 5, 'ಆರು': 6,
  'ಏಳು': 7, 'ಎಂಟು': 8, 'ಒಂಬತ್ತು': 9, 'ಹತ್ತು': 10, 'ಹದಿನೈದು': 15, 'ಇಪ್ಪತ್ತು': 20,
  // Malayalam
  'ഒന്ന്': 1, 'രണ്ട്': 2, 'മൂന്ന്': 3, 'നാല്': 4, 'അഞ്ച്': 5, 'ആറ്': 6,
  'ഏഴ്': 7, 'എട്ട്': 8, 'ഒൻപത്': 9, 'പത്ത്': 10, 'പതിനഞ്ച്': 15, 'ഇരുപത്': 20,
  // Gujarati
  'એક': 1, 'બે': 2, 'ત્રણ': 3, 'ચાર': 4, 'પાંચ': 5, 'છ': 6, 'સાત': 7,
  'આઠ': 8, 'નવ': 9, 'દસ': 10, 'પંદર': 15, 'વીસ': 20,
  // Punjabi
  'ਇੱਕ': 1, 'ਦੋ': 2, 'ਤਿੰਨ': 3, 'ਚਾਰ': 4, 'ਪੰਜ': 5, 'ਛੇ': 6, 'ਸੱਤ': 7,
  'ਅੱਠ': 8, 'ਨੌਂ': 9, 'ਦਸ': 10, 'ਪੰਦਰਾਂ': 15, 'ਵੀਹ': 20,
  // Odia
  'ଏକ': 1, 'ଦୁଇ': 2, 'ତିନି': 3, 'ଚାରି': 4, 'ପାଞ୍ଚ': 5, 'ଛଅ': 6, 'ସାତ': 7,
  'ଆଠ': 8, 'ନଅ': 9, 'ଦଶ': 10, 'ପନ୍ଦର': 15, 'କୋଡ଼ିଏ': 20,
};

/**
 * "दो हज़ार दस" → 2010. Returns undefined when the sentence is not a year
 * spoken in this shape.
 */
function indicSpokenYear(words: string[]): number | undefined {
  const at = words.findIndex(w => INDIC_THOUSAND.includes(w));
  if (at === -1) return undefined;

  const before = words[at - 1];
  const thousands = before !== undefined ? INDIC_NUMBERS[before] : undefined;
  // Only "two thousand ..." makes a year in range; "one thousand" would be
  // 1000-something and "twenty thousand" is an odometer reading.
  if (thousands !== 2) return undefined;

  // The remainder may be one word ("दस" = 10) or absent ("दो हज़ार" = 2000).
  const rest = words.slice(at + 1);
  const tail = rest.length ? INDIC_NUMBERS[rest[0]] : 0;
  if (tail === undefined) return undefined;
  return 2000 + tail;
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

  // 4b. Spoken as words in an Indian language — "दो हज़ार दस".
  const indic = indicSpokenYear(words);
  if (indic !== undefined) {
    const yr = plausible(indic);
    if (yr) return yr;
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

  // Year. Assigned only when found: a present-but-undefined key is
  // indistinguishable from a real value to a spread merge, and that is how a
  // later utterance about fuel type used to erase a year the driver had
  // already given.
  const year = extractYear(norm);
  if (year !== undefined) result.model_year = year;

  // Fuel
  for (const [key, value] of Object.entries(FUEL_MAP)) {
    if (matchesAny(key, norm, orig)) { result.fuel_type = value; break; }
  }

  // Transmission
  for (const [key, value] of Object.entries(TRANSMISSION_MAP)) {
    if (matchesAny(key, norm, orig)) { result.transmission = value; break; }
  }

  // Odometer — parsed from the original text, which still has the separators.
  // Same rule as the year: set it or leave it absent, never present-and-empty.
  const odometer = extractOdometer(orig);
  if (odometer !== undefined) result.odometer_km = odometer;

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
