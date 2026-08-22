import { Injectable, signal } from '@angular/core';
import { HINDI } from './hindi';

export type Lang = 'en' | 'hi';

export const TRANSLATIONS: Record<Lang, Record<string, string>> = {
  en: {
    home: 'Home', browseCars: 'Browse Cars', aiAdvisor: 'AI Advisor',
    compare: 'Compare', emiCalc: 'EMI Calc', reviewsNews: 'Reviews & News',
    listYourCar: 'List Your Car', signIn: 'Sign In', selectCity: 'Select City',
    searchPlaceholder: 'Search make, model, body type, city, year…',
    viewDetails: 'View Details', fairPrice: 'AI: Fair Price',
    tco: 'Total Cost of Ownership', resale: 'Resale Value',
    maintenance: 'Maintenance Cost', buyerJourney: 'My Journey',
    dealerDashboard: 'Dealer Dashboard', askAnything: 'Ask anything about buying a car…',
    multilingual: 'हिंदी',
    // The navigation bar. These are the labels sitting next to the language
    // picker, so they are the first thing that has to change when it is used —
    // a picker that leaves everything beside it in English reads as broken
    // rather than as partial.
    navHome: 'Home', navNewCars: 'New Cars', navUsedCars: 'Used Cars',
    navCompare: 'Compare', navEmi: 'EMI', navCarLoan: 'Car Loan',
    navTco: 'TCO', navNews: 'News', navJourney: 'Journey',
    navAiAdvisor: 'AI Advisor', navAiDiagnosis: 'AI Diagnosis',
    navAiCarValue: 'AI Car Value', navFindMechanic: 'Find Mechanic',
    language: 'Language', english: 'English', hindi: 'हिन्दी',
  },
  hi: {
    home: 'होम', browseCars: 'कारें देखें', aiAdvisor: 'AI सलाहकार',
    compare: 'तुलना', emiCalc: 'EMI कैलक्युलेटर', reviewsNews: 'समीक्षाएं और समाचार',
    listYourCar: 'अपनी कार लिस्ट करें', signIn: 'साइन इन', selectCity: 'शहर चुनें',
    searchPlaceholder: 'मेक, मॉडल, बॉडी टाइप, शहर, साल खोजें…',
    viewDetails: 'विवरण देखें', fairPrice: 'AI: उचित मूल्य',
    tco: 'कुल स्वामित्व लागत', resale: 'पुनर्विक्रय मूल्य',
    maintenance: 'रखरखाव लागत', buyerJourney: 'मेरी यात्रा',
    dealerDashboard: 'डीलर डैशबोर्ड', askAnything: 'कार खरीदने के बारे में कुछ भी पूछें…',
    multilingual: 'English',
    navHome: 'होम', navNewCars: 'नई कारें', navUsedCars: 'पुरानी कारें',
    navCompare: 'तुलना', navEmi: 'EMI', navCarLoan: 'कार लोन',
    navTco: 'खर्च', navNews: 'समाचार', navJourney: 'मेरी यात्रा',
    navAiAdvisor: 'AI सलाहकार', navAiDiagnosis: 'AI जांच',
    navAiCarValue: 'AI कार मूल्य', navFindMechanic: 'मैकेनिक खोजें',
    language: 'भाषा', english: 'English', hindi: 'हिन्दी',
  },
};

export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  // Endonym, not "Hindi": someone who reads only Hindi has to be able to find
  // their own language in the list.
  { code: 'hi', label: 'हिन्दी' },
];

@Injectable({ providedIn: 'root' })
export class LanguageService {
  readonly lang = signal<Lang>(LanguageService.stored());

  /**
   * A stored choice wins; otherwise English.
   *
   * Deliberately not navigator.language: most of the site is still written in
   * English, so guessing Hindi from a phone's locale would hand a Hindi
   * speaker a half-translated page they did not ask for. An explicit choice is
   * the only thing that switches it.
   *
   * Wrapped because localStorage throws outright in a browser set to block
   * site data, and a navbar that cannot construct takes the whole app down.
   */
  private static stored(): Lang {
    try {
      const v = localStorage.getItem('gaadiiq_lang');
      return v === 'hi' || v === 'en' ? v : 'en';
    } catch {
      return 'en';
    }
  }

  set(lang: Lang) {
    this.lang.set(lang);
    try {
      localStorage.setItem('gaadiiq_lang', lang);
    } catch {
      // A choice that cannot be remembered still applies for this visit.
    }
  }

  toggle() {
    this.set(this.lang() === 'en' ? 'hi' : 'en');
  }

  /**
   * Translate a sentence of English UI copy.
   *
   * Falls back to the English it was given, so a string with no Hindi yet
   * renders exactly as it did before — a page can be translated a piece at a
   * time without any stage of that work looking broken.
   */
  translate(text: string): string {
    if (this.lang() === 'en') return text;
    return HINDI[text] ?? text;
  }

  t(key: string): string {
    return TRANSLATIONS[this.lang()][key] ?? TRANSLATIONS['en'][key] ?? key;
  }
}
