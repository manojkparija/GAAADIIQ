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
  'EMI & Loan': 'EMI और लोन',
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
  // ── Calculators: EMI, TCO, EV ────────────────────────────────────────────
  'Calculator':
    'कैलकुलेटर',
  'Calculate your monthly payment and compare bank rates':
    'अपनी मासिक किस्त निकालें और बैंकों की दरें तुलना करें',
  'Loan Details':
    'लोन का विवरण',
  'Down Payment (optional)':
    'डाउन पेमेंट (वैकल्पिक)',
  'Total Amount':
    'कुल राशि',
  'Loan Breakdown':
    'लोन का ब्यौरा',
  'per month':
    'प्रति माह',
  'Compare Bank Rates':
    'बैंक दरों की तुलना',
  '/ month':
    '/ माह',
  'Selected ✓':
    'चुना गया ✓',
  'Best Rate':
    'सबसे अच्छी दर',
  'Affordability':
    'वहनीयता',
  'Analysis':
    'विश्लेषण',
  'Enter your income details to see if this loan fits your financial health':
    'अपनी आय का विवरण डालें और देखें कि यह लोन आपकी आर्थिक स्थिति में फिट बैठता है या नहीं',
  'Monthly Income':
    'मासिक आय',
  'Existing EMIs':
    'मौजूदा EMI',
  'Monthly Expenses':
    'मासिक खर्च',
  'Cost Analysis':
    'लागत विश्लेषण',
  'Total Cost of':
    'कुल लागत',
  'Ownership':
    'स्वामित्व की',
  'Beyond the sticker price — understand the true multi-year cost of owning any car.':
    'सिर्फ कीमत से आगे — किसी भी कार के कई साल के असली खर्च को समझें।',
  'Find a nearby mechanic':
    'पास का मैकेनिक खोजें',
  'Vehicle Details':
    'गाड़ी का विवरण',
  'KM per Year':
    'प्रति साल KM',
  'Years Owned':
    'कितने साल रखी',
  'Running Costs':
    'चलाने का खर्च',
  'Insurance (% of value / year)':
    'बीमा (मूल्य का % / साल)',
  'Maintenance per Year':
    'प्रति साल रखरखाव',
  'Per Year':
    'प्रति साल',
  'Per KM':
    'प्रति KM',
  'Cost Breakdown':
    'खर्च का ब्यौरा',
  'Grand Total':
    'कुल योग',
  '* Depreciation uses market-standard rates (20% → 15% → 12% → 10% → 8% per year). Actual costs vary by city, driving style, and insurer.':
    '* मूल्यह्रास बाज़ार की मानक दरों पर (20% → 15% → 12% → 10% → 8% प्रति साल)। असली खर्च शहर, चलाने के तरीके और बीमा कंपनी पर निर्भर करता है।',
  'EV vs Petrol':
    'EV बनाम पेट्रोल',
  'Ownership Calculator':
    'स्वामित्व कैलकुलेटर',
  'EV On-Road Price':
    'EV ऑन-रोड कीमत',
  'Battery Range (km per charge)':
    'बैटरी रेंज (प्रति चार्ज km)',
  'Charging Cost (₹ per 100 km)':
    'चार्जिंग खर्च (₹ प्रति 100 km)',
  'Annual Maintenance':
    'सालाना रखरखाव',
  'Effective Price:':
    'प्रभावी कीमत:',
  'Petrol Car On-Road Price':
    'पेट्रोल कार ऑन-रोड कीमत',
  'Fuel Efficiency (km/l)':
    'माइलेज (km/l)',
  'Current Petrol Price (₹/litre)':
    'मौजूदा पेट्रोल कीमत (₹/लीटर)',
  'Daily Distance':
    'रोज़ाना दूरी',
  'Comparison Period':
    'तुलना की अवधि',
  'Annual Fuel Cost (EV)':
    'सालाना फ्यूल खर्च (EV)',
  'Annual Fuel Cost (Petrol)':
    'सालाना फ्यूल खर्च (पेट्रोल)',
  'Annual Maintenance (EV)':
    'सालाना रखरखाव (EV)',
  'Annual Maintenance (Petrol)':
    'सालाना रखरखाव (पेट्रोल)',
  'Get AI Car Recommendations →':
    'AI कार सिफारिशें पाएं →',
  'Calculate EMI':
    'EMI निकालें',
  'Calculations are indicative. Actual costs vary by usage, electricity tariff, petrol prices, and insurer. FAME-II eligibility subject to government guidelines.':
    'गणनाएं संकेतात्मक हैं। असली खर्च उपयोग, बिजली दर, पेट्रोल कीमत और बीमा कंपनी पर निर्भर करता है। FAME-II पात्रता सरकारी दिशानिर्देशों के अधीन है।',
  'Running costs':
    'चलाने का खर्च',
  'fuel, service, insurance':
    'फ्यूल, सर्विस, बीमा',
  'Current DTI':
    'मौजूदा DTI',
  'DTI After Loan':
    'लोन के बाद DTI',
  'Total EMIs (Existing + Car)':
    'कुल EMI (मौजूदा + कार)',
  'True cost of this car / month':
    'इस कार का असली खर्च / माह',
  'Monthly Surplus':
    'मासिक बचत',
  'Compare real 5-year costs including fuel, insurance, maintenance & FAME-II subsidy.':
    'फ्यूल, बीमा, रखरखाव और FAME-II सब्सिडी सहित 5 साल का असली खर्च तुलना करें।',
  '· Break-even in':
    '· बराबरी',
  'Driving Profile':
    'ड्राइविंग प्रोफाइल',
  // ── Sign in, register, compare ───────────────────────────────────────────
  'Welcome back':
    'वापस स्वागत है',
  'Sign in to your account':
    'अपने अकाउंट में साइन इन करें',
  'or continue with email':
    'या ईमेल से जारी रखें',
  'Email address':
    'ईमेल पता',
  'Password':
    'पासवर्ड',
  'Remember me':
    'मुझे याद रखें',
  'Forgot password?':
    'पासवर्ड भूल गए?',
  'Almost there — confirm your email first.':
    'बस एक कदम बाकी — पहले अपना ईमेल कन्फर्म करें।',
  'We sent a link to':
    'हमने लिंक भेजा है',
  '. Click it, then sign in. Your password is fine.':
    '। उस पर क्लिक करें, फिर साइन इन करें। आपका पासवर्ड सही है।',
  'Nothing in your inbox? Check spam, or':
    'इनबॉक्स में कुछ नहीं? स्पैम देखें, या',
  'send it again':
    'दोबारा भेजें',
  'Sent — check your inbox.':
    'भेज दिया — अपना इनबॉक्स देखें।',
  "Don't have an account?":
    'अकाउंट नहीं है?',
  'Create one free':
    'मुफ्त बनाएं',
  'Reset your password':
    'अपना पासवर्ड रीसेट करें',
  "Enter your email and we'll send you a reset link.":
    'अपना ईमेल डालें, हम रीसेट लिंक भेज देंगे।',
  'Check your inbox':
    'अपना इनबॉक्स देखें',
  'A password reset link has been sent to':
    'पासवर्ड रीसेट लिंक भेजा गया है',
  ". Check your spam folder if you don't see it.":
    '। न दिखे तो स्पैम फोल्डर देखें।',
  'Create your account':
    'अपना अकाउंट बनाएं',
  'Personal Info':
    'निजी जानकारी',
  'Preferences':
    'पसंद',
  'Check your email':
    'अपना ईमेल देखें',
  'We sent a confirmation link to':
    'हमने पुष्टि लिंक भेजा है',
  '. Click it, then sign in — your account is ready on the other side.':
    '। उस पर क्लिक करें, फिर साइन इन करें — आपका अकाउंट तैयार है।',
  "After signing in you'll be asked for your workshop details and KYC. An admin approves the account before jobs start arriving.":
    'साइन इन के बाद आपसे वर्कशॉप का विवरण और KYC मांगा जाएगा। काम आने से पहले एक एडमिन अकाउंट को मंज़ूरी देता है।',
  'Go to sign in':
    'साइन इन पर जाएं',
  'Tell us about yourself':
    'अपने बारे में बताएं',
  'Full Name':
    'पूरा नाम',
  'Email Address':
    'ईमेल पता',
  'Phone Number':
    'फोन नंबर',
  'I am signing up as':
    'मैं साइन अप कर रहा हूं',
  'Customer':
    'ग्राहक',
  'Browse & buy cars':
    'कारें देखें और खरीदें',
  'Seller':
    'सेलर',
  'List & sell cars':
    'कारें लिस्ट करें और बेचें',
  'Mechanic':
    'मैकेनिक',
  'Take repair jobs':
    'मरम्मत का काम लें',
  'Search any car from our database and compare up to 3 side by side. Winner specs highlighted.':
    'हमारे डेटाबेस से कोई भी कार खोजें और 3 तक साथ-साथ तुलना करें। बेहतर स्पेसिफिकेशन हाइलाइट किए गए हैं।',
  'No results':
    'कोई नतीजा नहीं',
  'Specification':
    'स्पेसिफिकेशन',
  'Features Comparison':
    'फीचर्स की तुलना',
  '(5-Year Analysis)':
    '(5 साल का विश्लेषण)',
  'Search and select at least 2 cars to compare':
    'तुलना के लिए कम से कम 2 कारें खोजें और चुनें',
  // ── AI advisor and valuation ─────────────────────────────────────────────
  'Advisor':
    'सलाहकार',
  'Select all that apply':
    'जो भी लागू हो सब चुनें',
  '← Back':
    '← पीछे',
  'Analyzing Your Profile':
    'आपकी प्रोफाइल का विश्लेषण',
  'AI Recommendations':
    'AI सिफारिशें',
  '← Retake Quiz':
    '← क्विज़ दोबारा लें',
  'No matches found':
    'कोई मेल नहीं मिला',
  'No cars in our catalogue match this combination of fuel type, body type, and budget. Try broadening one of those criteria.':
    'हमारे कैटलॉग में फ्यूल टाइप, बॉडी टाइप और बजट के इस मेल की कोई कार नहीं है। इनमें से किसी एक को थोड़ा खुला रखकर देखें।',
  'Feature':
    'फीचर',
  'Monthly Fuel':
    'मासिक फ्यूल',
  '5-Year TCO':
    '5 साल का कुल खर्च',
  'Resale (5yr)':
    'पुनर्विक्रय (5 साल)',
  'Rating':
    'रेटिंग',
  'match':
    'मेल',
  'Why this car for you':
    'यह कार आपके लिए क्यों',
  'Annual Maint.':
    'सालाना रखरखाव',
  'Pros':
    'फायदे',
  'What Is Your Car':
    'आपकी कार की',
  'Worth Today?':
    'आज कीमत क्या है?',
  'Get a fair market estimate for your used car based on depreciation, mileage, and market signals. Free, no sign-up needed.':
    'मूल्यह्रास, चली हुई दूरी और बाज़ार के संकेतों के आधार पर अपनी पुरानी कार का उचित अनुमान पाएं। मुफ्त, बिना साइन-अप के।',
  'Catalogue-based pricing':
    'कैटलॉग आधारित कीमत',
  'AI-enhanced when available':
    'उपलब्ध होने पर AI से बेहतर',
  'Preliminary estimate — verify with a dealer':
    'प्रारंभिक अनुमान — डीलर से पुष्टि करें',
  'Tell us about your car':
    'अपनी कार के बारे में बताएं',
  'Car Make *':
    'कार मेक *',
  'Model *':
    'मॉडल *',
  'Variant':
    'वेरिएंट',
  '— affects price accuracy':
    '— कीमत की सटीकता पर असर डालता है',
  'Year *':
    'साल *',
  'Kilometres Driven *':
    'चली हुई किलोमीटर *',
  'Fuel Type *':
    'फ्यूल टाइप *',
  'No. of Owners *':
    'मालिकों की संख्या *',
  'Overall Condition *':
    'कुल हालत *',
  'Analysing market data':
    'बाज़ार डेटा का विश्लेषण',
  "Your Car's":
    'आपकी कार का',
  'Market Value':
    'बाज़ार मूल्य',
  'Quick Sale':
    'जल्दी बिक्री',
  'Priced to go in a fortnight':
    'दो हफ्ते में बिक जाने वाली कीमत',
  'Selling Privately':
    'निजी तौर पर बेचना',
  'What you should realistically get':
    'वास्तविक रूप से आपको कितना मिलना चाहिए',
  // ── Diagnosis and roadside help ──────────────────────────────────────────
  'AI Repair Advisor':
    'AI मरम्मत सलाहकार',
  'Vehicle Preliminary':
    'गाड़ी की प्रारंभिक',
  'Diagnosis':
    'जांच',
  'Describe your car problem and get an AI-powered preliminary assessment with repair cost estimates. Always consult a certified mechanic to confirm.':
    'अपनी कार की समस्या बताएं और मरम्मत के अनुमानित खर्च के साथ AI आधारित प्रारंभिक आकलन पाएं। पुष्टि के लिए हमेशा किसी प्रमाणित मैकेनिक से सलाह लें।',
  'My Diagnosis History':
    'मेरी जांच का इतिहास',
  'Past Diagnoses':
    'पिछली जांचें',
  '← All diagnoses':
    '← सभी जांचें',
  'Estimated cost':
    'अनुमानित खर्च',
  'Complexity':
    'जटिलता',
  'Repair time':
    'मरम्मत का समय',
  'Confidence':
    'विश्वास',
  'Possible causes':
    'संभावित कारण',
  'Recommended steps':
    'सुझाए गए कदम',
  'Safe DIY checks':
    'खुद से करने लायक सुरक्षित जांच',
  'Read aloud':
    'पढ़कर सुनाएं',
  'Stop':
    'रोकें',
  'Delete':
    'हटाएं',
  'Delete this diagnosis permanently? This cannot be undone.':
    'इस जांच को हमेशा के लिए हटाएं? यह वापस नहीं होगा।',
  'Cancel':
    'रद्द करें',
  'Loading diagnosis…':
    'जांच लोड हो रही है…',
  'Your voice data':
    'आपका आवाज़ डेटा',
  'Delete every stored transcript from your voice diagnoses. Audio recordings are never kept — only the text. This also withdraws microphone consent.':
    'आपकी आवाज़ से हुई जांचों के सभी संग्रहित टेक्स्ट हटाएं। ऑडियो रिकॉर्डिंग कभी नहीं रखी जाती — सिर्फ टेक्स्ट। इससे माइक्रोफोन की सहमति भी वापस ली जाती है।',
  'Delete my voice data':
    'मेरा आवाज़ डेटा हटाएं',
  'Delete all stored voice transcripts? This cannot be undone.':
    'सभी संग्रहित आवाज़ टेक्स्ट हटाएं? यह वापस नहीं होगा।',
  'Roadside Assistance':
    'सड़क किनारे सहायता',
  'Find a Nearby':
    'पास का खोजें',
  'Broken down? We alert every available GAADIIQ partner mechanic within 1 km. The first to accept comes to you.':
    'गाड़ी खराब हो गई? हम 1 km के भीतर हर उपलब्ध GAADIIQ पार्टनर मैकेनिक को सूचित करते हैं। जो पहले स्वीकार करता है वही आपके पास आता है।',
  'Share where you are':
    'बताएं आप कहां हैं',
  'We use your live location, not your profile address — what matters is where the car actually stopped.':
    'हम आपकी मौजूदा लोकेशन लेते हैं, प्रोफाइल का पता नहीं — मायने यह रखता है कि कार असल में कहां रुकी।',
  'We alert mechanics within 1 km':
    'हम 1 km के भीतर मैकेनिकों को सूचित करते हैं',
  'All of them at once. The first to accept is assigned, so you are not left choosing from a list while stranded.':
    'सबको एक साथ। जो पहले स्वीकार करता है वही तय होता है, ताकि रास्ते में फंसे हुए आपको सूची में से चुनना न पड़े।',
  'Share your code when they arrive':
    'वे पहुंचें तो अपना कोड बताएं',
  'You get a 6-digit code. The mechanic cannot start the job without it — that is how you know the person at your car is the one we sent.':
    'आपको 6 अंकों का कोड मिलता है। उसके बिना मैकेनिक काम शुरू नहीं कर सकता — इसी से आप जानते हैं कि आपकी कार के पास वही व्यक्ति है जिसे हमने भेजा।',
  'Pay after the work is priced':
    'काम की कीमत तय होने के बाद भुगतान करें',
  'The mechanic inspects and quotes. You are asked to pay only once there is something to pay for.':
    'मैकेनिक जांच करके कीमत बताता है। भुगतान तभी मांगा जाता है जब कुछ देना बनता हो।',
  'run an AI diagnosis':
    'AI जांच चलाएं',
  'first if you are unsure how serious the problem is.':
    'अगर आपको समस्या की गंभीरता का अंदाज़ा नहीं है।',
  'Are you a mechanic?':
    'क्या आप मैकेनिक हैं?',
  'Register as a partner':
    'पार्टनर के रूप में रजिस्टर करें',
  'to receive jobs from drivers nearby.':
    'ताकि आस-पास के ड्राइवरों से काम मिले।',
  // ── List a car, buyer journey, test drive ────────────────────────────────
  'Reach 50,000+ verified buyers. Free listing. AI-powered valuation.':
    '50,000+ वेरिफाइड खरीदारों तक पहुंचें। मुफ्त लिस्टिंग। AI आधारित मूल्यांकन।',
  'Car Details':
    'कार का विवरण',
  'Photos':
    'फोटो',
  'Condition & Price':
    'हालत और कीमत',
  'Your Info':
    'आपकी जानकारी',
  'What are you listing?':
    'आप क्या लिस्ट कर रहे हैं?',
  'Used car':
    'पुरानी कार',
  "A resale — we'll estimate its value":
    'पुनर्विक्रय — हम इसकी कीमत का अनुमान लगाएंगे',
  'New car':
    'नई कार',
  'Unregistered showroom stock':
    'बिना रजिस्ट्रेशन वाला शोरूम स्टॉक',
  'Make (Brand)':
    'मेक (ब्रांड)',
  '(optional)':
    '(वैकल्पिक)',
  'Choose from the list instead':
    'इसकी जगह सूची में से चुनें',
  'Find Your Perfect Car':
    'अपनी सही कार खोजें',
  'Answer a few quick questions to get your personalized recommendation.':
    'कुछ आसान सवालों के जवाब दें और अपनी निजी सिफारिश पाएं।',
  'Your Personalized Journey':
    'आपकी अपनी यात्रा',
  "Based on your preferences, here's your buyer profile:":
    'आपकी पसंद के आधार पर, यह रही आपकी खरीदार प्रोफाइल:',
  'Use Case':
    'इस्तेमाल',
  'Priority':
    'प्राथमिकता',
  'See Matched Cars →':
    'मेल खाती कारें देखें →',
  'Ask AI Advisor':
    'AI सलाहकार से पूछें',
  'Retake Journey':
    'यात्रा दोबारा शुरू करें',
  'Your Buying':
    'आपका खरीद',
  'Roadmap':
    'रोडमैप',
  '✓ Done':
    '✓ हो गया',
  '▶ Up Next':
    '▶ आगे',
  'Test Drive':
    'टेस्ट ड्राइव',
  'Book a':
    'बुक करें',
  "Pick any car from our 54-car database. Choose your slot and we'll arrange it.":
    'हमारे डेटाबेस से कोई भी कार चुनें। अपना समय चुनें, हम इंतज़ाम कर देंगे।',
  '1. Select a Car':
    '1. कार चुनें',
  'Popular cars:':
    'लोकप्रिय कारें:',
  'Change':
    'बदलें',
  '2. Your Details & Slot':
    '2. आपका विवरण और समय',
  'Phone *':
    'फोन *',
  'Email':
    'ईमेल',
  'Preferred Date *':
    'पसंदीदा तारीख *',
  'Time Slot *':
    'समय *',
  'Pickup Location (optional)':
    'पिकअप जगह (वैकल्पिक)',
  'Notes':
    'टिप्पणी',
  '📅 Confirm Test Drive Booking':
    '📅 टेस्ट ड्राइव बुकिंग पक्की करें',
  '🔒 Your details are safe. Seller will confirm within 2 hours.':
    '🔒 आपका विवरण सुरक्षित है। सेलर 2 घंटे के भीतर पुष्टि करेगा।',
  'Test Drive Booked!':
    'टेस्ट ड्राइव बुक हो गई!',
  // ── Media, pricing, about ────────────────────────────────────────────────
  'GAADIIQ Media':
    'GAADIIQ मीडिया',
  'Expert reviews, real owner stories, breaking news and in-depth special reports on the Indian automotive world.':
    'भारतीय ऑटोमोटिव जगत पर विशेषज्ञ समीक्षाएं, असली मालिकों की कहानियां, ताज़ा खबरें और विस्तृत विशेष रिपोर्ट।',
  'Share Your Car Experience':
    'अपनी कार का अनुभव साझा करें',
  'Owned a car? Help thousands of buyers with your honest review — text or video.':
    'कार रखी है? अपनी सच्ची समीक्षा से हजारों खरीदारों की मदद करें — लिखकर या वीडियो से।',
  'Pick a Car to Review →':
    'समीक्षा के लिए कार चुनें →',
  'Featured':
    'चुनिंदा',
  'Stories':
    'कहानियां',
  'Read more →':
    'और पढ़ें →',
  'Curated':
    'चयनित',
  'Articles':
    'लेख',
  'The latest news results above still match your search.':
    'ऊपर दिए ताज़ा समाचार अब भी आपकी खोज से मेल खाते हैं।',
  'Clear Search':
    'खोज हटाएं',
  'Simple,':
    'सरल,',
  'Transparent':
    'पारदर्शी',
  'Pricing':
    'कीमत',
  "Start free. Upgrade when you're ready. No hidden charges, no surprises.":
    'मुफ्त शुरू करें। तैयार हों तब अपग्रेड करें। कोई छिपा शुल्क नहीं, कोई हैरानी नहीं।',
  'Monthly':
    'मासिक',
  'Yearly':
    'सालाना',
  'Save 2 months':
    '2 महीने बचाएं',
  'Full':
    'पूरी',
  'Feature Comparison':
    'फीचर तुलना',
  'Free':
    'मुफ्त',
  'Frequently':
    'अक्सर',
  'Our Story':
    'हमारी कहानी',
  "We're Making Car Buying":
    'हम कार खरीदना बना रहे हैं',
  'Smarter for India':
    'भारत के लिए और समझदार',
  'GAADIIQ was born out of frustration. Our founders spent months trying to buy a used car — only to encounter fake listings, opaque pricing, and pushy dealers. So we built the platform we wished existed.':
    'GAADIIQ परेशानी से जन्मा। हमारे संस्थापकों ने महीनों एक पुरानी कार खरीदने की कोशिश की — और उन्हें मिलीं नकली लिस्टिंग, अस्पष्ट कीमतें और दबाव डालने वाले डीलर। इसलिए हमने वह प्लेटफॉर्म बनाया जो हम चाहते थे कि होता।',
  'Our Mission':
    'हमारा मिशन',
  'To give every Indian car buyer the same advantage that a seasoned industry insider has — real-time market intelligence, AI-powered price analysis, and verified listings — completely free.':
    'हर भारतीय कार खरीदार को वही बढ़त देना जो इंडस्ट्री के अनुभवी जानकार के पास होती है — रीयल-टाइम बाज़ार जानकारी, AI आधारित कीमत विश्लेषण और वेरिफाइड लिस्टिंग — पूरी तरह मुफ्त।',
  'For sellers and dealers, we eliminate friction: instant AI valuations, quality leads, and tools to close faster.':
    'सेलर और डीलर के लिए हम अड़चनें हटाते हैं: तुरंत AI मूल्यांकन, अच्छे लीड और तेज़ी से सौदा पूरा करने के टूल।',
  'What We':
    'हम किसके',
  'Stand For':
    'लिए खड़े हैं',
  'Join':
    'जुड़ें',
  'Smart Car Buyers':
    'समझदार कार खरीदारों से',
  'Find your perfect car with AI-powered recommendations, verified listings, and transparent pricing.':
    'AI आधारित सिफारिशों, वेरिफाइड लिस्टिंग और पारदर्शी कीमतों के साथ अपनी सही कार खोजें।',
  'Browse Cars →':
    'कारें देखें →',
  'Create Free Account':
    'मुफ्त अकाउंट बनाएं',
  // ── App-wide sweep: placeholders, shared components, remaining copy ──────
  'Select make':
    'मेक चुनें',
  'Select model':
    'मॉडल चुनें',
  'Select year':
    'साल चुनें',
  'Select fuel':
    'फ्यूल चुनें',
  'Select condition':
    'हालत चुनें',
  'Select variant (optional)':
    'वेरिएंट चुनें (वैकल्पिक)',
  'Select':
    'चुनें',
  'e.g. 45000':
    'जैसे 45000',
  'e.g. 850000':
    'जैसे 850000',
  'e.g. Kolkata':
    'जैसे कोलकाता',
  'e.g. Nexon, Swift...':
    'जैसे Nexon, Swift...',
  'Search make or model...':
    'मेक या मॉडल खोजें...',
  'you@example.com':
    'you@example.com',
  'your@email.com':
    'your@email.com',
  'Your name':
    'आपका नाम',
  'Your name *':
    'आपका नाम *',
  'Mobile number':
    'मोबाइल नंबर',
  '10-digit number':
    '10 अंकों का नंबर',
  'Pincode':
    'पिनकोड',
  'Your city':
    'आपका शहर',
  'Locality or pincode':
    'इलाका या पिनकोड',
  'Continue':
    'आगे बढ़ें',
  'Done':
    'हो गया',
  'Enter the 6-digit code':
    '6 अंकों का कोड डालें',
  'WhatsApp':
    'WhatsApp',
  'Update':
    'अपडेट',
  'Remove':
    'हटाएं',
  'Review':
    'समीक्षा',
  'Summary':
    'सारांश',
  'Vehicle':
    'गाड़ी',
  'Symptoms':
    'लक्षण',
  'Severity':
    'गंभीरता',
  'Possible Causes':
    'संभावित कारण',
  'Sign in':
    'साइन इन',
  'Back to Sign In':
    'साइन इन पर वापस',
  'Fair Price':
    'उचित कीमत',
  'Is this a fair price?':
    'क्या यह कीमत उचित है?',
  'EMI from':
    'EMI शुरू',
  'ex-showroom':
    'एक्स-शोरूम',
  'Ex-showroom price (₹)':
    'एक्स-शोरूम कीमत (₹)',
  'Car Photos':
    'कार की फोटो',
  'Max Budget:':
    'अधिकतम बजट:',
  'All India':
    'पूरा भारत',
  'All Makes':
    'सभी मेक',
  'Any Budget':
    'कोई भी बजट',
  'Loading cars from database...':
    'डेटाबेस से कारें लोड हो रही हैं...',
  'Used Car':
    'पुरानी कार',
  'Money or time':
    'पैसा या समय',
  'Sell quickly':
    'जल्दी बेचें',
  'Get the most for it':
    'सबसे ज्यादा पाएं',
  'Fastest of the two':
    'दोनों में सबसे तेज़',
  'Expect a longer wait':
    'ज्यादा इंतज़ार करना होगा',
  'No time estimate yet — too few cars have sold here to know how long either choice takes. The prices stand; the waiting time is the part we cannot promise, so we do not.':
    'अभी समय का अनुमान नहीं — यहां इतनी कम कारें बिकी हैं कि यह पता न चले कि किस विकल्प में कितना समय लगेगा। कीमतें सही हैं; इंतज़ार का समय वह हिस्सा है जिसका हम वादा नहीं कर सकते, इसलिए नहीं करते।',
  'Interest in this car':
    'इस कार में दिलचस्पी',
  'views in 24 hours':
    '24 घंटे में देखी गई',
  'people this week':
    'इस हफ्ते लोग',
  'Condition score':
    'हालत का स्कोर',
  'Not included:':
    'शामिल नहीं:',
  'Estimate':
    'अनुमान',
  'Seats':
    'सीटें',
  'Fuel / km':
    'फ्यूल / km',
  'Fuel per km':
    'प्रति km फ्यूल',
  'Side by side':
    'साथ-साथ',
  'See the full model page →':
    'पूरा मॉडल पेज देखें →',
  'One more thing':
    'एक और बात',
  'Roadside help':
    'सड़क किनारे मदद',
  'Find a Nearby Mechanic':
    'पास का मैकेनिक खोजें',
  'Apply for a Car Loan':
    'कार लोन के लिए आवेदन करें',
  'What is my car worth?':
    'मेरी कार की कीमत क्या है?',
  'My Journey':
    'मेरी यात्रा',
  'Tell me what you need, in one line':
    'एक लाइन में बताएं आपको क्या चाहिए',
  'Budget, how many people, where you drive, how far a month.':
    'बजट, कितने लोग, कहां चलाते हैं, महीने में कितना।',
  'Describe what you are looking for':
    'बताएं आप क्या ढूंढ रहे हैं',
  'Find my car':
    'मेरी कार खोजें',
  'Working…':
    'चल रहा है…',
  'Try:':
    'आज़माएं:',
  '← Ask something else':
    '← कुछ और पूछें',
  'What I read':
    'मैंने क्या समझा',
  'Not right? Reword it and ask again.':
    'सही नहीं? दोबारा लिखकर पूछें।',
  'Microphone access':
    'माइक्रोफोन की अनुमति',
  'What happens to your voice':
    'आपकी आवाज़ का क्या होता है',
  'How long we keep it':
    'हम इसे कितने समय रखते हैं',
  'Allow microphone':
    'माइक्रोफोन की अनुमति दें',
  "I've enabled it — try again":
    'मैंने चालू कर दिया — दोबारा कोशिश करें',
  "Not now — I'll type instead":
    'अभी नहीं — मैं लिखकर बताऊंगा',
  'Which language would you like to speak in?':
    'आप किस भाषा में बोलना चाहेंगे?',
  '✨ Detect automatically':
    '✨ अपने आप पहचानें',
  '⏹ Done speaking':
    '⏹ बोलना पूरा',
  'Captured':
    'रिकॉर्ड हुआ',
  'Select your City':
    'अपना शहर चुनें',
  'Popular Cities':
    'लोकप्रिय शहर',
  'Type your Pincode or City':
    'अपना पिनकोड या शहर लिखें',
  'Full Diagnosis Report →':
    'पूरी जांच रिपोर्ट →',
  'Full Diagnosis':
    'पूरी जांच',
  'Car Advisor':
    'कार सलाहकार',
  'Ask ARIA about cars, diagnose issues…':
    'ARIA से कारों के बारे में पूछें, समस्या जांचें…',
  'Finding mechanics near your car…':
    'आपकी कार के पास मैकेनिक खोजे जा रहे हैं…',
  'Allow location access so we can send help to where you actually are.':
    'लोकेशन की अनुमति दें ताकि हम मदद वहीं भेज सकें जहां आप असल में हैं।',
  'or choose one yourself':
    'या खुद चुनें',
  'Car registration number':
    'कार का रजिस्ट्रेशन नंबर',
  'Your phone number':
    'आपका फोन नंबर',
  'Landmark':
    'पहचान की जगह',
  'Your start code':
    'आपका शुरुआती कोड',
  "Mechanic's quote":
    'मैकेनिक का कोटेशन',
  'Pay with a UPI app':
    'UPI ऐप से भुगतान करें',
  'Mechanic receives':
    'मैकेनिक को मिलेगा',
  'Payment confirmed':
    'भुगतान की पुष्टि हो गई',
  'The receipt has been sent to your WhatsApp number.':
    'रसीद आपके WhatsApp नंबर पर भेज दी गई है।',
  'Article not found':
    'लेख नहीं मिला',
  'Browse all articles':
    'सभी लेख देखें',
  "This article doesn't exist or may have been removed.":
    'यह लेख मौजूद नहीं है या हटा दिया गया होगा।',
  '← News':
    '← समाचार',
  '⚙️ Filters':
    '⚙️ फ़िल्टर',
  'Month':
    'महीना',
  'Interest':
    'ब्याज',
  'Balance':
    'बकाया',
  'Amortization Schedule':
    'किस्तों की तालिका',
  '(First 12 months)':
    '(पहले 12 महीने)',
  'Emergency Buffer':
    'आपात बचत',
  'The 20/4/10 rule':
    '20/4/10 नियम',
  'At least':
    'कम से कम',
  'Term of':
    'अवधि',
  '4 years':
    '4 साल',
  'All car costs within':
    'कार के सभी खर्च इसके भीतर',
  'Your details are with us.':
    'आपका विवरण हमारे पास है।',
  'Tell us where you are and a dealer near you will call with their price.':
    'बताएं आप कहां हैं, आपके पास का डीलर अपनी कीमत बताने के लिए कॉल करेगा।',
  'We ask this once, so a dealer can reach you.':
    'हम यह एक बार पूछते हैं, ताकि डीलर आप तक पहुंच सके।',
  // ── Second sweep: remaining template copy found by hindi-coverage.js ─────
  'AI Car':
    'AI कार',
  'AI Price Valuation':
    'AI कीमत मूल्यांकन',
  'AI-First':
    'AI-फर्स्ट',
  'Already have an account?':
    'पहले से अकाउंट है?',
  'Analytics dashboard':
    'एनालिटिक्स डैशबोर्ड',
  'Asked Questions':
    'पूछे जाने वाले सवाल',
  'Adequate':
    'पर्याप्त',
  'Advanced':
    'उन्नत',
  'Basic':
    'बेसिक',
  'Brand New':
    'बिल्कुल नई',
  'Browse listings':
    'लिस्टिंग देखें',
  'Bulk inventory upload':
    'थोक इन्वेंटरी अपलोड',
  'Buyer Pro':
    'Buyer Pro',
  'Dealer Pro':
    'Dealer Pro',
  'Dealer contact details':
    'डीलर संपर्क विवरण',
  'Dedicated account manager':
    'समर्पित अकाउंट मैनेजर',
  'Featured placement':
    'फीचर्ड जगह',
  'Full pipeline':
    'पूरी पाइपलाइन',
  'Lead CRM':
    'लीड CRM',
  'List vehicles':
    'गाड़ियां लिस्ट करें',
  'Unlimited':
    'असीमित',
  'Start Free':
    'मुफ्त शुरू करें',
  'Create Free Account →':
    'मुफ्त अकाउंट बनाएं →',
  'No credit card needed. Upgrade or cancel anytime.':
    'क्रेडिट कार्ड की ज़रूरत नहीं। कभी भी अपग्रेड या रद्द करें।',
  'Confidence Range':
    'विश्वास की सीमा',
  'Demand Signals':
    'मांग के संकेत',
  'Depreciation Curve':
    'मूल्यह्रास वक्र',
  'Market Analysis':
    'बाज़ार विश्लेषण',
  'Age, mileage, and ownership history are factored into the estimate.':
    'उम्र, चली हुई दूरी और मालिकाना इतिहास अनुमान में शामिल हैं।',
  'We scan thousands of recent sale prices for your make and model.':
    'हम आपके मेक और मॉडल की हजारों हालिया बिक्री कीमतें देखते हैं।',
  'You get a low, mid, and high estimate so you know where to price.':
    'आपको कम, मध्यम और ऊंचा अनुमान मिलता है ताकि आप कीमत तय कर सकें।',
  'Continue with Google':
    'Google से जारी रखें',
  'Continue with Facebook':
    'Facebook से जारी रखें',
  'Continue →':
    'आगे बढ़ें →',
  'Next →':
    'आगे →',
  'Next — Describe Symptoms →':
    'आगे — लक्षण बताएं →',
  'Compare loan offers':
    'लोन ऑफर की तुलना करें',
  'Loan amount':
    'लोन राशि',
  'Employment *':
    'रोज़गार *',
  'Full name (as on PAN) *':
    'पूरा नाम (PAN के अनुसार) *',
  'Mobile *':
    'मोबाइल *',
  'Monthly income *':
    'मासिक आय *',
  'PAN number *':
    'PAN नंबर *',
  'Your CIBIL score (if you know it)':
    'आपका CIBIL स्कोर (अगर पता हो)',
  'Your application':
    'आपका आवेदन',
  'How we pick the best':
    'हम सबसे अच्छा कैसे चुनते हैं',
  'We rank by the':
    'हम क्रम तय करते हैं',
  'total cost of the loan':
    'लोन की कुल लागत',
  "Total of any loans you're already repaying.":
    'आप जो लोन पहले से चुका रहे हैं उनका कुल।',
  "Tell us about the car and yourself, and we'll compare what every lender would actually charge.":
    'कार और अपने बारे में बताएं, हम तुलना करेंगे कि हर लेंडर असल में क्या लेगा।',
  'Why we need this:':
    'हमें यह क्यों चाहिए:',
  'car loan':
    'कार लोन',
  'sign in':
    'साइन इन',
  'Manufacturer *':
    'निर्माता *',
  'Model Year *':
    'मॉडल साल *',
  'Transmission *':
    'ट्रांसमिशन *',
  'Odometer Reading (km)':
    'ओडोमीटर रीडिंग (km)',
  'Tell us about your vehicle':
    'अपनी गाड़ी के बारे में बताएं',
  'Fill Manually':
    'खुद भरें',
  'Use Voice':
    'आवाज़ से बताएं',
  'Still unsure?':
    'अब भी तय नहीं?',
  'Your report will be shown on screen. You can play it aloud if you want to.':
    'आपकी रिपोर्ट स्क्रीन पर दिखेगी। चाहें तो उसे सुन भी सकते हैं।',
  'Full Name *':
    'पूरा नाम *',
  'Select time':
    'समय चुनें',
  'Test Drive Booking':
    'टेस्ट ड्राइव बुकिंग',
  'Notify Me':
    'मुझे सूचित करें',
  'New Car Models':
    'नई कार मॉडल',
  'Looking for a':
    'ढूंढ रहे हैं',
  'Purchase':
    'खरीद',
  'Fuel / Energy':
    'फ्यूल / ऊर्जा',
  'Depreciation (value you do not get back)':
    'मूल्यह्रास (जो कीमत वापस नहीं मिलती)',
  '5-Year TCO Comparison':
    '5 साल की कुल लागत तुलना',
  'Try AI Advisor':
    'AI सलाहकार आज़माएं',
  'Use the search boxes above to find any car from our 54-car database':
    'ऊपर दिए खोज बॉक्स से हमारे डेटाबेस की कोई भी कार खोजें',
  "Optional, and taken as your own estimate — we don't check it. Leaving it blank is fine.":
    'वैकल्पिक, और आपके अपने अनुमान के रूप में लिया जाता है — हम इसकी जांच नहीं करते। खाली छोड़ना ठीक है।',
  'A guideline, not a lending criterion — a bank will look at your DTI above all.':
    'यह एक दिशानिर्देश है, कर्ज़ देने की शर्त नहीं — बैंक सबसे पहले आपका DTI देखेगा।',
  '✓ Within safe range (≤40%)':
    '✓ सुरक्षित सीमा में (≤40%)',
  'Adequate ':
    'पर्याप्त ',
  'ARIA · Auto Recommendation & Intelligent Assistant':
    'ARIA · ऑटो रिकमेंडेशन और इंटेलिजेंट असिस्टेंट',
  '⚡ Electric Vehicle':
    '⚡ इलेक्ट्रिक गाड़ी',
  '⛽ Petrol Vehicle':
    '⛽ पेट्रोल गाड़ी',
  '⚡ EV Total Cost':
    '⚡ EV कुल खर्च',
  '⛽ Petrol Total Cost':
    '⛽ पेट्रोल कुल खर्च',
  '✅ EV saves you':
    '✅ EV से आपकी बचत',
  '🚗 Driving Profile':
    '🚗 ड्राइविंग प्रोफाइल',
  '🎉 New':
    '🎉 नई',
  '⏳ Upcoming':
    '⏳ आने वाली',
  '🏆 Expert':
    '🏆 विशेषज्ञ',
  '🏷️ By Brand':
    '🏷️ ब्रांड से',
  '💰 By Budget':
    '💰 बजट से',
  '🚘 By Body Type':
    '🚘 बॉडी टाइप से',
  '🧭 Buyer Journey':
    '🧭 खरीदार यात्रा',
  '🚗 New Cars 2025–26':
    '🚗 नई कारें 2025–26',
  '🔧 Request help now':
    '🔧 अभी मदद मांगें',
  'Light Mode':
    'लाइट मोड',
  'Dark Mode':
    'डार्क मोड',
  'Answer 6 quick questions. Our AI matches you to the ideal car.':
    '6 आसान सवालों के जवाब दें। हमारा AI आपको सही कार से मिलाएगा।',
  'Expert Review':
    'विशेषज्ञ समीक्षा',
  'User Review':
    'यूज़र समीक्षा',
  'Special Report':
    'विशेष रिपोर्ट',
  'Reviews &':
    'समीक्षाएं और',
  'Used cars':
    'पुरानी कारें',
  'English':
    'English',
  'All':
    'सभी',
  "You'll need to":
    'आपको करना होगा',
  'Register as a mechanic':
    'मैकेनिक के रूप में रजिस्टर करें',
  // ── Third sweep: entity-encoded text and home/new-cars copy ──────────────
  '← Reviews & News':
    '← समीक्षाएं और समाचार',
  'ARIA by GAADIIQ ·':
    'ARIA — GAADIIQ द्वारा ·',
  'Comfortable & stylish':
    'आरामदायक और स्टाइलिश',
  'Powerful & versatile':
    'दमदार और हर काम लायक',
  'View All 38 Brands':
    'सभी 38 ब्रांड देखें',
  'Instant fair market valuation — depreciation model + AI analysis when available.':
    'तुरंत उचित बाज़ार मूल्यांकन — मूल्यह्रास मॉडल और उपलब्ध होने पर AI विश्लेषण।',
  'Compare EMI from top banks. Pre-approval in minutes, best rates guaranteed.':
    'बड़े बैंकों की EMI तुलना करें। मिनटों में प्री-अप्रूवल, सबसे अच्छी दरों की गारंटी।',
  'Depreciation-based price analysis and resale value estimates for any model.':
    'किसी भी मॉडल के लिए मूल्यह्रास आधारित कीमत विश्लेषण और पुनर्विक्रय अनुमान।',
  'Set your target price. Get notified the moment a listing drops below it.':
    'अपनी लक्ष्य कीमत तय करें। कोई लिस्टिंग उससे नीचे आते ही सूचना पाएं।',
  'Book a test drive directly with the seller — from your couch, right now.':
    'सीधे सेलर के साथ टेस्ट ड्राइव बुक करें — अभी, घर बैठे।',
  'Top Match: Tata Nexon EV':
    'सबसे बढ़िया मेल: Tata Nexon EV',
  '98% compatibility score':
    '98% अनुकूलता स्कोर',
  '↑ 2.4% vs last month':
    '↑ पिछले महीने से 2.4%',
  'Max Budget: ₹1 Cr':
    'अधिकतम बजट: ₹1 Cr',
  'Under ₹5L':
    '₹5L से कम',
  'Above ₹30L':
    '₹30L से ऊपर',
  'Above ₹20L':
    '₹20L से ऊपर',
  'Stellar mileage, feature-rich at this price point':
    'शानदार माइलेज, इस कीमत में भरपूर फीचर',
  'Longest real-world range, excellent after-sales':
    'असल में सबसे ज्यादा रेंज, बेहतरीन आफ्टर-सेल्स',
  '6/7-seater, top safety scores, premium interiors':
    '6/7 सीटर, बेहतरीन सेफ्टी स्कोर, प्रीमियम इंटीरियर',
  // ── Advisor result cards (client-side labels only; see note below) ───────
  'Top 3 for you':
    'आपके लिए टॉप 3',
  'from':
    'में से',
  'models considered':
    'मॉडल देखे गए',
  'Where these numbers come from':
    'ये आंकड़े कहां से आए',
  'Hide the breakdown':
    'ब्यौरा छिपाएं',
  'Resale at 5 yrs':
    '5 साल पर पुनर्विक्रय',
  '5-year cost':
    '5 साल का खर्च',
  '5-Year cost':
    '5 साल का खर्च',
  // ── Valuation result panel and pricing strategy ──────────────────────────
  'Total Depreciation':
    'कुल मूल्यह्रास',
  'Market Trend':
    'बाज़ार का रुझान',
  'Kilometres':
    'किलोमीटर',
  'Condition':
    'हालत',
  'Dealer Forecourt':
    'डीलर के यहां',
  'What a dealer asks, reconditioned':
    'डीलर जो मांगता है, ठीक कराने के बाद',
  'A dealer gets more for the same car because they recondition it, back it with a warranty and sell it from a showroom. Selling privately you skip all three — and the difference is what that costs.':
    'डीलर उसी कार के ज्यादा पैसे लेता है क्योंकि वह उसे ठीक कराता है, वारंटी देता है और शोरूम से बेचता है। निजी तौर पर बेचने में ये तीनों नहीं होते — और यही अंतर उसकी कीमत है।',
  'Typically under':
    'आमतौर पर',
  'days':
    'दिन में',
  'Often':
    'अक्सर',
  'days or more':
    'दिन या ज्यादा',
  // ── Diagnosis review and result screens ─────────────────────────────────
  'Review & submit for AI analysis':
    'AI विश्लेषण के लिए जांचें और भेजें',
  'Make & Model':
    'मेक और मॉडल',
  'Fuel / Transmission':
    'फ्यूल / ट्रांसमिशन',
  'Odometer':
    'ओडोमीटर',
  'Warning Lights':
    'चेतावनी लाइट',
  'Occurs During':
    'कब होता है',
  'Problem Description':
    'समस्या का विवरण',
  'High':
    'ज्यादा',
  'Medium':
    'मध्यम',
  'Low':
    'कम',
  '← Edit':
    '← बदलें',
  'Analyse with AI':
    'AI से विश्लेषण करें',
  'Preliminary Diagnosis':
    'प्रारंभिक जांच',
  'Moderate Repair':
    'मध्यम मरम्मत',
  'Minor Repair':
    'छोटी मरम्मत',
  'Major Repair':
    'बड़ी मरम्मत',
  'Do NOT drive — immediate inspection required':
    'गाड़ी न चलाएं — तुरंत जांच ज़रूरी',
  'Professional service required as soon as possible.':
    'जल्द से जल्द पेशेवर सर्विस ज़रूरी है।',
  'Drive with caution — get it checked soon':
    'सावधानी से चलाएं — जल्दी जांच कराएं',
  'Safe to drive — monitor the symptoms':
    'चलाना सुरक्षित है — लक्षणों पर नज़र रखें',
  'This AI analysis is a':
    'यह AI विश्लेषण एक',
  'preliminary assessment only':
    'सिर्फ प्रारंभिक आकलन है',
  '. It is not a professional diagnosis. Always consult a certified mechanic before making any repair decisions.':
    '। यह पेशेवर जांच नहीं है। मरम्मत का कोई भी फैसला लेने से पहले हमेशा प्रमाणित मैकेनिक से सलाह लें।',
  // ── Diagnosis: attachments step, result sections, disclaimer ────────────
  'Next — Review →':
    'आगे — समीक्षा →',
  'Sound recording':
    'आवाज़ की रिकॉर्डिंग',
  'Video clip':
    'वीडियो क्लिप',
  'Tap to attach a recording of the noise':
    'आवाज़ की रिकॉर्डिंग जोड़ने के लिए टैप करें',
  'Engine knock, brake squeal, rattle — max 25 MB':
    'इंजन की खटखट, ब्रेक की चीं, खड़खड़ाहट — अधिकतम 25 MB',
  'Tap to attach a short video of the issue':
    'समस्या का छोटा वीडियो जोड़ने के लिए टैप करें',
  'Smoke, warning lights, unusual movement — max 75 MB':
    'धुआं, चेतावनी लाइट, असामान्य हरकत — अधिकतम 75 MB',
  'Estimated Cost':
    'अनुमानित खर्च',
  'Repair Time':
    'मरम्मत का समय',
  'Recommended Next Steps':
    'सुझाए गए अगले कदम',
  'Safe DIY Checks':
    'खुद से करने लायक सुरक्षित जांच',
  'These are preliminary checks you can safely perform yourself — they are not repairs:':
    'ये शुरुआती जांचें हैं जो आप खुद सुरक्षित रूप से कर सकते हैं — ये मरम्मत नहीं हैं:',
  'Preventive Maintenance Tips':
    'रखरखाव के सुझाव',
  'Knowledge Sources':
    'जानकारी के स्रोत',
  'Listen to this report':
    'यह रिपोर्ट सुनें',
  'Voice ready':
    'आवाज़ तैयार',
  'Find a mechanic':
    'मैकेनिक खोजें',
  '+ New Diagnosis':
    '+ नई जांच',
  '⚠️ IMPORTANT DISCLAIMER: This is a preliminary AI-assisted assessment only. It is NOT a professional diagnosis. Results may be inaccurate or incomplete. A certified automotive mechanic must physically inspect the vehicle to confirm any diagnosis. For safety-critical issues (brakes, steering, engine warning lights), do NOT drive the vehicle until it has been professionally inspected. Never attempt repairs beyond your skill level.':
    '⚠️ ज़रूरी सूचना: यह सिर्फ AI की मदद से किया गया शुरुआती आकलन है। यह पेशेवर जांच नहीं है। नतीजे गलत या अधूरे हो सकते हैं। किसी भी जांच की पुष्टि के लिए प्रमाणित मैकेनिक का गाड़ी को खुद देखना ज़रूरी है। सुरक्षा से जुड़ी समस्याओं (ब्रेक, स्टीयरिंग, इंजन की चेतावनी लाइट) में पेशेवर जांच होने तक गाड़ी न चलाएं। अपनी क्षमता से बाहर की मरम्मत कभी न करें।',
  'e.g. Brake pads replaced':
    'जैसे ब्रेक पैड बदले गए',
  'When (e.g. May 2026)':
    'कब (जैसे मई 2026)',
  '+ Add':
    '+ जोड़ें',

  // ── Insurance (BRD §6). Terms of art stay in the form Indian buyers meet
  //    them in: IDV and NCB are used untranslated on every policy document
  //    and in every agent conversation, so translating them into a coined
  //    Hindi phrase would make the page harder to read, not easier. The
  //    explanation around them is what needs to be in Hindi.
  'Car Insurance':
    'कार बीमा',
  'Renew Insurance':
    'बीमा रिन्यू करें',
  'What is IDV?':
    'IDV क्या है?',
  'Add-ons Explained':
    'ऐड-ऑन की जानकारी',
  'Understand your cover before you buy it':
    'खरीदने से पहले अपना कवर समझें',
  'What IDV, NCB and each add-on actually mean for what you pay and what you get back.':
    'IDV, NCB और हर ऐड-ऑन का आपके भुगतान और आपको मिलने वाली रकम पर क्या असर पड़ता है।',
  'Tell us when your policy expires':
    'बताइए आपकी पॉलिसी कब खत्म हो रही है',
  'GAADIIQ does not sell, price or issue insurance. When cover becomes available here it will be provided by a regulated insurance partner, and named as theirs.':
    'GAADIIQ बीमा न तो बेचता है, न उसकी कीमत तय करता है, न जारी करता है। जब यहाँ कवर उपलब्ध होगा, वह किसी नियामक-अनुमोदित बीमा पार्टनर द्वारा दिया जाएगा और उन्हीं के नाम से दिखाया जाएगा।',
  'The three kinds of cover':
    'कवर के तीन प्रकार',
  'Comprehensive':
    'कॉम्प्रिहेंसिव',
  'Covers damage to your own car as well as to others.':
    'आपकी अपनी कार और दूसरों — दोनों के नुकसान को कवर करता है।',
  'Pays for repairs to your car after an accident, and for theft, fire and natural disasters — plus everything third-party cover includes. This is what most people mean by "full" insurance.':
    'दुर्घटना के बाद आपकी कार की मरम्मत, तथा चोरी, आग और प्राकृतिक आपदा का खर्च देता है — साथ ही वह सब जो थर्ड-पार्टी कवर में आता है। ज़्यादातर लोग "फुल" बीमा इसी को कहते हैं।',
  'Third-Party':
    'थर्ड-पार्टी',
  'The legal minimum. Does NOT cover your own car.':
    'कानूनन न्यूनतम ज़रूरत। आपकी अपनी कार को कवर नहीं करता।',
  'Required by law to drive on Indian roads. It pays for injury or damage you cause to other people and their property. It pays nothing towards repairing your own car, however the accident happened.':
    'भारतीय सड़कों पर गाड़ी चलाने के लिए कानूनन ज़रूरी। यह दूसरों को या उनकी संपत्ति को आपसे हुए नुकसान का भुगतान करता है। दुर्घटना चाहे जैसे भी हुई हो, आपकी अपनी कार की मरम्मत के लिए यह कुछ नहीं देता।',
  'Own Damage':
    'ओन डैमेज',
  'Covers your car only. Bought alongside third-party cover.':
    'सिर्फ़ आपकी कार को कवर करता है। थर्ड-पार्टी कवर के साथ लिया जाता है।',
  'Covers repairs to your own car, and is bought in addition to a separate third-party policy rather than instead of one. Useful if your third-party cover still has time left on it.':
    'आपकी अपनी कार की मरम्मत कवर करता है, और अलग थर्ड-पार्टी पॉलिसी के बदले नहीं बल्कि उसके साथ लिया जाता है। अगर आपके थर्ड-पार्टी कवर में अभी समय बचा है तो यह काम आता है।',
  'The words that decide what you pay':
    'वे शब्द जो तय करते हैं कि आप कितना देंगे',
  'Insured Declared Value — the most a claim can pay out.':
    'Insured Declared Value — क्लेम में मिलने वाली अधिकतम रकम।',
  'No Claim Bonus — a discount for years without a claim.':
    'No Claim Bonus — बिना क्लेम वाले सालों पर मिलने वाली छूट।',
  'Deductible':
    'डिडक्टिबल',
  'The part of every claim you pay yourself.':
    'हर क्लेम का वह हिस्सा जो आप खुद देते हैं।',
  'Add-ons, and when they are not worth it':
    'ऐड-ऑन, और कब वे लेने लायक नहीं',
  'Every add-on raises your premium. These are the ones worth understanding before you are asked to tick them.':
    'हर ऐड-ऑन आपका प्रीमियम बढ़ाता है। टिक करने से पहले इन्हें समझ लेना ठीक रहेगा।',
  'Add-on':
    'ऐड-ऑन',
  'What it covers':
    'क्या कवर होता है',
  'When to skip it':
    'कब छोड़ देना बेहतर',
  'We will get in touch when insurance goes live on GAADIIQ. Your policy expiry date is the useful part — it tells us when to contact you rather than how often.':
    'GAADIIQ पर बीमा शुरू होते ही हम आपसे संपर्क करेंगे। सबसे काम की जानकारी आपकी पॉलिसी की समाप्ति तिथि है — इससे हमें पता चलता है कि आपसे कब संपर्क करना है, न कि कितनी बार।',
  'Year of manufacture':
    'निर्माण वर्ष',
  'Where the car is registered':
    'कार कहाँ रजिस्टर्ड है',
  'Registration number':
    'रजिस्ट्रेशन नंबर',
  'Current policy expires':
    'मौजूदा पॉलिसी की समाप्ति',
  'Current insurer':
    'मौजूदा बीमा कंपनी',
  'I agree that GAADIIQ may contact me about insurance for this vehicle, and may share these details with a regulated insurance partner once one is available.':
    'मैं सहमत हूँ कि GAADIIQ इस वाहन के बीमा के बारे में मुझसे संपर्क कर सकता है, और उपलब्ध होने पर ये विवरण किसी नियामक-अनुमोदित बीमा पार्टनर के साथ साझा कर सकता है।',
  'Tell me when it is available':
    'उपलब्ध होने पर मुझे बताएं',
  'Noted — thank you':
    'दर्ज कर लिया — धन्यवाद',
  'We have your details and will contact you when insurance goes live on GAADIIQ.':
    'आपके विवरण हमारे पास हैं। GAADIIQ पर बीमा शुरू होते ही हम आपसे संपर्क करेंगे।',
  'We could not record your details just now. Please try again in a moment.':
    'अभी आपके विवरण दर्ज नहीं हो सके। कृपया थोड़ी देर बाद फिर कोशिश करें।',

  // Explainer bodies and add-on descriptions. These are the strings a person
  // reading in Hindi most needs — the short labels are guessable from context,
  // a paragraph explaining what NCB costs you is not.
  'IDV is the value your insurer puts on your car for the policy year. It is the maximum they will pay if the car is stolen or written off.':
    'IDV वह मूल्य है जो आपकी बीमा कंपनी उस पॉलिसी वर्ष के लिए आपकी कार का तय करती है। कार चोरी होने या पूरी तरह खराब हो जाने पर वे अधिकतम इतना ही देंगे।',
  'It is set by the insurer from the manufacturer\'s listed price minus depreciation for the car\'s age — not by you, and not by GAADIIQ.':
    'यह बीमा कंपनी तय करती है — निर्माता की सूचीबद्ध कीमत में से कार की उम्र के हिसाब से मूल्यह्रास घटाकर। न आप इसे तय करते हैं, न GAADIIQ।',
  'A lower IDV means a lower premium and a smaller payout. Choosing the lowest IDV on offer to save on the premium is the trade people most often regret making.':
    'कम IDV का मतलब कम प्रीमियम और कम भुगतान। प्रीमियम बचाने के लिए सबसे कम IDV चुन लेना वह सौदा है जिसका पछतावा लोगों को सबसे ज़्यादा होता है।',
  'Each policy year you do not claim, your renewal discount rises: 20% after the first year, then 25%, 35%, 45% and 50% after five.':
    'हर पॉलिसी वर्ष जिसमें आप क्लेम नहीं करते, आपकी रिन्यूअल छूट बढ़ती है: पहले साल के बाद 20%, फिर 25%, 35%, 45% और पाँच साल बाद 50%।',
  'The bonus belongs to you, not to the car. It moves with you when you sell and buy another, provided you transfer it in time.':
    'यह बोनस आपका है, कार का नहीं। कार बेचकर दूसरी लेने पर यह आपके साथ जाता है, बशर्ते आप इसे समय पर ट्रांसफर करा लें।',
  'One claim resets it. This is why a small claim can cost more over the following years than paying for the repair yourself.':
    'एक क्लेम इसे शून्य कर देता है। इसीलिए छोटा क्लेम आगे के सालों में उस मरम्मत से ज़्यादा महँगा पड़ सकता है जो आप खुद करा लेते।',
  'Also called the excess. A compulsory deductible is fixed by regulation and depends on engine size; you can agree to a higher voluntary one in exchange for a lower premium.':
    'इसे एक्सेस भी कहते हैं। अनिवार्य डिडक्टिबल नियमों से तय होता है और इंजन के आकार पर निर्भर करता है; कम प्रीमियम के बदले आप इससे ज़्यादा स्वैच्छिक राशि पर सहमत हो सकते हैं।',
  'It applies to each claim, not each year.':
    'यह हर क्लेम पर लगता है, हर साल पर नहीं।',
  'Zero Depreciation':
    'ज़ीरो डेप्रिसिएशन',
  'Pays the full cost of replaced parts, without deducting for age.':
    'बदले गए पुर्ज़ों की पूरी कीमत देता है, उम्र के हिसाब से कटौती किए बिना।',
  'Rarely offered, and rarely worth it, on cars older than about five years.':
    'लगभग पाँच साल से पुरानी कारों पर यह कम ही मिलता है, और कम ही फ़ायदेमंद होता है।',
  'Engine Protection':
    'इंजन प्रोटेक्शन',
  'Covers engine damage from water ingress or oil leakage.':
    'पानी भरने या तेल रिसाव से हुए इंजन के नुकसान को कवर करता है।',
  'Least useful if you never park or drive where water collects.':
    'अगर आप कभी वहाँ पार्क या ड्राइव नहीं करते जहाँ पानी भरता है, तो इसकी सबसे कम ज़रूरत है।',
  'Towing, jump-starts, flat tyres and lockouts.':
    'टोइंग, जंप-स्टार्ट, पंचर और चाबी अंदर रह जाने पर मदद।',
  'Often already included with a new car\'s warranty package.':
    'नई कार के वारंटी पैकेज में यह अक्सर पहले से शामिल होता है।',
  'Return to Invoice':
    'रिटर्न टू इनवॉइस',
  'Pays the original invoice price if the car is stolen or written off, not the depreciated IDV.':
    'कार चोरी होने या पूरी तरह खराब होने पर घटी हुई IDV नहीं, बल्कि मूल इनवॉइस कीमत देता है।',
  'Only meaningful in the first few years, while invoice and IDV still differ a lot.':
    'सिर्फ़ शुरुआती कुछ सालों में मायने रखता है, जब तक इनवॉइस और IDV में बड़ा अंतर है।',
  'Consumables Cover':
    'कंज़्यूमेबल्स कवर',
  'Pays for oils, coolant, nuts and bolts, which a standard claim excludes.':
    'तेल, कूलेंट, नट-बोल्ट का खर्च देता है, जिन्हें सामान्य क्लेम में शामिल नहीं किया जाता।',
  'A small sum on most claims; worth it mainly on expensive cars.':
    'ज़्यादातर क्लेम में यह छोटी रकम होती है; मुख्य रूप से महँगी कारों पर फ़ायदेमंद।',

  // Fuel values are rendered lowercase from the option list.
  'petrol':
    'पेट्रोल',
  'diesel':
    'डीज़ल',
  'electric':
    'इलेक्ट्रिक',
  'cng':
    'CNG',
  'hybrid':
    'हाइब्रिड',

  'Mobile':
    'मोबाइल',
  'Optional':
    'वैकल्पिक',
  'e.g. Maruti Suzuki':
    'जैसे मारुति सुज़ुकी',
  'e.g. Swift':
    'जैसे स्विफ़्ट',
  'e.g. 2021':
    'जैसे 2021',
  'Please enter the make and model of your car.':
    'कृपया अपनी कार का मेक और मॉडल भरें।',
  'Please enter your mobile number.':
    'कृपया अपना मोबाइल नंबर भरें।',
  'That does not look like an Indian mobile number. Ten digits starting 6, 7, 8 or 9.':
    'यह भारतीय मोबाइल नंबर नहीं लग रहा। 6, 7, 8 या 9 से शुरू होने वाले दस अंक।',
  'Please tick the box above so we know we may contact you.':
    'कृपया ऊपर का बॉक्स टिक करें ताकि हमें पता चले कि हम आपसे संपर्क कर सकते हैं।',
  'Sending…':
    'भेजा जा रहा है…',
  // ── Track Challan ────────────────────────────────────────────────────────
  //    "Challan" stays as चालान — the word every Indian driver, RTO notice and
  //    payment portal uses. Translating it to a coined synonym would make the
  //    page harder to read, not easier.
  'More':
    'और',
  'Track Challan':
    'चालान ट्रैक करें',
  'Check a vehicle for outstanding challans':
    'किसी वाहन के बकाया चालान जांचें',
  'Enter a registration number to see what GAADIIQ\'s verification source holds for that vehicle.':
    'रजिस्ट्रेशन नंबर डालें और देखें कि GAADIIQ के सत्यापन स्रोत के पास उस वाहन के बारे में क्या है।',
  'Vehicle registration number':
    'वाहन रजिस्ट्रेशन नंबर',
  'Check challans':
    'चालान जांचें',
  'Checking…':
    'जांचा जा रहा है…',
  'That does not look like a registration number.':
    'यह रजिस्ट्रेशन नंबर नहीं लग रहा।',
  'We could not check this vehicle':
    'हम इस वाहन की जांच नहीं कर सके',
  'GAADIIQ verifies challans through an authorised government data source. That connection is not live yet, so we cannot tell you anything about this vehicle — and we will not guess.':
    'GAADIIQ चालान की जांच एक अधिकृत सरकारी डेटा स्रोत से करता है। वह कनेक्शन अभी चालू नहीं है, इसलिए हम इस वाहन के बारे में कुछ नहीं बता सकते — और हम अनुमान नहीं लगाएंगे।',
  'You can check it yourself on the official portal:':
    'आप इसे आधिकारिक पोर्टल पर स्वयं जांच सकते हैं:',
  'Checked on':
    'जांच की तारीख',
  'Challans found':
    'मिले चालान',
  'Still outstanding':
    'अब भी बकाया',
  'Total outstanding':
    'कुल बकाया',
  'Challan':
    'चालान',
  'Outstanding':
    'बकाया',
  'Check another vehicle':
    'दूसरा वाहन जांचें',
  'A challan check reflects what the verification source held at the moment it was asked. Records can be added later for earlier offences, so a check is never proof that a vehicle has never had a challan.':
    'चालान जांच वही दिखाती है जो सत्यापन स्रोत के पास पूछे जाने के समय था। पुराने उल्लंघनों के रिकॉर्ड बाद में भी जुड़ सकते हैं, इसलिए यह जांच कभी इस बात का प्रमाण नहीं है कि वाहन पर कभी चालान नहीं रहा।',
  'We could not reach the verification service just now. Please try again in a moment.':
    'हम अभी सत्यापन सेवा तक नहीं पहुंच सके। कृपया थोड़ी देर बाद फिर कोशिश करें।',
};
