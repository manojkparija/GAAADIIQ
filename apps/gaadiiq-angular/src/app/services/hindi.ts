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

  // ── Home page ────────────────────────────────────────────────────────────
  'AI Car Valuation':
    'AI कार मूल्यांकन',
  "Know Your Car's":
    'जानिए अपनी कार की',
  'True Market Value':
    'असली बाज़ार कीमत',
  'Powered by':
    'संचालित',
  '200+ AI Signals':
    '200+ AI सिग्नल',
  'Get an accurate valuation in under 30 seconds — data-driven, instant, no guesswork.':
    '30 सेकंड से कम में सटीक मूल्यांकन — डेटा आधारित, तुरंत, बिना अंदाज़े के।',
  'Get AI Valuation':
    'AI मूल्यांकन पाएं',
  'Live Analysis':
    'लाइव विश्लेषण',
  'AI Fair Value':
    'AI उचित मूल्य',
  'Market Range':
    'बाज़ार रेंज',
  'AI Confidence':
    'AI विश्वास',
  'Fair Deal':
    'सही सौदा',
  'High Demand':
    'ज्यादा मांग',
  'Low Depreciation':
    'कम मूल्यह्रास',
  'AI Signals':
    'AI सिग्नल',
  'Instant Result':
    'तुरंत नतीजा',
  'Popular Brands':
    'लोकप्रिय ब्रांड',
  'Browse by':
    'देखें',
  "India's most trusted car manufacturers — all verified listings":
    'भारत के सबसे भरोसेमंद कार निर्माता — सभी वेरिफाइड लिस्टिंग',
  'Find The Cars Of Your Choice':
    'अपनी पसंद की कारें खोजें',
  'Your AI-Powered':
    'आपका AI-संचालित',
  'Car Co-Pilot':
    'कार को-पायलट',
  'Not just a marketplace — the smartest car-buying experience in India.':
    'सिर्फ एक मार्केटप्लेस नहीं — भारत का सबसे स्मार्ट कार खरीदने का अनुभव।',
  'Tell us what you want.':
    'बताइए आपको क्या चाहिए।',
  "We'll find the":
    'हम ढूंढेंगे',
  'perfect car.':
    'सही कार।',
  'Start AI Advisor':
    'AI सलाहकार शुरू करें',
  "What's your budget range?":
    'आपका बजट कितना है?',
  'Do you prefer petrol or electric?':
    'आप पेट्रोल पसंद करेंगे या इलेक्ट्रिक?',
  'Electric please!':
    'इलेक्ट्रिक!',
  'Found 12 perfect matches for you!':
    'आपके लिए 12 बेहतरीन विकल्प मिले!',
  'Reviews':
    'समीक्षाएं',
  'Loved by':
    'पसंद किया गया',
  'Car Buyers':
    'कार खरीदारों द्वारा',
  'Ready to Sell?':
    'बेचने के लिए तैयार?',
  'Get the Best Price.':
    'सबसे अच्छी कीमत पाएं।',
  'List for free. AI valuation included. Reach thousands of verified buyers today.':
    'मुफ्त लिस्ट करें। AI मूल्यांकन शामिल। आज ही हजारों वेरिफाइड खरीदारों तक पहुंचें।',
  'List Your Car Free':
    'अपनी कार मुफ्त लिस्ट करें',
  'Now':
    'अभी',

  // ── Home page, continued ─────────────────────────────────────────────────
  'Browse':
    'देखें',
  'Sign Out':
    'साइन आउट',
  'My Listings':
    'मेरी लिस्टिंग',
  'My Profile':
    'मेरी प्रोफाइल',
  'Free Listing':
    'मुफ्त लिस्टिंग',
  'Zero Commission':
    'ज़ीरो कमीशन',
  '50K+ Buyers':
    '50K+ खरीदार',
  'Answer 6 quick questions. Our AI matches you to the ideal car from 50,000+ listings — with':
    '6 आसान सवालों के जवाब दें। हमारा AI 50,000+ लिस्टिंग में से आपके लिए सही कार चुनेगा — साथ में',
  // ── Navbar actions ───────────────────────────────────────────────────────
  'Used Cars in': 'पुरानी कारें —',
};
