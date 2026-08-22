/**
 * Hindi copy, keyed by the English it replaces.
 *
 * Anything absent from this map renders in English. That is deliberate and it
 * is how this file can grow one page at a time without any page ever breaking:
 * a half-translated page reads as English-with-Hindi, never as a page full of
 * missing keys.
 *
 * HOW TO ADD A PAGE
 *   1. Put `| t` on the strings in its template.
 *   2. Add the English → Hindi pairs here.
 *   3. There is no coverage check yet. A string with no entry here renders in
 *      English silently, so the only way to know what is left is to read the
 *      page in Hindi. Worth building once the bulk of the copy is in.
 *
 * TRANSLATION NOTES
 * Car-market vocabulary in India is bilingual in practice: buyers say "EMI",
 * "SUV", "petrol", "on-road price" in Hindi sentences. Translating those into
 * pure Hindi (विद्युत, समान मासिक किस्त) would be *less* readable, not more.
 * Devanagari transliteration is used where the English word is what people
 * actually say, and Hindi where a Hindi word is what they say. Brand and model
 * names are never translated.
 */
export const HINDI: Record<string, string> = {
  // ── Shared vocabulary ────────────────────────────────────────────────────
  'Home': 'होम',
  'New Cars': 'नई कारें',
  'Used Cars': 'पुरानी कारें',
  'Compare': 'तुलना',
  'Compare Cars': 'कारों की तुलना',
  'EMI': 'EMI',
  'EMI Calculator': 'EMI कैलकुलेटर',
  'Car Loan': 'कार लोन',
  'TCO': 'खर्च',
  'News': 'समाचार',
  'Journey': 'मेरी यात्रा',
  'AI Advisor': 'AI सलाहकार',
  'AI Diagnosis': 'AI जांच',
  'AI Car Value': 'AI कार मूल्य',
  'Find Mechanic': 'मैकेनिक खोजें',
  'Language': 'भाषा',
  'Select City': 'शहर चुनें',
  'Sign In': 'साइन इन',
  'Sign Up': 'साइन अप',
  'Log Out': 'लॉग आउट',
  'Search': 'खोजें',
  'View Details': 'विवरण देखें',
  'View All': 'सभी देखें',
  'Explore': 'देखें',
  'Browse Cars': 'कारें देखें',
  'Sell Your Car': 'अपनी कार बेचें',
  'List Your Car': 'अपनी कार लिस्ट करें',
  'Get Started': 'शुरू करें',
  'Learn More': 'और जानें',
  'Loading…': 'लोड हो रहा है…',
  'Price': 'कीमत',
  'Year': 'साल',
  'Fuel': 'फ्यूल',
  'Petrol': 'पेट्रोल',
  'Diesel': 'डीज़ल',
  'Electric': 'इलेक्ट्रिक',
  'Hybrid': 'हाइब्रिड',
  'CNG': 'CNG',
  'Transmission': 'ट्रांसमिशन',
  'Manual': 'मैनुअल',
  'Automatic': 'ऑटोमैटिक',
  'Body Type': 'बॉडी टाइप',
  'SUV': 'SUV',
  'Hatchback': 'हैचबैक',
  'Sedan': 'सेडान',
  'MUV': 'MUV',
  'Brand': 'ब्रांड',
  'City': 'शहर',
  'Budget': 'बजट',
  'Variants': 'वेरिएंट',
  'Verified': 'वेरिफाइड',
  'onwards': 'से शुरू',
  'Ex-showroom': 'एक्स-शोरूम',
  'On-road price': 'ऑन-रोड कीमत',
  'Get On-Road Price': 'ऑन-रोड कीमत जानें',
  'Book Test Drive': 'टेस्ट ड्राइव बुक करें',

  // ── New Cars menu ────────────────────────────────────────────────────────
  'Explore New Cars': 'नई कारें देखें',
  'Upcoming Cars': 'आने वाली कारें',
  'EV Savings Calculator': 'EV बचत कैलकुलेटर',
  'Total Cost of Ownership': 'कुल स्वामित्व लागत',
  'By body type': 'बॉडी टाइप से',
  'By fuel': 'फ्यूल से',
  'By brand': 'ब्रांड से',
  'By budget': 'बजट से',

  // ── Used Cars menu ───────────────────────────────────────────────────────
  'Buy Used Cars': 'पुरानी कारें खरीदें',
  'Used Cars in Your City': 'आपके शहर की पुरानी कारें',
  'Sell My Car': 'मेरी कार बेचें',
  'Used Car Valuation': 'पुरानी कार का मूल्यांकन',

  // ── Home ─────────────────────────────────────────────────────────────────
  'Buy Smarter': 'समझदारी से खरीदें',
  'Popular New Car Models': 'लोकप्रिय नई कार मॉडल',
  'Browse by Body Type': 'बॉडी टाइप से देखें',
  'Browse by Budget': 'बजट से देखें',
  'Why GAADIIQ': 'GAADIIQ क्यों',
  'Sort by': 'क्रमबद्ध करें',
  'Popularity': 'लोकप्रियता',
  'Price: Low to High': 'कीमत: कम से ज्यादा',
  'Price: High to Low': 'कीमत: ज्यादा से कम',
  'Compact & city-friendly': 'छोटी और शहर के लिए आसान',
  'Space for the family': 'परिवार के लिए जगह',
  'Future-ready EVs': 'भविष्य के लिए तैयार EV',
  'Premium experience': 'प्रीमियम अनुभव',

  // ── Reviews & News ───────────────────────────────────────────────────────
  'Reviews & News': 'समीक्षाएं और समाचार',
  'Expert Reviews': 'विशेषज्ञ समीक्षाएं',
  'User Reviews': 'यूज़र समीक्षाएं',
  'Special Reports': 'विशेष रिपोर्ट',
  'Breaking news, launches & industry updates':
    'ताज़ा खबरें, लॉन्च और इंडस्ट्री अपडेट',
  'In-depth tests & long-term ownership reports':
    'विस्तृत टेस्ट और लंबे समय के स्वामित्व की रिपोर्ट',
  'Real owner stories & honest experiences':
    'असली मालिकों की कहानियां और सच्चे अनुभव',
  'Data-driven guides, cost analysis & research':
    'डेटा आधारित गाइड, लागत विश्लेषण और रिसर्च',

  // ── Footer ───────────────────────────────────────────────────────────────
  'Quick Links': 'त्वरित लिंक',
  'Company': 'कंपनी',
  'About Us': 'हमारे बारे में',
  'Privacy Policy': 'प्राइवेसी पॉलिसी',
  'Terms of Service': 'सेवा की शर्तें',
  'Cookie Policy': 'कुकी पॉलिसी',
  'Tools': 'टूल्स',
  'All rights reserved.': 'सर्वाधिकार सुरक्षित।',

  // ── Footer links ─────────────────────────────────────────────────────────
  "India's AI-first automotive intelligence platform. Smarter car buying and selling for everyone.":
    'भारत का AI-फर्स्ट ऑटोमोटिव इंटेलिजेंस प्लेटफॉर्म। सबके लिए समझदारी से कार खरीदना और बेचना।',
  'Buy': 'खरीदें',
  'Sell': 'बेचें',
  'All Cars': 'सभी कारें',
  'Electric Cars': 'इलेक्ट्रिक कारें',
  'SUVs': 'SUV',
  'Sedans': 'सेडान',
  'AI Valuation': 'AI मूल्यांकन',
  'Seller Dashboard': 'सेलर डैशबोर्ड',
  'Pricing Plans': 'प्राइसिंग प्लान',
  'Car Comparison': 'कार तुलना',
  'AI Car Advisor': 'AI कार सलाहकार',
  'Price Alerts': 'प्राइस अलर्ट',
  'Partners': 'पार्टनर',
  'Become a Mechanic': 'मैकेनिक बनें',
  'Mechanic Dashboard': 'मैकेनिक डैशबोर्ड',
  'Account': 'अकाउंट',
  'Create Account': 'अकाउंट बनाएं',
  'Contact': 'संपर्क',
  'Built in India.': 'भारत में बना।',
};
