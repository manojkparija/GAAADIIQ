import { Injectable, signal, inject } from '@angular/core';
import { DiagnosisService, DiagnoseRequest, DiagnosisReport } from './diagnosis.service';
import { CarsDataService, Car } from './cars-data.service';

// ── Types ───────────────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant';
export type IntentType = 'car_advisor' | 'vehicle_diagnosis' | 'car_info' | 'general';

export interface CarCard {
  type: 'car_card';
  car: Car;
  score?: number;
  reasons?: string[];
}

export interface DiagnosisCard {
  type: 'diagnosis_card';
  report: DiagnosisReport;
}

export interface SuggestedPrompts {
  type: 'suggested_prompts';
  prompts: string[];
}

export type RichContent = CarCard | DiagnosisCard | SuggestedPrompts;

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  rich?: RichContent[];
  timestamp: Date;
  typing?: boolean;
}

export interface ConversationContext {
  intent?: IntentType;
  diagnosisState?: Partial<DiagnoseRequest>;
  advisorProfile?: Record<string, string | string[]>;
  lastCarMentioned?: string;
}

// ── Intent Detection ─────────────────────────────────────────────────────────

const DIAGNOSIS_KEYWORDS = [
  'noise', 'sound', 'vibration', 'leak', 'smoke', 'smell', 'warning', 'light',
  'brake', 'engine', 'overheat', 'battery', 'won\'t start', 'not starting',
  'stalling', 'jerking', 'shudder', 'grinding', 'squealing', 'clunking',
  'diagnose', 'problem', 'issue', 'fault', 'error', 'check engine',
  'repair', 'fix', 'mechanic', 'service', 'transmission', 'gear', 'clutch',
  'suspension', 'steering', 'wobble', 'pull', 'oil', 'coolant', 'radiator',
  'ac not', 'air conditioning', 'overheating', 'temperature',
];

const ADVISOR_KEYWORDS = [
  'suggest', 'recommend', 'which car', 'best car', 'should i buy', 'looking for',
  'budget', 'family car', 'suv', 'sedan', 'hatchback', 'mpv', 'compare',
  'fuel efficient', 'petrol', 'diesel', 'electric', 'cng', 'hybrid',
  'buy a car', 'purchase', 'new car', 'used car', 'affordable', 'top car',
  'best vehicle', 'car for', 'suitable car', 'advise', 'options for',
];

const CAR_INFO_KEYWORDS = [
  // spec query terms
  'hp', 'bhp', 'nm', 'torque', 'horsepower', 'power output', 'top speed',
  '0-100', 'acceleration', 'cc', 'displacement', 'engine capacity', 'rpm',
  'fuel economy', 'mileage', 'range', 'kmpl', 'km/l',
  // generic info patterns
  'price of', 'cost of', 'specs', 'features', 'seating',
  'tell me about', 'info about', 'details of', 'specification', 'review',
  'what is the', 'tell me the', 'how much power', 'how fast',
  // Maruti
  'swift', 'dzire', 'baleno', 'wagon r', 'alto', 'vitara', 'ertiga', 'brezza', 'xl6', 's-presso',
  // Hyundai
  'creta', 'venue', 'i20', 'grand i10', 'alcazar', 'tucson', 'ioniq', 'aura', 'xcent',
  // Tata
  'nexon', 'punch', 'harrier', 'safari', 'altroz', 'tiago', 'tigor', 'curvv',
  // Honda
  'city', 'amaze', 'jazz', 'wrv', 'elevate', 'accord', 'civic',
  // Kia
  'seltos', 'sonet', 'carens', 'ev6', 'carnival',
  // MG
  'hector', 'astor', 'gloster', 'zs ev', 'comet',
  // Toyota
  'fortuner', 'innova', 'urban cruiser', 'camry', 'vellfire', 'hilux',
  // Mahindra
  'scorpio', 'thar', 'xuv', 'be6', 'bolero', 'marazzo',
  // Nissan
  'nissan', 'magnite', 'kicks', 'x-trail', 'tekton', 'gt-r', 'leaf',
  // Renault
  'renault', 'duster', 'kiger', 'triber',
  // Volkswagen / Skoda
  'volkswagen', 'vw', 'skoda', 'virtus', 'slavia', 'kushaq', 'taigun', 'polo', 'vento',
  // Jeep
  'jeep', 'compass', 'meridian', 'wrangler',
  // Kia / others
  'ford', 'figo', 'aspire', 'ecosport',
];

