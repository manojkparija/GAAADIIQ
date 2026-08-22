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
  // ── New Cars page ────────────────────────────────────────────────────────
  'Find your perfect car from 500+ new models across all budgets':
    'हर बजट में 500+ नए मॉडल में से अपनी सही कार चुनें',
  'View All Brands →':
    'सभी ब्रांड देखें →',
  'See All →':
    'सभी देखें →',
  'Sort by:':
    'क्रमबद्ध करें:',
  'Filters':
    'फ़िल्टर',
  'Clear All':
    'सब हटाएं',
  'Budget:':
    'बजट:',
  'Fuel Type':
    'फ्यूल टाइप',
  'Loading new cars...':
    'नई कारें लोड हो रही हैं...',
  'Could not load the car catalogue':
    'कार कैटलॉग लोड नहीं हो सका',
  'This is a problem at our end, not with your filters. The service may still be starting up — trying again usually works.':
    'यह हमारी तरफ की समस्या है, आपके फ़िल्टर की नहीं। सेवा अभी शुरू हो रही होगी — दोबारा कोशिश करने से आमतौर पर काम हो जाता है।',
  'No models found':
    'कोई मॉडल नहीं मिला',
  'Try adjusting your filters — e.g. clear budget or body type':
    'अपने फ़िल्टर बदलकर देखें — जैसे बजट या बॉडी टाइप हटाएं',
  'Clear Filters':
    'फ़िल्टर हटाएं',
  'View Details →':
    'विवरण देखें →',
  'Compare now →':
    'अभी तुलना करें →',
  'Launches':
    'लॉन्च',
  'Cars launched in the last 12 months':
    'पिछले 12 महीनों में लॉन्च हुई कारें',
  'Explore →':
    'देखें →',
  'Cars':
    'कारें',
  'Get notified when they launch':
    'लॉन्च होते ही सूचना पाएं',
  'Recommendations':
    'सिफारिशें',
  'Editorial picks — curated by our team':
    'संपादकीय चयन — हमारी टीम द्वारा चुने गए',
  'View Model →':
    'मॉडल देखें →',
  'Popular':
    'लोकप्रिय',
  'Retrying…':
    'फिर कोशिश हो रही है…',
  'Try again':
    'दोबारा कोशिश करें',
  // ── Used Cars page ───────────────────────────────────────────────────────
  'Find Your Perfect':
    'अपनी सही कार खोजें',
  'AI-verified pricing, certified inspections, and the best deals in your city':
    'AI-वेरिफाइड कीमत, सर्टिफाइड जांच और आपके शहर के सबसे अच्छे सौदे',
  'Make':
    'मेक',
  'Model':
    'मॉडल',
  'Max Budget':
    'अधिकतम बजट',
  'Clear':
    'हटाएं',
  'yet — showing All India results.':
    'अभी नहीं — पूरे भारत के नतीजे दिखा रहे हैं।',
  'Save up to 40%':
    '40% तक बचाएं',
  'vs new car price':
    'नई कार की कीमत के मुकाबले',
  'AI-Verified':
    'AI-वेरिफाइड',
  'pricing on every car':
    'हर कार पर कीमत',
  'listed cars':
    'लिस्टेड कारें',
  'Verified Sellers':
    'वेरिफाइड सेलर',
  'trusted listings only':
    'सिर्फ भरोसेमंद लिस्टिंग',
  'Budget Range':
    'बजट रेंज',
  'KM Driven':
    'चली हुई KM',
  'No. of Owners':
    'मालिकों की संख्या',
  'Certified Cars':
    'सर्टिफाइड कारें',
  'Show Certified Only':
    'सिर्फ सर्टिफाइड दिखाएं',
  'Color':
    'रंग',
  'Loading cars...':
    'कारें लोड हो रही हैं...',
  'Certified':
    'सर्टिफाइड',
  'Fetching best used cars for you...':
    'आपके लिए सबसे अच्छी पुरानी कारें लाई जा रही हैं...',
  "We couldn't load used car listings":
    'पुरानी कारों की लिस्टिंग लोड नहीं हो सकी',
  'No listings match your filters in this city':
    'इस शहर में आपके फ़िल्टर से कोई लिस्टिंग नहीं मिली',
  'Show All India cars':
    'पूरे भारत की कारें दिखाएं',
  'Clear All Filters':
    'सभी फ़िल्टर हटाएं',
  'No cars match your filters':
    'आपके फ़िल्टर से कोई कार नहीं मिली',
  'Try broadening your search criteria — or let AI find the best match for you.':
    'अपनी खोज थोड़ी और खुली रखें — या AI को आपके लिए सबसे अच्छा विकल्प ढूंढने दें।',
  '✓ Certified':
    '✓ सर्टिफाइड',
  'EMI Calc':
    'EMI कैलक',
  'Recently Viewed':
    'हाल में देखी गई',
  'No used cars in':
    'पुरानी कारें नहीं हैं',
  // ── Car detail page ──────────────────────────────────────────────────────
  'We could not load this car right now.':
    'यह कार अभी लोड नहीं हो सकी।',
  'The catalogue is unreachable. This is usually temporary.':
    'कैटलॉग तक पहुंच नहीं हो पा रही। यह आमतौर पर अस्थायी होता है।',
  'Browse all cars':
    'सभी कारें देखें',
  'Loading car details...':
    'कार का विवरण लोड हो रहा है...',
  'browse all cars':
    'सभी कारें देखें',
  'Drag to rotate':
    'घुमाने के लिए खींचें',
  'Reset':
    'रीसेट',
  'Overview':
    'ओवरव्यू',
  'Specs':
    'स्पेसिफिकेशन',
  'Features':
    'फीचर्स',
  'Colours':
    'रंग',
  'Cost of Ownership':
    'स्वामित्व लागत',
  'Gearbox':
    'गियरबॉक्स',
  'Owners':
    'मालिक',
  'Location':
    'जगह',
  'Body':
    'बॉडी',
  'Model year':
    'मॉडल साल',
  'and goes up to':
    'और जाती है',
  '(ex-showroom).':
    '(एक्स-शोरूम)।',
  'Show all':
    'सभी दिखाएं',
  'Price on request':
    'कीमत अनुरोध पर',
  'Annual Fuel Cost':
    'सालाना फ्यूल खर्च',
  'Maintenance':
    'रखरखाव',
  'Insurance':
    'बीमा',
  'Depreciation':
    'मूल्यह्रास',
  'Total Annual Cost':
    'कुल सालाना खर्च',
  'What can I sell it for?':
    'मैं इसे कितने में बेच सकता हूं?',
  'Projected resale value, year by year':
    'अनुमानित पुनर्विक्रय मूल्य, साल दर साल',
  'Standard depreciation estimate':
    'मानक मूल्यह्रास अनुमान',
  'Projection only — actual resale depends on condition, service history and local demand.':
    'यह सिर्फ अनुमान है — असली कीमत हालत, सर्विस हिस्ट्री और स्थानीय मांग पर निर्भर करती है।',
  '5-Year Total Cost of Ownership':
    '5 साल की कुल स्वामित्व लागत',
  'Purchase Price':
    'खरीद कीमत',
  'Registration':
    'रजिस्ट्रेशन',
  'Resale Value':
    'पुनर्विक्रय मूल्य',
  'Net 5-yr Cost':
    'शुद्ध 5-साल खर्च',
  'Depreciation Outlook':
    'मूल्यह्रास का अनुमान',
  '1 Year':
    '1 साल',
  '3 Years':
    '3 साल',
  '5 Years':
    '5 साल',
  'Your Review':
    'आपकी समीक्षा',
  'Loading reviews…':
    'समीक्षाएं लोड हो रही हैं…',
  'Review submitted! Thank you.':
    'समीक्षा भेज दी गई! धन्यवाद।',
  'No reviews yet. Be the first to review this car!':
    'अभी कोई समीक्षा नहीं। इस कार की पहली समीक्षा आप करें!',
  'Car':
    'कार',
  'Image':
    'फोटो',
  'User Rating':
    'यूज़र रेटिंग',
  'Link copied':
    'लिंक कॉपी हो गया',
  'Get Best Price':
    'सबसे अच्छी कीमत पाएं',
  'Contact Seller':
    'सेलर से संपर्क करें',
  'Safe Deal Guarantee':
    'सुरक्षित सौदे की गारंटी',
  'Free RC Check':
    'मुफ्त RC जांच',
  'On-Road Price':
    'ऑन-रोड कीमत',
  'State:':
    'राज्य:',
  'Ex-Showroom':
    'एक्स-शोरूम',
  'Handling Charges':
    'हैंडलिंग चार्ज',
  'AI Price Analysis':
    'AI कीमत विश्लेषण',
  'Market Min':
    'बाज़ार न्यूनतम',
  'Market Max':
    'बाज़ार अधिकतम',
  'AI Fair Value:':
    'AI उचित मूल्य:',
  'Loan Amount':
    'लोन राशि',
  'Interest Rate':
    'ब्याज दर',
  'Tenure':
    'अवधि',
  'Monthly EMI':
    'मासिक EMI',
  'Principal':
    'मूलधन',
  'Total Interest':
    'कुल ब्याज',
  'Total Payment':
    'कुल भुगतान',
  'Apply for Loan →':
    'लोन के लिए आवेदन करें →',
  'Compare with similar cars':
    'मिलती-जुलती कारों से तुलना करें',
  'See how this stacks up against competition':
    'देखें यह मुकाबले में कहां ठहरती है',
  'Open Comparison Tool':
    'तुलना टूल खोलें',
  'Send Enquiry':
    'पूछताछ भेजें',
  'Our team will connect you with the seller within 2 hours.':
    'हमारी टीम 2 घंटे के भीतर आपको सेलर से जोड़ेगी।',
  'Enquiry Sent!':
    'पूछताछ भेज दी गई!',
  'Our team will contact you within 2 hours to arrange a callback with the seller.':
    'हमारी टीम 2 घंटे के भीतर आपसे संपर्क करके सेलर से बात कराएगी।',
  'Close':
    'बंद करें',
  'Loading seller info…':
    'सेलर की जानकारी लोड हो रही है…',
  'Verified Dealer':
    'वेरिफाइड डीलर',
  'Base model — pick a trim under Variants to price that one.':
    'बेस मॉडल — किसी खास ट्रिम की कीमत के लिए वेरिएंट में से चुनें।',
};
