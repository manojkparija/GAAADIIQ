import { Component, signal, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { CarsDataService, Car } from '../../services/cars-data.service';
import { SeoService } from '../../services/seo.service';
import { AnalyticsService } from '../../services/analytics.service';
import { IconComponent } from '../../components/icon/icon.component';
import { ApiService } from '../../services/api.service';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ImgFallbackDirective } from '../../directives/img-fallback.directive';
import { AdvisorBriefComponent } from '../../components/advisor-brief/advisor-brief.component';

// ── Constants ──────────────────────────────────────────────────────────────

const BUDGET_MAP: Record<string, [number, number]> = {
  'Under ₹5L':    [0, 500000],
  '₹5L – ₹10L':  [500000, 1000000],
  '₹10L – ₹15L': [1000000, 1500000],
  '₹15L – ₹20L': [1500000, 2000000],
  '₹20L – ₹30L': [2000000, 3000000],
  'Above ₹30L':  [3000000, Infinity],
};

const DAILY_KM: Record<string, number> = {
  '< 20 km/day': 15, '20 – 50 km/day': 35,
  '50 – 100 km/day': 75, '100+ km/day': 120,
};

const MAINT: Record<string, number> = {
  'Maruti Suzuki': 8000, 'Hyundai': 10000, 'Toyota': 10000,
  'Honda': 11000, 'Tata': 13000, 'Mahindra': 14000,
  'Kia': 12000, 'MG Motor': 13000,
};

const RESALE: Record<string, number> = {
  'Maruti Suzuki': 0.65, 'Toyota': 0.62, 'Hyundai': 0.58,
  'Honda': 0.58, 'Kia': 0.55, 'Mahindra': 0.55,
  'Tata': 0.52, 'MG Motor': 0.50,
};

const ANALYZE_MSGS = [
  { icon: 'search', text: 'Profiling your requirements...' },
  { icon: '🧮', text: 'Evaluating vehicles against your answers...' },
  { icon: 'calculator', text: 'Calculating 5-year ownership costs...' },
  { icon: 'bar-chart', text: 'Scoring listings against your profile...' },
  { icon: '✨', text: 'Ranking your best matches...' },
];

// ── Types ──────────────────────────────────────────────────────────────────

interface AdvisorStep {
  key: string; title: string; icon: string; subtitle: string;
  category: string; multi: boolean; ev?: boolean;
  options: { label: string; sub: string }[];
}

export interface RecommendedCar extends Car {
  matchScore: number; confidence: string;
  reasons: string[]; pros: string[]; cons: string[];
  monthlyFuel: number; monthlyEmi: number;
  annualMaintenance: number; fiveYearTco: number;
  costPerKm: number; resale5yr: number;
  categoryBadges: string[];
}

// ── Component ──────────────────────────────────────────────────────────────

@Component({
  selector: 'app-ai-advisor',
  standalone: true,
  imports: [RouterLink, CommonModule, IconComponent, ImgFallbackDirective, AdvisorBriefComponent],
  templateUrl: './ai-advisor.component.html',
  styleUrl: './ai-advisor.component.scss'
})
export class AiAdvisorComponent {
  phase = signal<'quiz' | 'analyzing' | 'results'>('quiz');
  stepIdx = signal(0);
  analyzeMsg = signal(ANALYZE_MSGS[0]);
  analyzePct = signal(0);
  profile = signal<Record<string, string | string[]>>({});
  results = signal<RecommendedCar[]>([]);
  showComparison = signal(false);
  backendBoostIds = signal<Set<string>>(new Set());

  // AI chat (MOB-014)
  chatOpen   = signal(false);
  chatInput  = signal('');
  chatBusy   = signal(false);
  chatMessages = signal<{ role: 'user' | 'ai'; text: string }[]>([]);

  openChat()  { this.chatOpen.set(true); }
  closeChat() { this.chatOpen.set(false); }