const CAR_BRANDS = [
  'maruti', 'suzuki', 'hyundai', 'tata', 'honda', 'kia', 'mg', 'mahindra',
  'toyota', 'nissan', 'renault', 'volkswagen', 'skoda', 'jeep', 'ford',
  'bmw', 'mercedes', 'audi', 'volvo', 'jaguar', 'land rover', 'porsche', 'lexus',
];

function detectIntent(text: string): IntentType {
  const lower = text.toLowerCase();
  const diagScore = DIAGNOSIS_KEYWORDS.filter(k => lower.includes(k)).length;
  const advScore  = ADVISOR_KEYWORDS.filter(k => lower.includes(k)).length;
  const infoScore = CAR_INFO_KEYWORDS.filter(k => lower.includes(k)).length;
  const brandHit  = CAR_BRANDS.some(b => lower.includes(b));

  if (diagScore > advScore && diagScore > 0) return 'vehicle_diagnosis';
  if (advScore > 0) return 'car_advisor';
  if (infoScore > 0 || brandHit) return 'car_info';
  return 'general';
}

// ── Diagnosis flow helpers ───────────────────────────────────────────────────

const DIAGNOSIS_FLOW: { field: keyof DiagnoseRequest; question: string }[] = [
  { field: 'manufacturer', question: 'What is the **make** of your car? (e.g. Maruti Suzuki, Hyundai, Tata)' },
  { field: 'model',        question: 'What is the **model**? (e.g. Swift, Creta, Nexon)' },
  { field: 'model_year',   question: 'What is the **year** of manufacture?' },
  { field: 'fuel_type',    question: 'What **fuel type** does it use? (Petrol / Diesel / CNG / Electric / Hybrid)' },
  { field: 'problem_description', question: 'Please **describe the problem** in detail — what exactly are you experiencing?' },
  { field: 'severity',     question: 'How **severe** is the issue? (low / medium / high / critical)' },
];

function nextDiagnosisQuestion(state: Partial<DiagnoseRequest>): string | null {
  for (const step of DIAGNOSIS_FLOW) {
    if (!state[step.field]) return step.question;
  }
  return null;
}

function fillDiagnosisField(state: Partial<DiagnoseRequest>, userText: string): Partial<DiagnoseRequest> {
  const next = { ...state };
  for (const step of DIAGNOSIS_FLOW) {
    if (!next[step.field]) {
      // model_year needs a number
      if (step.field === 'model_year') {
        const yr = parseInt(userText.match(/\d{4}/)?.[0] || userText);
        (next as any)[step.field] = isNaN(yr) ? userText : yr;
      } else {
        (next as any)[step.field] = userText.trim();
      }
      break;
    }
  }
  return next;
}

// ── Response generators ──────────────────────────────────────────────────────

function greetingResponse(): { text: string; rich: RichContent[] } {
  return {
    text: 'Hi there! 👋 I\'m **ARIA** — GAADIIQ\'s Auto Recommendation & Intelligent Assistant. I can help you with:\n\n🚗 **Car Recommendations** — Find the perfect car for your needs and budget\n🔧 **Vehicle Diagnosis** — Troubleshoot car problems step by step\n📋 **Car Information** — Specs, prices, features and comparisons\n\nWhat can I help you with today?',
    rich: [{
      type: 'suggested_prompts',
      prompts: [
        'Help me find a family car under ₹15L',
        'My car is making a grinding noise',
        'Compare Swift vs Baleno',
        'Best petrol car under ₹10L',
      ],
    }],
  };
}

