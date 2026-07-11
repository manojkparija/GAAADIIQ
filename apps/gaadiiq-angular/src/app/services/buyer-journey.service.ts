import { Injectable, signal, computed } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';

export interface BuyerProfile {
  budget: string;
  useCase: string;
  fuelPreference: string;
  transmission: string;
  bodyType: string;
  city: string;
  priority: string;
  completedAt?: string;
}

export const JOURNEY_STEPS = [
  {
    id: 'budget', question: 'What is your budget?',
    questionHi: 'आपका बजट क्या है?',
    options: ['Under ₹5L', '₹5L–₹10L', '₹10L–₹15L', '₹15L–₹20L', 'Above ₹20L'],
  },
  {
    id: 'useCase', question: 'How will you primarily use the car?',
    questionHi: 'आप मुख्य रूप से कार का उपयोग कैसे करेंगे?',
    options: ['Daily City Commute', 'Highway Touring', 'Family Outings', 'Office & Weekend', 'Cab / Commercial'],
  },
  {
    id: 'fuelPreference', question: 'Which fuel type do you prefer?',
    questionHi: 'आप कौन सा ईंधन पसंद करते हैं?',
    options: ['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid', 'No Preference'],
  },
  {
    id: 'transmission', question: 'Gear preference?',
    questionHi: 'गियर प्राथमिकता?',
    options: ['Manual', 'Automatic', 'No Preference'],
  },
  {
    id: 'bodyType', question: 'Preferred body style?',
    questionHi: 'पसंदीदा बॉडी स्टाइल?',
    options: ['Hatchback', 'Sedan', 'SUV / Compact SUV', 'MUV / Van', 'No Preference'],
  },
  {
    id: 'priority', question: 'What matters most to you?',
    questionHi: 'आपके लिए सबसे महत्वपूर्ण क्या है?',
    options: ['Fuel Efficiency', 'Safety Features', 'Comfort & Features', 'Performance', 'Low Maintenance Cost'],
  },
];

@Injectable({ providedIn: 'root' })
export class BuyerJourneyService {
  readonly profile = signal<BuyerProfile | null>(
    JSON.parse(localStorage.getItem('gaadiiq_journey') ?? 'null')
  );

  readonly isComplete = computed(() => !!this.profile());

  constructor(private sb: SupabaseService, private auth: AuthService) {}

  saveProfile(profile: BuyerProfile) {
    const p = { ...profile, completedAt: new Date().toISOString() };
    this.profile.set(p);
    localStorage.setItem('gaadiiq_journey', JSON.stringify(p));
    this.persistToDb(p);
  }

  private persistToDb(p: BuyerProfile): void {
    const sid = sessionStorage.getItem('gaadiiq_sid') ?? undefined;
    this.sb.client.from('buyer_journeys').insert({
      user_email:      this.auth.currentUser()?.email ?? null,
      session_id:      sid,
      budget:          p.budget,
      use_case:        p.useCase,
      fuel_preference: p.fuelPreference,
      transmission:    p.transmission,
      body_type:       p.bodyType,
      city:            p.city,
      priority:        p.priority,
      completed_at:    p.completedAt,
    }).then(({ error }) => {
      if (error) console.warn('[journey] persist failed:', error.message);
    });
  }

  clearProfile() {
    this.profile.set(null);
    localStorage.removeItem('gaadiiq_journey');
  }

  getRecommendationSummary(): string {
    const p = this.profile();
    if (!p) return '';
    return `${p.budget} budget · ${p.fuelPreference} · ${p.bodyType} · ${p.useCase}`;
  }
}
