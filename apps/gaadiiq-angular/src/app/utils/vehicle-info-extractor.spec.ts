import { extractVehicleInfo, detectLanguageFromText } from './vehicle-info-extractor';

describe('extractVehicleInfo', () => {

  describe('English transcripts', () => {
    it('extracts every field from a full spoken sentence', () => {
      const r = extractVehicleInfo(
        'I have a 2024 Maruti Suzuki Swift petrol manual, it has run 18500 kilometers'
      );
      expect(r.manufacturer).toBe('Maruti Suzuki');
      expect(r.model).toBe('Swift');
      expect(r.model_year).toBe(2024);
      expect(r.fuel_type).toBe('Petrol');
      expect(r.transmission).toBe('Manual');
      expect(r.odometer_km).toBe(18500);
      expect(r.missing).toEqual([]);
    });

    it('reports only the fields that are genuinely absent', () => {
      const r = extractVehicleInfo('Hyundai Creta diesel');
      expect(r.manufacturer).toBe('Hyundai');
      expect(r.model).toBe('Creta');
      expect(r.fuel_type).toBe('Diesel');
      expect(r.missing).toContain('model_year');
      expect(r.missing).toContain('transmission');
      expect(r.missing).not.toContain('manufacturer');
    });

    it('returns all required fields as missing for unrelated speech', () => {
      const r = extractVehicleInfo('the weather is quite nice today');
      expect(r.missing).toEqual([
        'manufacturer', 'model', 'model_year', 'fuel_type', 'transmission',
      ]);
    });

    it('is case-insensitive', () => {
      expect(extractVehicleInfo('TATA NEXON').manufacturer).toBe('Tata');
      expect(extractVehicleInfo('tata nexon').model).toBe('Nexon');
    });
  });

  describe('Devanagari / Indic transcripts', () => {
    it('extracts a Hindi brand name', () => {
      // Regression: normalise() used to strip non-Latin characters, so
      // Devanagari brands could never match.
      expect(extractVehicleInfo('मारुति सुजुकी').manufacturer).toBe('Maruti Suzuki');
    });

    it('prefers the longest matching key', () => {
      // "मारुति सुजुकी" must win over the shorter "मारुति" substring.
      expect(extractVehicleInfo('मेरे पास मारुति सुजुकी है').manufacturer)
        .toBe('Maruti Suzuki');
    });

    it('extracts Hindi model, fuel and transmission', () => {
      const r = extractVehicleInfo('मारुति स्विफ्ट पेट्रोल मैनुअल');
      expect(r.manufacturer).toBe('Maruti Suzuki');
      expect(r.model).toBe('Swift');
      expect(r.fuel_type).toBe('Petrol');
      expect(r.transmission).toBe('Manual');
    });

    it('extracts Bengali and Tamil brands', () => {
      expect(extractVehicleInfo('টাটা').manufacturer).toBe('Tata');
      expect(extractVehicleInfo('ஹோண்டா').manufacturer).toBe('Honda');
    });

    it('reads a Latin year embedded in Indic speech', () => {
      expect(extractVehicleInfo('मारुति स्विफ्ट 2022').model_year).toBe(2022);
    });
  });

  describe('odometer parsing', () => {
    it('parses a comma-grouped reading', () => {
      expect(extractVehicleInfo('run 1,20,000 km').odometer_km).toBe(120000);
    });

    it('parses the k abbreviation', () => {
      expect(extractVehicleInfo('done 45k km').odometer_km).toBe(45000);
    });

    it('parses lakh', () => {
      expect(extractVehicleInfo('1.5 lakh km').odometer_km).toBe(150000);
    });
  });

  describe('year bounds', () => {
    it('rejects a year before the supported range', () => {
      expect(extractVehicleInfo('a 1985 model').model_year).toBeUndefined();
    });

    it('does not mistake an odometer reading for a year', () => {
      expect(extractVehicleInfo('run 85000 km').model_year).toBeUndefined();
    });
  });
});

