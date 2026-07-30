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