  async sendChat(msg: string): Promise<void> {
    const text = msg.trim();
    if (!text || this.chatBusy()) return;
    this.chatMessages.update(m => [...m, { role: 'user', text }]);
    this.chatInput.set('');
    this.chatBusy.set(true);

    const p = this.profile();
    const context = {
      budget:   ((p['budget'] as string[])?.[0] ?? ''),
      fuel:     ((p['fuel']   as string[])?.[0] ?? ''),
      usage:    ((p['usageType'] as string[])?.[0] ?? ''),
    };

    let aiText = '';
    this.chatMessages.update(m => [...m, { role: 'ai', text: '' }]);

    try {
      const resp = await fetch(`${environment.apiUrl}/recommend/ai-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, context }),
      });

      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No stream');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') break;
          try {
            const { token } = JSON.parse(payload);
            aiText += token;
            this.chatMessages.update(m => {
              const copy = [...m];
              copy[copy.length - 1] = { role: 'ai', text: aiText };
              return copy;
            });
          } catch {}
        }
      }
    } catch {
      this.chatMessages.update(m => {
        const copy = [...m];
        copy[copy.length - 1] = { role: 'ai', text: 'Sorry, I could not connect to the AI. Please try again.' };
        return copy;
      });
    } finally {
      this.chatBusy.set(false);
    }
  }

  readonly ALL_STEPS: AdvisorStep[] = [
    {
      key: 'condition', category: 'Purchase', icon: '🏷️', multi: false,
      title: 'Are you looking for a new or used car?',
      subtitle: 'Helps us filter the right listings for you',
      options: [
        { label: 'Brand New',        sub: 'Factory fresh, never owned' },
        { label: 'Certified Used',   sub: 'Pre-owned, inspected & verified' },
        { label: 'Any Condition',    sub: 'Show me all options' },
      ]
    },
    {
      key: 'budget', category: 'Financial', icon: 'calculator', multi: false,
      title: 'What is your total car budget?',
      subtitle: 'We\'ll match cars precisely within your price range',
      options: [
        { label: 'Under ₹5L',    sub: 'Entry segment' },
        { label: '₹5L – ₹10L',  sub: 'Most popular range' },
        { label: '₹10L – ₹15L', sub: 'Mid-segment' },
        { label: '₹15L – ₹20L', sub: 'Premium mid' },
        { label: '₹20L – ₹30L', sub: 'Luxury segment' },
        { label: 'Above ₹30L',  sub: 'Ultra premium' },
      ]
    },
    {
      key: 'dailyKm', category: 'Driving', icon: 'road', multi: false,
      title: 'How much do you drive daily?',
      subtitle: 'Helps calculate fuel costs & EV range requirements',
      options: [
        { label: '< 20 km/day',     sub: 'Light use — local errands' },
        { label: '20 – 50 km/day',  sub: 'Average city commute' },
        { label: '50 – 100 km/day', sub: 'Heavy commute' },
        { label: '100+ km/day',     sub: 'Long distance daily' },
      ]
    },
    {
      key: 'drivingMix', category: 'Driving', icon: '🗺️', multi: false,
      title: 'Where do you drive most often?',
      subtitle: 'City vs highway changes efficiency & comfort needs',
      options: [
        { label: 'Mostly City',    sub: '80%+ stop-go traffic' },
        { label: 'Mostly Highway', sub: '80%+ open roads' },
        { label: 'Mixed 50/50',   sub: 'Both equally' },
        { label: 'Weekend trips only', sub: 'Occasional leisure use' },
      ]
    },
    {
      key: 'familySize', category: 'Family', icon: '👨‍👩‍👧', multi: false,
      title: 'How many people travel regularly?',
      subtitle: 'Determines seating, boot space and body type needs',
      options: [
        { label: 'Just me',       sub: 'Solo driver' },
        { label: '2 – 3 people', sub: 'Couple or small family' },
        { label: '4 – 5 people', sub: 'Medium family' },
        { label: '6+ people',    sub: 'Large family or group travel' },
      ]
    },
    {
      key: 'usageType', category: 'Family', icon: 'car', multi: true,
      title: 'How will you primarily use the car?',
      subtitle: 'Select all that apply',
      options: [
        { label: 'Daily commute',      sub: 'Office / work travel' },
        { label: 'Family outings',     sub: 'Weekend trips & picnics' },
        { label: 'Long road trips',    sub: 'Intercity highway travel' },
        { label: 'Off-road adventure', sub: 'Hills, rough terrain' },
        { label: 'Business use',       sub: 'Client visits, meetings' },
        { label: 'School runs',        sub: 'Kids pickup & drop' },
      ]
    },
    {
      key: 'fuel', category: 'Fuel', icon: '⛽', multi: true,
      title: 'Which fuel type are you open to?',
      subtitle: 'Select all options you are comfortable with',
      options: [
        { label: 'Petrol',         sub: 'Widely available, smooth drive' },
        { label: 'Diesel',         sub: 'Best for long highway runs' },
        { label: 'CNG',            sub: 'Lowest running cost' },
        { label: 'Hybrid',         sub: 'Best efficiency, no range anxiety' },
        { label: 'Electric',       sub: 'Zero emission, future-ready' },
        { label: 'No preference',  sub: 'Show me all options' },
      ]
    },
    {
      key: 'ev', category: 'Electric', icon: 'zap', multi: false, ev: true,
      title: 'EV Suitability Check',
      subtitle: 'Helps us assess your readiness for electric vehicles',
      options: [
        { label: 'Home charger ready', sub: 'Dedicated parking + charger installed' },
        { label: 'Can install charger', sub: 'Own parking, will install charger' },
        { label: 'Public charging only', sub: 'Rely on charging stations' },
        { label: 'Not sure yet',        sub: 'Need guidance on EV readiness' },
      ]
    },
    {
      key: 'lifestyle', category: 'Lifestyle', icon: '✨', multi: true,
      title: 'How would you describe yourself?',
      subtitle: 'Select all that match your buying personality',
      options: [
        { label: 'First-time buyer', sub: 'New to car ownership' },
        { label: 'Comfort-focused',  sub: 'Ride quality is top priority' },
        { label: 'Performance lover',sub: 'Power & handling matters' },
        { label: 'Eco-conscious',    sub: 'Sustainability first' },
        { label: 'Safety first',     sub: 'Family safety is non-negotiable' },
        { label: 'Tech enthusiast',  sub: 'Latest connected features' },
        { label: 'Value seeker',     sub: 'Maximum bang for the buck' },
        { label: 'Luxury oriented',  sub: 'Premium look, feel, experience' },
      ]
    },
    {
      key: 'bodyType', category: 'Vehicle', icon: '🏎️', multi: true,
      title: 'What type of car do you prefer?',
      subtitle: 'Select all body styles you like',
      options: [
        { label: 'Hatchback',   sub: 'Compact, affordable, easy to park' },
        { label: 'Sedan',       sub: 'Classic, spacious boot, prestige' },
        { label: 'Compact SUV', sub: 'Stylish & practical under ₹15L' },
        { label: 'SUV',         sub: 'Space, height, road presence' },
        { label: 'MUV / MPV',  sub: '7-8 seats for large families' },
        { label: 'No preference', sub: 'Open to all' },
      ]
    },
    {
      key: 'features', category: 'Features', icon: '🛠️', multi: true,
      title: 'Which features are must-haves?',
      subtitle: 'Select features you won\'t compromise on',
      options: [
        { label: 'Sunroof',         sub: 'Panoramic or standard sunroof' },
        { label: 'ADAS Safety',     sub: 'Auto braking, lane assist' },
        { label: '360° Camera',     sub: 'Full surround parking view' },
        { label: 'Wireless Charging', sub: 'Convenient phone charging' },
        { label: 'Large Touchscreen', sub: '10"+ infotainment display' },
        { label: 'Ventilated Seats',  sub: 'Cooled seats for summer' },
        { label: 'Connected Car',     sub: 'Remote app, OTA updates' },
        { label: '6+ Airbags',       sub: 'Maximum passive safety' },
      ]
    },
    {
      key: 'priorities', category: 'Priorities', icon: '🎯', multi: true,
      title: 'What matters most to you?',
      subtitle: 'Select your top ownership priorities',
      options: [
        { label: 'Fuel efficiency',   sub: 'Lowest running cost per km' },
        { label: 'Low maintenance',   sub: 'Affordable service schedule' },
        { label: 'Resale value',      sub: 'Strong 5-year resale' },
        { label: 'Safety rating',     sub: 'High NCAP / safety score' },
        { label: 'Brand reliability', sub: 'Trusted, proven manufacturer' },
        { label: 'Feature-rich',      sub: 'Technology & comfort' },
        { label: 'Performance',       sub: 'Power, acceleration, handling' },
        { label: 'Low total cost',    sub: 'Lowest 5-year ownership cost' },
      ]
    },
  ];

  visibleSteps = computed(() => {
    const fuels = (this.profile()['fuel'] as string[] || []);
    return this.ALL_STEPS.filter(s => !s.ev || fuels.includes('Electric'));
  });

  currentStep  = computed((): AdvisorStep | undefined => this.visibleSteps()[this.stepIdx()]);
  totalSteps   = computed(() => this.visibleSteps().length);
  progress     = computed(() => ((this.stepIdx() + 1) / this.totalSteps()) * 100);
  currentSels  = computed(() => {
    const key = this.currentStep()?.key;
    if (!key) return [];
    const v = this.profile()[key];
    return v ? (Array.isArray(v) ? v : [v]) : [];
  });
  canProceed   = computed(() => this.currentSels().length > 0);

  constructor(
    private carsData: CarsDataService,
    private seo: SeoService,
    private analytics: AnalyticsService,
    private api: ApiService,
  ) {
    seo.setPage('AI Car Advisor',
      'Answer 10 smart questions and get personalized, AI-powered car recommendations with full cost analysis.');
    try {
      const saved = sessionStorage.getItem('gaadiiq_advisor_quiz');
      if (saved) {
        const { profile, stepIdx } = JSON.parse(saved);
        if (profile) this.profile.set(profile);
        if (typeof stepIdx === 'number') this.stepIdx.set(stepIdx);
      }
    } catch {}
  }

  private saveQuiz() {
    try {
      sessionStorage.setItem('gaadiiq_advisor_quiz', JSON.stringify({
        profile: this.profile(),
        stepIdx: this.stepIdx(),
      }));
    } catch {}
  }

  toggle(option: string) {
    const step = this.currentStep();
    if (!step) return;
    this.profile.update(p => {
      const cur = (p[step.key] as string[] || []);
      if (!step.multi) return { ...p, [step.key]: [option] };
      if (cur.includes(option)) return { ...p, [step.key]: cur.filter(o => o !== option) };
      return { ...p, [step.key]: [...cur, option] };
    });
    this.saveQuiz();
  }

  isSelected(opt: string) { return this.currentSels().includes(opt); }

  back() {
    if (this.stepIdx() > 0) { this.stepIdx.update(v => v - 1); this.saveQuiz(); }
  }

  next() {
    if (!this.canProceed()) return;
    if (this.stepIdx() < this.totalSteps() - 1) {
      this.stepIdx.update(v => v + 1);
      this.saveQuiz();
    } else {
      this.runAnalysis();
    }
  }

  private readonly _BUDGET_API_MAP: Record<string, string> = {
    'Under ₹5L':    'under_5l',
    '₹5L – ₹10L':  '5l_10l',
    '₹10L – ₹15L': '10l_20l',
    '₹15L – ₹20L': '10l_20l',
    '₹20L – ₹30L': '20l_50l',
    'Above ₹30L':  'above_50l',
  };

  private _mapToRecommendPayload(p: Record<string, string | string[]>) {
    const budget = (p['budget'] as string[])?.[0] || '';
    const fuels = (p['fuel'] as string[] || []);
    const bodyTypes = (p['bodyType'] as string[] || []);
    const usages = (p['usageType'] as string[] || []);

    const fuelRaw = fuels.find(f => f !== 'No preference') || '';
    let fuel = fuelRaw.toLowerCase();
    if (!fuel || fuels.includes('No preference')) fuel = 'any';
    if (fuel === 'electric') fuel = 'electric';
    if (fuel === 'cng') fuel = 'cng';

    const bodyRaw = bodyTypes.find(b => b !== 'No preference') || '';
    let body = bodyRaw.toLowerCase();
    if (!body || bodyTypes.includes('No preference')) body = 'any';
    if (bodyRaw === 'Compact SUV') body = 'suv';
    if (bodyRaw === 'MUV / MPV') body = 'mpv';

    const usageFirst = usages[0] || '';
    let usage = 'city';
    if (usageFirst === 'Long road trips') usage = 'highway';
    else if (usageFirst === 'Family outings' || usageFirst === 'School runs') usage = 'family';

    return {
      budget: this._BUDGET_API_MAP[budget] || undefined,
      fuel: fuel || undefined,
      body: body || undefined,
      usage,
      page_size: 10,
    };
  }

  private runAnalysis() {
    const p = this.profile();
    this.analytics.track('ai_query', {
      budget:    (p['budget']   as string[] | undefined)?.[0],
      fuel:      (p['fuel']     as string[] | undefined)?.[0],
      body_type: (p['bodyType'] as string[] | undefined)?.[0],
      query:     JSON.stringify(p),
    });
    this.phase.set('analyzing');
    this.analyzeMsg.set(ANALYZE_MSGS[0]);
    this.analyzePct.set(0);

    // Fire backend recommend call (non-blocking, used to boost scores)
    const apiPayload = this._mapToRecommendPayload(p);
    firstValueFrom(this.api.getRecommendations(apiPayload)).then(res => {
      if (res?.items?.length) {
        const ids = new Set<string>(res.items.map((item: any) => String(item.listing?.id || '')));
        this.backendBoostIds.set(ids);
      }
    }).catch(() => {
      // Non-fatal — falls back to client-side only
    });

    let i = 0;
    const tick = () => {
      i++;
      this.analyzePct.set(Math.round((i / ANALYZE_MSGS.length) * 100));
      if (i < ANALYZE_MSGS.length) {
        this.analyzeMsg.set(ANALYZE_MSGS[i]);
        setTimeout(tick, 750);
      } else {
        this.computeResults();
        this.phase.set('results');
      }
    };
    setTimeout(tick, 750);
  }

  // ── Scoring engine ────────────────────────────────────────────────────────

  private computeResults() {
    const p = this.profile();
    const condition   = ((p['condition'] as string[])?.[0]) || 'Any Condition';
    const budget      = ((p['budget'] as string[])?.[0]) || '';
    const dailyKmStr  = ((p['dailyKm'] as string[])?.[0]) || '20 – 50 km/day';
    const familySize  = ((p['familySize'] as string[])?.[0]) || '2 – 3 people';
    const fuels       = (p['fuel'] as string[] || []);
    const bodyTypes   = (p['bodyType'] as string[] || []).filter(b => b !== 'No preference');
    const usages      = (p['usageType'] as string[] || []);
    const lifestyle   = (p['lifestyle'] as string[] || []);
    const featureWish = (p['features'] as string[] || []);
    const priorities  = (p['priorities'] as string[] || []);

    const [budMin, budMax] = BUDGET_MAP[budget] || [0, Infinity];
    const dailyKm = DAILY_KM[dailyKmStr] || 35;
    const noFuelPref = fuels.includes('No preference') || fuels.length === 0;

    // Pre-filter by condition
    const currentYear = new Date().getFullYear();
    const allCars = this.carsData.getAll();
    const all = condition === 'Brand New'
              ? allCars.filter(c => c.km === 0 && c.year >= currentYear - 1)
              : condition === 'Certified Used'
              ? allCars.filter(c => c.isSellerListing || c.km > 0 || c.year < currentYear)
              : allCars;

    const scored: RecommendedCar[] = all.map(car => {
      let score = 0;
      const reasons: string[] = [];
      const pros: string[] = [];
      const cons: string[] = [];

      // ── 1. Budget (25 pts) ─────────────────────────────────────────────
      if (car.price >= budMin && car.price <= budMax) {
        score += 25; reasons.push('Within your budget');
        pros.push(`${this.fmtP(car.price)} — fits your budget exactly`);
      } else if (car.price < budMin && car.price >= budMin * 0.75) {
        score += 18; pros.push(`${this.fmtP(car.price)} — below budget, great savings`);
      } else if (car.price > budMax && car.price <= budMax * 1.12) {
        score += 10; cons.push(`${this.fmtP(car.price - budMax)} above your budget`);
      } else if (car.price < budMin * 0.75) {
        score += 12;
      } else {
        score -= 20; cons.push('Significantly over your stated budget');
      }

      // ── 2. Fuel (15 pts) ───────────────────────────────────────────────
      if (noFuelPref) {
        score += 10;
      } else if (fuels.some(f => car.fuel.toLowerCase() === f.toLowerCase())) {
        score += 15; reasons.push(`${car.fuel} — your preferred fuel`);
      } else {
        score -= 30; cons.push(`${car.fuel} — not your preferred fuel type`);
      }

      // ── 3. Daily km vs mileage / range (10 pts) ────────────────────────
      const mileageSpec = car.specs?.find(s => s.label === 'Mileage');
      const rangeSpec   = car.specs?.find(s => s.label === 'Range');

      if (car.fuel === 'Electric' && rangeSpec) {
        const range = parseFloat(rangeSpec.value);
        if (dailyKm < range * 0.55) {
          score += 10; reasons.push(`${rangeSpec.value} range — 2× your daily need`);
          pros.push(`${rangeSpec.value} range comfortably covers ${dailyKm}km daily`);
        } else if (dailyKm < range * 0.85) {
          score += 6;
        } else {
          score -= 5; cons.push('Range may be tight for your daily distance');
        }
      } else if (mileageSpec) {
        const km = parseFloat(mileageSpec.value);
        if (km > 22) {
          score += 10;
          if (priorities.includes('Fuel efficiency')) {
            reasons.push(`${mileageSpec.value} — top fuel efficiency`);
            pros.push(`${mileageSpec.value} mileage — saves ≈₹${Math.round((km - 16) * dailyKm * 30 * 0.3 / km / 10) * 10}/month vs avg`);
          }
        } else if (km > 16) {
          score += 6;
        } else {
          score += 2;
          if (priorities.includes('Fuel efficiency')) cons.push('Below-average fuel efficiency');
        }
      }

      // ── 4. Seating / family fit (15 pts) ──────────────────────────────
      const need = this.needSeating(familySize);
      const has  = this.carSeating(car);
      if (has === need || has === need + 1) {
        // Exact or one extra seat — perfect fit
        score += 15;
        if (need >= 7) { reasons.push(`${has}-seater — perfect for large family`); pros.push(`${has} seats — fits your group of 6+`); }
        else if (need >= 5) { pros.push(`5-seat comfort — perfect for your family`); }
      } else if (has > need + 1) {
        // More seats than needed — slight penalty for small/medium families
        const over = has - need;
        const penalty = need <= 4 ? over * 3 : 0; // penalise only for small families
        score += Math.max(15 - penalty, 6);
        if (need <= 4 && over >= 2) cons.push(`${has}-seater — larger than your family needs`);
      } else if (has === need - 1) {
        score += 8;
      } else {
        score -= 10; cons.push(`Only ${has} seats — may not fit your family`);
      }

      // ── 5. Body type (15 pts) ─────────────────────────────────────────
      if (bodyTypes.length === 0) {
        score += 8;
      } else {
        const match = bodyTypes.some(bt => {
          if (bt === 'MUV / MPV') return car.bodyType === 'MUV';
          if (bt === 'Compact SUV') return car.bodyType === 'SUV' && car.price < 1300000;
          return car.bodyType?.toLowerCase() === bt.toLowerCase();
        });
        if (match) {
          score += 15; reasons.push(`${car.bodyType} — matches your preference`);
        } else {
          score -= 12; cons.push(`${car.bodyType} — not your preferred body type`);
        }
      }

      // ── 6. Features (10 pts) ──────────────────────────────────────────
      let fs = 0;
      if (featureWish.includes('Sunroof') && car.features?.some(f => /sunroof/i.test(f))) { fs += 2; pros.push('Sunroof included'); }
      if (featureWish.includes('ADAS Safety') && car.features?.some(f => /adas/i.test(f))) { fs += 2; reasons.push('ADAS equipped'); }
      if (featureWish.includes('360° Camera') && car.features?.some(f => /360/i.test(f))) { fs += 2; pros.push('360° camera system'); }
      if (featureWish.includes('Wireless Charging') && car.features?.some(f => /wireless/i.test(f))) fs += 1;
      if (featureWish.includes('6+ Airbags') && car.features?.some(f => /6 airbag/i.test(f))) { fs += 2; pros.push('6 airbags — max safety'); }
      if (featureWish.includes('Connected Car') && car.features?.some(f => /connect|ota|smart/i.test(f))) fs += 1;
      if (featureWish.includes('Ventilated Seats') && car.features?.some(f => /ventilated/i.test(f))) { fs += 2; pros.push('Ventilated seats'); }
      if (featureWish.includes('Large Touchscreen') && car.features?.some(f => /10\.|12\.|14\./.test(f))) fs += 1;
      score += Math.min(fs * 1.5, 10);

      // ── 7. Priorities (10 pts) ────────────────────────────────────────
      let ps = 0;
      if (priorities.includes('Fuel efficiency') && mileageSpec && parseFloat(mileageSpec.value) > 20) ps += 2;
      if ((priorities.includes('Safety rating') || priorities.includes('Safety first')) &&
          car.features?.some(f => /6 airbag|adas/i.test(f))) ps += 3;
      if (priorities.includes('Performance')) {
        const pw = car.specs?.find(s => s.label === 'Power');
        if (pw && parseFloat(pw.value) > 130) { ps += 2; pros.push(`${pw.value} — strong performance`); }
      }
      if ((priorities.includes('Brand reliability') || priorities.includes('Low maintenance')) &&
          ['Maruti Suzuki', 'Toyota', 'Hyundai'].includes(car.make)) {
        ps += 2; pros.push(`${car.make} — top reliability brand`);
      }
      if (priorities.includes('Resale value')) {
        const r = RESALE[car.make] || 0.5;
        if (r >= 0.60) { ps += 2; pros.push(`~${Math.round(r * 100)}% resale value after 5 years`); }
      }
      if ((priorities.includes('Low total cost') || priorities.includes('Low maintenance')) &&
          (MAINT[car.make] || 14000) <= 10000) ps += 2;
      score += Math.min(ps, 10);

      // ── 8. Lifestyle / usage bonus (5 pts) ───────────────────────────
      if (usages.includes('Off-road adventure') && car.features?.some(f => /4wd|4x4/i.test(f))) { score += 5; pros.push('4WD — adventure ready'); }
      if (usages.includes('Long road trips') && car.bodyType === 'SUV') score += 3;
      if (lifestyle.includes('Eco-conscious') && ['Electric', 'Hybrid', 'CNG'].includes(car.fuel)) { score += 3; reasons.push('Eco-friendly fuel'); }
      if (lifestyle.includes('Safety first') && car.features?.some(f => /adas/i.test(f))) score += 3;
      if (lifestyle.includes('Luxury oriented') && car.price > 2000000) score += 3;
      if (lifestyle.includes('Value seeker') && (car.features?.length || 0) / car.price > 8e-6) score += 2;

      // ── 9. Rating bonus (5 pts) ───────────────────────────────────────
      score += (car.rating - 4.0) * 5;

      // Normalize to 1–99
      const norm = Math.min(Math.max(Math.round((score / 115) * 99), 30), 99);

      // ── Cost calculations ──────────────────────────────────────────────
      const monthlyFuel = this.calcFuel(dailyKm, parseFloat(mileageSpec?.value || '18'), car.fuel);
      const monthlyEmi  = this.calcEmi(car.price * 0.8, 8.5, 60);
      const baseMaint   = MAINT[car.make] || 12000;
      const annualMaint = car.fuel === 'Electric' ? Math.round(baseMaint * 0.55) : car.fuel === 'Hybrid' ? Math.round(baseMaint * 0.80) : baseMaint;
      const insurance   = car.price * 0.04;
      const resalePct   = RESALE[car.make] || 0.52;
      const resale5yr   = car.price * resalePct;
      const fiveYearTco = car.price + monthlyFuel * 60 + annualMaint * 5 + insurance * 5 - resale5yr;
      const costPerKm   = monthlyFuel / (dailyKm * 30);

      // Fill empty pros/cons
      if (pros.length === 0) pros.push(`${car.rating}★ customer rating`);
      if (cons.length === 0 && car.km > 30000) cons.push(`${car.km.toLocaleString('en-IN')} km on odometer`);
      if (cons.length === 0) {
        const pw = car.specs?.find(s => s.label === 'Power');
        if (pw && parseFloat(pw.value) < 80) cons.push('Modest engine output');
      }

      return {
        ...car,
        matchScore: norm,
        confidence: norm >= 80 ? 'High' : norm >= 65 ? 'Medium' : 'Moderate',
        reasons: reasons.slice(0, 4),
        pros: pros.slice(0, 3),
        cons: cons.slice(0, 2),
        monthlyFuel: Math.round(monthlyFuel),
        monthlyEmi: Math.round(monthlyEmi),
        annualMaintenance: annualMaint,
        fiveYearTco: Math.round(fiveYearTco),
        costPerKm: Math.round(costPerKm * 100) / 100,
        resale5yr: Math.round(resale5yr),
        categoryBadges: [] as string[],
      };
    });

    // Apply backend boost: cars recommended by POST /recommend get +20 pts (MOB-016)
    const boostIds = this.backendBoostIds();
    if (boostIds.size > 0) {
      for (const car of scored) {
        if (boostIds.has(String(car.id))) {
          car.matchScore = Math.min(100, car.matchScore + 20);
        }
      }
    }

    // Sort all by score
    scored.sort((a, b) => b.matchScore - a.matchScore);

    // Hard rules when user has an explicit fuel preference:
    //   1. ONLY fuel-matching cars are shown — no backfill with other fuels ever.
    //   2. Within budget (price <= budMax) cars rank first.
    //   3. Slightly over budget (<=20% above budMax) only allowed if in-budget count < 3.
    //   4. Cars more than 20% over budget are excluded entirely.
    let top: RecommendedCar[];
    if (noFuelPref) {
      const hardMax = budMax === Infinity ? Infinity : budMax * 1.10;
      top = (budMax === Infinity ? scored : scored.filter(c => c.price <= hardMax)).slice(0, 5);
    } else {
      const fuelMatch = scored.filter(c =>
        fuels.some(f => c.fuel.toLowerCase() === f.toLowerCase()));

      const hardBudgetMax = budMax * 1.10; // never show anything more than 10% over budget
      const inBudget    = fuelMatch.filter(c => c.price <= budMax);
      const slightlyOver = fuelMatch.filter(c => c.price > budMax && c.price <= hardBudgetMax);
      const overAllowed  = inBudget.length < 3 ? slightlyOver.slice(0, 3 - inBudget.length) : [];

      top = [...inBudget, ...overAllowed].slice(0, 5);
    }

    // Assign category badges
    if (top.length > 0) top[0].categoryBadges.push('🎯 Best Match');

    const byMileage = [...top].sort((a, b) => {
      const m = (c: RecommendedCar) => parseFloat(c.specs?.find(s => s.label === 'Mileage')?.value || '0');
      return m(b) - m(a);
    });
    if (byMileage[0]) byMileage[0].categoryBadges.push('⛽ Best Mileage');

    const byValue = [...top].sort((a, b) =>
      (b.features?.length || 0) / b.price - (a.features?.length || 0) / a.price);
    if (byValue[0]) byValue[0].categoryBadges.push('Best Value');

    const needS = this.needSeating((p['familySize'] as string[])?.[0] || '2 – 3 people');
    if (needS >= 6) {
      const bySeating = [...top].sort((a, b) => this.carSeating(b) - this.carSeating(a));
      if (bySeating[0] && this.carSeating(bySeating[0]) >= 6) bySeating[0].categoryBadges.push('👨‍👩‍👧 Best Family');
    }

    const evTop = top.find(c => c.fuel === 'Electric');
    if (evTop) evTop.categoryBadges.push('Best EV');

    const lowestTco = [...top].sort((a, b) => a.fiveYearTco - b.fiveYearTco)[0];
    if (lowestTco) lowestTco.categoryBadges.push('🏆 Lowest TCO');

    this.results.set(top.slice(0, 5));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private needSeating(fs: string): number {
    if (fs === 'Just me') return 2;
    if (fs === '2 – 3 people') return 4;
    if (fs === '4 – 5 people') return 5;
    return 7;
  }

  private carSeating(car: Car): number {
    const s = car.specs?.find(x => x.label === 'Seating');
    if (s) return parseInt(s.value) || 5;
    return car.bodyType === 'MUV' ? 7 : 5;
  }

  private calcFuel(dailyKm: number, mileage: number, fuel: string): number {
    const km = dailyKm * 30;
    if (fuel === 'Electric') return (km / 100) * 15 * 8;
    if (fuel === 'CNG')      return (km / mileage) * 85;
    if (fuel === 'Hybrid')   return (km / mileage) * 106 * 0.65;
    if (fuel === 'Diesel')   return (km / mileage) * 92;
    return (km / mileage) * 106;
  }

  private calcEmi(principal: number, rate: number, months: number): number {
    const r = rate / 12 / 100;
    return principal * r * Math.pow(1 + r, months) / (Math.pow(1 + r, months) - 1);
  }

  getImageUrl(car: Car): string {
    // The car's own photograph, or the placeholder. A brochure image used to
    // be preferred over it, which meant a recommendation could be illustrated
    // by a manufacturer's stock shot rather than the vehicle being recommended.
    return car.image || 'assets/cars/placeholder.svg';
  }

  fmtP(n: number): string {
    if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
    if (n >= 100000)   return `₹${(n / 100000).toFixed(1)}L`;
    return `₹${n.toLocaleString('en-IN')}`;
  }

  fmtK(n: number): string {
    if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
    if (n >= 1000)   return `₹${(n / 1000).toFixed(0)}K`;
    return `₹${Math.round(n)}`;
  }

  restart() {
    this.phase.set('quiz');
    this.stepIdx.set(0);
    this.profile.set({});
    this.results.set([]);
    this.showComparison.set(false);
    try { sessionStorage.removeItem('gaadiiq_advisor_quiz'); } catch {}
  }
}