describe('detectLanguageFromText', () => {
  it('defaults to English for Latin script', () => {
    expect(detectLanguageFromText('my car makes a knocking sound')).toBe('en-IN');
  });

  it('defaults to English for empty or very short input', () => {
    expect(detectLanguageFromText('')).toBe('en-IN');
    expect(detectLanguageFromText('ok')).toBe('en-IN');
  });

  it('identifies each supported script', () => {
    expect(detectLanguageFromText('मेरी गाड़ी में आवाज आ रही है')).toBe('hi-IN');
    expect(detectLanguageFromText('আমার গাড়িতে শব্দ হচ্ছে')).toBe('bn-IN');
    expect(detectLanguageFromText('என் காரில் சத்தம் வருகிறது')).toBe('ta-IN');
    expect(detectLanguageFromText('నా కారులో శబ్దం వస్తోంది')).toBe('te-IN');
    expect(detectLanguageFromText('ನನ್ನ ಕಾರಿನಲ್ಲಿ ಶಬ್ದ ಬರುತ್ತಿದೆ')).toBe('kn-IN');
    expect(detectLanguageFromText('എന്റെ കാറിൽ ശബ്ദം വരുന്നു')).toBe('ml-IN');
    expect(detectLanguageFromText('મારી ગાડીમાં અવાજ આવે છે')).toBe('gu-IN');
    expect(detectLanguageFromText('ਮੇਰੀ ਗੱਡੀ ਵਿੱਚ ਆਵਾਜ਼ ਆ ਰਹੀ ਹੈ')).toBe('pa-IN');
    expect(detectLanguageFromText('ମୋ ଗାଡ଼ିରେ ଶବ୍ଦ ହେଉଛି')).toBe('or-IN');
  });

  it('distinguishes Marathi from Hindi within Devanagari', () => {
    expect(detectLanguageFromText('माझी गाडी आहे आणि आवाज येतो')).toBe('mr-IN');
  });

  it('picks the dominant script in mixed text', () => {
    expect(detectLanguageFromText('my गाड़ी में बहुत आवाज आ रही है')).toBe('hi-IN');
  });
});

// The year is the field voice users could not get past: a speech recogniser
// returns spoken words, not "2019", and the old parser matched digits only.
describe('spoken model years', () => {
  const year = (t: string) => extractVehicleInfo(t).model_year;

  it('reads century-word forms', () => {
    expect(year('twenty nineteen')).toBe(2019);
    expect(year('it is a twenty twenty three model')).toBe(2023);
    expect(year('twenty twenty')).toBe(2020);
    expect(year('nineteen ninety eight')).toBe(1998);
  });

  it('reads "two thousand" forms with and without the conjunction', () => {
    expect(year('two thousand nineteen')).toBe(2019);
    expect(year('two thousand and eighteen')).toBe(2018);
    expect(year('two thousand twenty two')).toBe(2022);
  });

  it('rejoins digits the recogniser split', () => {
    expect(year('my car is a 20 19 Swift')).toBe(2019);
  });

  it('reads a two-digit year only when the sentence anchors it', () => {
    expect(year('19 model')).toBe(2019);
    expect(year('model 98')).toBe(1998);
    expect(year('year 21')).toBe(2021);
  });

  it('does not invent a year from an unanchored number', () => {
    expect(year('Hyundai i20')).toBeUndefined();
    expect(year('Mahindra XUV700')).toBeUndefined();
    expect(year('I have driven it for 19 days')).toBeUndefined();
  });

  it('does not read an odometer reading as a year', () => {
    expect(year('it has done two thousand kilometres')).toBeUndefined();
    expect(year('run 85000 km')).toBeUndefined();
  });

  it('still rejects years outside the plausible range', () => {
    expect(year('a 1985 model')).toBeUndefined();
    expect(year('two thousand and fifty')).toBeUndefined();
  });

  it('reads the year alongside the rest of the vehicle', () => {
    const r = extractVehicleInfo('I drive a Maruti Swift twenty nineteen petrol manual');
    expect(r.model_year).toBe(2019);
    expect(r.manufacturer).toBe('Maruti Suzuki');
    expect(r.missing).toEqual([]);
  });
});

// The reported bug: a year given early vanished when a later utterance was
// processed, and the assistant asked for it again.
//
// Cause: `result.model_year` was assigned unconditionally, so a transcript
// with no year still carried the KEY `model_year` with the value `undefined`.
// The caller merged with `{ ...before, ...info }`, and a present-but-undefined
// key overwrites. Only the year and the odometer were affected — every other
// field is assigned inside an `if (matched)` and is simply absent.
describe('absent fields are absent, not undefined', () => {
  it('omits model_year entirely when the transcript has no year', () => {
    const r = extractVehicleInfo('it runs on petrol with a manual gearbox');
    expect('model_year' in r).toBe(false);
    expect(r.model_year).toBeUndefined();
  });

  it('omits odometer_km entirely when the transcript has no reading', () => {
    const r = extractVehicleInfo('Maruti Swift petrol');
    expect('odometer_km' in r).toBe(false);
  });

  it('still reports both when they are present', () => {
    const r = extractVehicleInfo('a 2010 Swift that has done 50,000 km');
    expect('model_year' in r).toBe(true);
    expect(r.model_year).toBe(2010);
    expect(r.odometer_km).toBe(50000);
  });

  it('spreading a later result over an earlier one keeps the year', () => {
    // The exact operation the component performs. This is the assertion that
    // would have caught the bug: it fails on the old extractor.
    const first = extractVehicleInfo('my car is a 2010 Maruti Swift');
    const second = extractVehicleInfo('petrol, manual');
    const merged = { ...first, ...second } as any;
    expect(merged.model_year).toBe(2010);
    expect(merged.fuel_type).toBe('Petrol');
    expect(merged.transmission).toBe('Manual');
  });
});

