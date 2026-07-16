import { Injectable, signal } from '@angular/core';

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
  },
};

@Injectable({ providedIn: 'root' })
export class LanguageService {
  readonly lang = signal<Lang>(
    (localStorage.getItem('gaadiiq_lang') as Lang) ?? 'en'
  );

  toggle() {
    const next: Lang = this.lang() === 'en' ? 'hi' : 'en';
    this.lang.set(next);
    localStorage.setItem('gaadiiq_lang', next);
  }

  t(key: string): string {
    return TRANSLATIONS[this.lang()][key] ?? TRANSLATIONS['en'][key] ?? key;
  }
}