function generalResponse(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey') || lower.includes('namaste')) {
    return 'Hello! 😊 I\'m ARIA, your AI car assistant from GAADIIQ. How can I help you today? I can recommend cars, diagnose vehicle issues, or answer any car-related questions!';
  }
  if (lower.includes('thank')) {
    return 'You\'re welcome! 😊 Feel free to ask if you have more questions about cars or vehicle issues.';
  }
  if (lower.includes('help') || lower === 'help') {
    return 'I can help you with:\n\n• 🚗 **Car Recommendations** — Tell me your budget, usage, and preferences\n• 🔧 **Vehicle Diagnosis** — Describe your car\'s problem and I\'ll analyse it\n• 📋 **Car Info** — Ask about any car\'s specs, features, or price\n\nWhat would you like to explore?';
  }
  return 'I\'m best at helping with car recommendations, vehicle diagnosis, and car information. Could you tell me more about what you need? For example:\n\n• "Suggest a car under ₹12L for family use"\n• "My Maruti Swift is making a strange noise when I brake"\n• "What are the features of the Hyundai Creta?"';
}

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class ChatService {
  private diagnosis = inject(DiagnosisService);
  private carsData  = inject(CarsDataService);

  messages  = signal<ChatMessage[]>([]);
  isOpen    = signal(false);
  isTyping  = signal(false);
  context   = signal<ConversationContext>({});
  unreadCount = signal(0);

  private msgId() { return crypto.randomUUID(); }

  open()  {
    this.isOpen.set(true);
    this.unreadCount.set(0);
    if (this.messages().length === 0) {
      const g = greetingResponse();
      this.pushAssistant(g.text, g.rich);
    }
  }
  close() { this.isOpen.set(false); }
  toggle() { this.isOpen() ? this.close() : this.open(); }

  private pushAssistant(text: string, rich?: RichContent[]) {
    const msg: ChatMessage = { id: this.msgId(), role: 'assistant', text, rich, timestamp: new Date() };
    this.messages.update(m => [...m, msg]);
    if (!this.isOpen()) this.unreadCount.update(n => n + 1);
  }

  private pushUser(text: string) {
    this.messages.update(m => [...m, { id: this.msgId(), role: 'user', text, timestamp: new Date() }]);
  }

  private showTyping() { this.isTyping.set(true); }
  private hideTyping() { this.isTyping.set(false); }

  async send(rawText: string): Promise<void> {
    const text = rawText.trim().slice(0, 500); // sanitise length
    if (!text) return;

    // Sanitise: strip HTML tags and script injection attempts
    const safe = text.replace(/<[^>]*>/g, '').replace(/javascript:/gi, '');
    this.pushUser(safe);

    this.showTyping();
    await this.delay(600 + Math.random() * 600);

    const ctx = this.context();
    const intent = detectIntent(safe);

    // ── Active diagnosis flow ────────────────────────────────────────────────
    if (ctx.intent === 'vehicle_diagnosis' && ctx.diagnosisState) {
      await this.continueDiagnosisFlow(safe, ctx.diagnosisState);
      return;
    }

    // ── Route by intent ──────────────────────────────────────────────────────
    switch (intent) {
      case 'vehicle_diagnosis':
        await this.startDiagnosisFlow(safe);
        break;
      case 'car_advisor':
        await this.handleAdvisorQuery(safe);
        break;
      case 'car_info':
        await this.handleCarInfo(safe);
        break;
      default:
        this.hideTyping();
        this.pushAssistant(generalResponse(safe), [{
          type: 'suggested_prompts',
          prompts: ['Find me a car under ₹15L', 'Diagnose my car problem', 'Tell me about Hyundai Creta'],
        }]);
    }
  }

  // ── Diagnosis flow ───────────────────────────────────────────────────────

  private async startDiagnosisFlow(text: string): Promise<void> {
    const state: Partial<DiagnoseRequest> = { warning_lights: [], when_occurs: [] };

    // Pre-fill from the initial message
    const filled = fillDiagnosisField(state, text);
    // If it just sounds like a problem description, treat as the problem
    filled.problem_description = text;

    this.context.update(c => ({ ...c, intent: 'vehicle_diagnosis', diagnosisState: filled }));

    const next = nextDiagnosisQuestion(filled);
    this.hideTyping();

    if (next) {
      this.pushAssistant(`I'll help you diagnose that! Let me gather a few details. 🔧\n\n${next}`);
    } else {
      await this.runDiagnosis(filled as DiagnoseRequest);
    }
  }

  private async continueDiagnosisFlow(text: string, state: Partial<DiagnoseRequest>): Promise<void> {
    const updated = fillDiagnosisField(state, text);
    this.context.update(c => ({ ...c, diagnosisState: updated }));

    const next = nextDiagnosisQuestion(updated);
    this.hideTyping();

    if (next) {
      this.pushAssistant(next);
    } else {
      await this.runDiagnosis(updated as DiagnoseRequest);
    }
  }

  private async runDiagnosis(req: DiagnoseRequest): Promise<void> {
    const safe: DiagnoseRequest = {
      ...req,
      warning_lights: req.warning_lights ?? [],
      when_occurs: req.when_occurs ?? [],
      transmission: req.transmission || 'Manual',
      severity: req.severity || 'medium',
    };

    this.showTyping();
    this.pushAssistant('Analysing your vehicle... 🔍');

    const report = await this.diagnosis.analyse(safe);
    this.hideTyping();

    // Reset diagnosis context
    this.context.update(c => ({ ...c, intent: undefined, diagnosisState: undefined }));

    if (!report) {
      this.pushAssistant('Sorry, I could not analyse the issue. Please try again or visit a certified mechanic.');
      return;
    }

    const summaryText =
      `**Diagnosis Complete** for your ${safe.manufacturer} ${safe.model} 🚗\n\n` +
      `**Assessment:** ${report.preliminary_diagnosis}\n\n` +
      `**Risk Level:** ${report.risk_level}  |  **Safe to Drive:** ${report.safe_to_drive ? '✅ Yes' : '❌ No'}\n` +
      `**Estimated Repair Cost:** ₹${report.cost_min_inr.toLocaleString('en-IN')} – ₹${report.cost_max_inr.toLocaleString('en-IN')}`;

    this.pushAssistant(summaryText, [
      { type: 'diagnosis_card', report },
      { type: 'suggested_prompts', prompts: ['Diagnose another issue', 'Find me a reliable car', 'How do I fix this myself?'] },
    ]);
  }

  // ── Advisor flow ─────────────────────────────────────────────────────────

  private async handleAdvisorQuery(text: string): Promise<void> {
    const lower = text.toLowerCase();

    // Extract budget hint
    let budMin = 0, budMax = Infinity;
    const budgetMatch = lower.match(/under\s*₹?\s*(\d+)\s*l/);
    if (budgetMatch) budMax = parseFloat(budgetMatch[1]) * 100000;
    const budgetRange = lower.match(/₹?\s*(\d+)\s*l?\s*[-–to]+\s*₹?\s*(\d+)\s*l/);
    if (budgetRange) {
      budMin = parseFloat(budgetRange[1]) * 100000;
      budMax = parseFloat(budgetRange[2]) * 100000;
    }

    // Extract fuel hint
    const fuels = ['electric', 'diesel', 'petrol', 'cng', 'hybrid'];
    const fuelPref = fuels.find(f => lower.includes(f)) || '';

    // Extract body type hint
    let bodyType = '';
    if (lower.includes('suv')) bodyType = 'SUV';
    else if (lower.includes('sedan')) bodyType = 'Sedan';
    else if (lower.includes('hatchback')) bodyType = 'Hatchback';
    else if (lower.includes('mpv') || lower.includes('muv')) bodyType = 'MUV';

    // Score and filter
    const all = this.carsData.getAll();
    const scored = all.map(car => {
      let score = 0;
      if (budMax < Infinity && car.price <= budMax && car.price >= budMin) score += 30;
      else if (budMax < Infinity && car.price <= budMax * 1.1) score += 15;
      else if (budMax < Infinity) score -= 20;
      if (fuelPref && car.fuel.toLowerCase() === fuelPref) score += 20;
      if (bodyType && car.bodyType?.toLowerCase() === bodyType.toLowerCase()) score += 15;

      // Family car
      if (lower.includes('family') && (car.bodyType === 'SUV' || car.bodyType === 'MUV')) score += 10;
      if (lower.includes('commute') || lower.includes('city')) {
        if (car.bodyType === 'Hatchback' || car.bodyType === 'Sedan') score += 8;
      }
      score += (car.rating - 3.5) * 5;
      return { car, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.filter(s => s.score > 0).slice(0, 3);

    this.hideTyping();

    if (top.length === 0) {
      this.pushAssistant(
        'I couldn\'t find cars matching those exact criteria. Try the **AI Car Advisor** for a detailed recommendation with full cost analysis! 🎯',
        [{ type: 'suggested_prompts', prompts: ['Open AI Car Advisor', 'Try different budget', 'Show all cars'] }],
      );
      return;
    }

    const budStr = budMax < Infinity ? ` under ₹${(budMax / 100000).toFixed(0)}L` : '';
    const fuelStr = fuelPref ? ` ${fuelPref}` : '';
    const bodyStr = bodyType ? ` ${bodyType}` : '';

    const introText = `Here are my top${budStr}${fuelStr}${bodyStr} recommendations: 🚗`;

    this.pushAssistant(introText, [
      ...top.map(({ car, score }): CarCard => ({
        type: 'car_card',
        car,
        score: Math.min(95, Math.max(60, Math.round((score / 65) * 90))),
        reasons: this.buildReasons(car, fuelPref, bodyType, lower),
      })),
      {
        type: 'suggested_prompts',
        prompts: ['Compare these cars', 'Find cars under ₹8L', 'Show more options', 'Open AI Advisor for detailed analysis'],
      },
    ]);
  }

  private buildReasons(car: Car, fuel: string, body: string, query: string): string[] {
    const r: string[] = [];
    if (fuel && car.fuel.toLowerCase() === fuel) r.push(`${car.fuel} fuel`);
    if (body && car.bodyType?.toLowerCase() === body.toLowerCase()) r.push(`${car.bodyType} body`);
    if (query.includes('family') && (car.bodyType === 'SUV' || car.bodyType === 'MUV')) r.push('Family-friendly');
    const mileage = car.specs?.find(s => s.label === 'Mileage');
    if (mileage) r.push(`${mileage.value} mileage`);
    r.push(`${car.rating}★ rated`);
    return r.slice(0, 3);
  }

  // ── Car info flow ─────────────────────────────────────────────────────────

  private async handleCarInfo(text: string): Promise<void> {
    const lower = text.toLowerCase();
    const all = this.carsData.getAll();

    // Try to find matching car(s)
    const matches = all.filter(c => {
      const key = `${c.make} ${c.model}`.toLowerCase();
      return lower.includes(c.model.toLowerCase()) || lower.includes(key);
    });

    this.hideTyping();

    if (matches.length === 0) {
      // Try to extract the car name for a more helpful response
      const words = lower.split(/\s+/);
      const brandWord = words.find(w => CAR_BRANDS.includes(w));
      const carMention = brandWord
        ? text.substring(lower.indexOf(brandWord))
        : null;

      const isSpecQuery = /\b(hp|bhp|nm|torque|power|cc|top speed|0[-–]100|acceleration|mileage|kmpl)\b/.test(lower);

      if (isSpecQuery && carMention) {
        this.pushAssistant(
          `I don't have **${carMention.trim()}** in my local database yet, so I can't give you its exact specs.\n\n` +
          `For accurate HP and torque figures, I'd recommend checking:\n` +
          `• The manufacturer's official website\n` +
          `• CarWale / CarDekho spec pages\n\n` +
          `I can help you compare similar cars I do know about — would you like that?`,
          [{ type: 'suggested_prompts', prompts: ['Show me similar cars', 'Compare SUVs', 'Recommend a car like this'] }],
        );
      } else {
        this.pushAssistant(
          'I couldn\'t find that specific car in my database. Could you tell me the make and model? For example: "Tell me about the Hyundai Creta" or "Maruti Swift specs".',
          [{ type: 'suggested_prompts', prompts: ['Tell me about Maruti Swift', 'Hyundai Creta specs', 'Tata Nexon price'] }],
        );
      }
      return;
    }

    const car = matches[0];
    const mileage = car.specs?.find(s => s.label === 'Mileage' || s.label === 'Range')?.value || 'N/A';
    const power   = car.specs?.find(s => s.label === 'Power')?.value || 'N/A';
    const seating = car.specs?.find(s => s.label === 'Seating')?.value || '5';

    const infoText =
      `**${car.make} ${car.model}** ${car.variant ? `(${car.variant})` : ''}\n\n` +
      `💰 **Price:** ₹${(car.price / 100000).toFixed(1)}L\n` +
      `⛽ **Fuel:** ${car.fuel}  |  🔧 **Transmission:** ${car.transmission}\n` +
      `⚡ **Power:** ${power}  |  👥 **Seating:** ${seating}\n` +
      `🛞 **Mileage/Range:** ${mileage}\n` +
      `⭐ **Rating:** ${car.rating}/5 (${car.reviews} reviews)`;

    this.pushAssistant(infoText, [
      { type: 'car_card', car },
      { type: 'suggested_prompts', prompts: [`Compare ${car.model} with alternatives`, `Is ${car.model} good for family?`, 'Find similar cars'] },
    ]);
  }

  private delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

  clearHistory() {
    this.messages.set([]);
    this.context.set({});
    this.unreadCount.set(0);
  }
}