// Voice diagnosis worked in English and nowhere else. `normalise` used
// `[^\w\s]`, and in JavaScript `\w` is `[A-Za-z0-9_]` — so every Devanagari,
// Bengali, Tamil, Telugu, Kannada, Malayalam, Gujarati, Gurmukhi and Odia
// character was replaced by a space. Every step built on the normalised text
// was reading blank input.
describe('non-English transcripts', () => {
  it('keeps the script instead of erasing it', () => {
    // The regression in one assertion: if this returns nothing, nothing below
    // can work.
    const r = extractVehicleInfo('मेरी मारुति स्विफ्ट 2010 पेट्रोल मैनुअल है');
    expect(r.manufacturer).toBe('Maruti Suzuki');
    expect(r.model).toBe('Swift');
    expect(r.model_year).toBe(2010);
    expect(r.fuel_type).toBe('Petrol');
    expect(r.transmission).toBe('Manual');
    expect(r.missing).toEqual([]);
  });

  it('reads Indic digits as years', () => {
    expect(extractVehicleInfo('मेरी कार २०१० मॉडल').model_year).toBe(2010);      // Devanagari
    expect(extractVehicleInfo('আমার গাড়ি ২০১৫').model_year).toBe(2015);          // Bengali
    expect(extractVehicleInfo('ਮੇਰੀ ਗੱਡੀ ੨੦੧੮ ਮਾਡਲ').model_year).toBe(2018);      // Gurmukhi
    expect(extractVehicleInfo('எனது கார் ௨௦௧௨').model_year).toBe(2012);          // Tamil
    expect(extractVehicleInfo('નમારી કાર ૨૦૨૦').model_year).toBe(2020);          // Gujarati
  });

  it('reads a year spoken as words', () => {
    expect(extractVehicleInfo('मेरी गाड़ी दो हजार दस मॉडल है').model_year).toBe(2010);
    expect(extractVehicleInfo('दो हज़ार पंद्रह').model_year).toBe(2015);
    expect(extractVehicleInfo('আমার গাড়ি দুই হাজার বিশ').model_year).toBe(2020);
    expect(extractVehicleInfo('என் கார் இரண்டு ஆயிரம் பத்து').model_year).toBe(2010);
  });

  it('does not read a spoken odometer as a year', () => {
    // "twenty thousand kilometres" — only "two thousand ..." forms a year.
    expect(extractVehicleInfo('बीस हजार किलोमीटर').model_year).toBeUndefined();
  });

  it('recognises fuel and gearbox in every language the picker offers', () => {
    const cases: Array<[string, string, string]> = [
      ['हिन्दी',    'पेट्रोल मैनुअल',        'Petrol'],
      ['বাংলা',     'ডিজেল অটোমেটিক',      'Diesel'],
      ['தமிழ்',     'பெட்ரோல் மேனுவல்',     'Petrol'],
      ['తెలుగు',    'డీజిల్ ఆటోమేటిక్',      'Diesel'],
      ['ಕನ್ನಡ',     'ಪೆಟ್ರೋಲ್ ಮ್ಯಾನ್ಯುಯಲ್',  'Petrol'],
      ['മലയാളം',   'ഡീസൽ ഓട്ടോമാറ്റിക്',   'Diesel'],
      ['ગુજરાતી',   'પેટ્રોલ મેન્યુઅલ',       'Petrol'],
      ['ਪੰਜਾਬੀ',    'ਡੀਜ਼ਲ ਆਟੋਮੈਟਿਕ',       'Diesel'],
      ['ଓଡ଼ିଆ',     'ପେଟ୍ରୋଲ ମାନୁଆଲ',       'Petrol'],
    ];
    for (const [language, transcript, fuel] of cases) {
      const r = extractVehicleInfo(transcript);
      expect(r.fuel_type).withContext(`fuel in ${language}`).toBe(fuel);
      expect(r.transmission).withContext(`gearbox in ${language}`).toBeTruthy();
    }
  });

  it('recognises the common makes in every script', () => {
    const makes: Array<[string, string]> = [
      ['मारुति', 'Maruti Suzuki'],
      ['মারুতি', 'Maruti Suzuki'],
      ['மாருதி', 'Maruti Suzuki'],
      ['మారుతి', 'Maruti Suzuki'],
      ['ಮಾರುತಿ', 'Maruti Suzuki'],
      ['മാരുതി', 'Maruti Suzuki'],
      ['મારુતિ', 'Maruti Suzuki'],
      ['ਮਾਰੂਤੀ', 'Maruti Suzuki'],
      ['ମାରୁତି', 'Maruti Suzuki'],
    ];
    for (const [word, expected] of makes) {
      expect(extractVehicleInfo(word).manufacturer).withContext(word).toBe(expected);
    }
  });

  it('still reports what is genuinely missing rather than guessing', () => {
    const r = extractVehicleInfo('मेरी मारुति स्विफ्ट है');
    expect(r.manufacturer).toBe('Maruti Suzuki');
    expect(r.missing).toContain('model_year');
    expect(r.missing).toContain('fuel_type');
  });
});
