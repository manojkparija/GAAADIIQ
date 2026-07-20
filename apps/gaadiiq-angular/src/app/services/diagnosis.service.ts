import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface PossibleCause {
  cause: string;
  confidence: number;
  explanation: string;
}

export interface DiagnosisReport {
  id: string;
  preliminary_diagnosis: string;
  possible_causes: PossibleCause[];
  repair_complexity: string;
  cost_min_inr: number;
  cost_max_inr: number;
  repair_time_estimate: string;
  safe_to_drive: boolean;
  risk_level: string;
  recommended_steps: string[];
  diy_fixes: string[];
  immediate_service_required: boolean;
  preventive_maintenance: string[];
  retrieved_sources: string[];
  ollama_used: boolean;
  analysis_confidence: number;
  disclaimer: string;
  created_at: string;
}

export interface DiagnoseRequest {
  manufacturer: string;
  model: string;
  variant?: string;
  model_year: number;
  fuel_type: string;
  transmission: string;
  odometer_km?: number;
  problem_description: string;
  warning_lights: string[];
  when_occurs: string[];
  severity: string;
  image_urls?: string[];
  user_id?: string;
}

const DISCLAIMER =
  '⚠️ IMPORTANT DISCLAIMER: This is a preliminary AI-assisted assessment only. ' +
  'It is NOT a professional diagnosis. Results may be inaccurate or incomplete. ' +
  'A certified automotive mechanic must physically inspect the vehicle to confirm any diagnosis. ' +
  'For safety-critical issues (brakes, steering, engine warning lights), do NOT drive the vehicle ' +
  'until it has been professionally inspected. Never attempt repairs beyond your skill level.';

interface KBCase {
  title: string;
  symptoms: string[];
  possible_causes: string[];
  complexity: string;
  cost_min: number;
  cost_max: number;
  repair_time: string;
  safe_to_drive: boolean;
  risk: string;
  diy: string[];
  source: string;
}

const KB: KBCase[] = [
  {
    title: 'Engine Overheating',
    symptoms: ['overheat', 'overheating', 'temperature', 'coolant', 'radiator', 'steam', 'boiling', 'thermostat', 'waterpump'],
    possible_causes: ['Low coolant / coolant leak', 'Faulty thermostat', 'Failed water pump', 'Clogged radiator', 'Broken radiator fan'],
    complexity: 'Moderate', cost_min: 2000, cost_max: 18000,
    repair_time: '2-6 hours', safe_to_drive: false, risk: 'Critical',
    diy: ['Check coolant level when engine is cold', 'Inspect radiator cap', 'Look for leaks under the vehicle'],
    source: 'RK001 - Engine Overheating',
  },
  {
    title: 'Brake System Issue',
    symptoms: ['brake', 'grinding', 'squealing', 'squeaking', 'pull', 'pedal', 'stopping', 'abs'],
    possible_causes: ['Worn brake pads', 'Warped brake disc', 'Low brake fluid', 'Brake caliper sticking'],
    complexity: 'Moderate', cost_min: 1500, cost_max: 12000,
    repair_time: '1-4 hours', safe_to_drive: false, risk: 'High',
    diy: ['Check brake fluid level', 'Visually inspect pad thickness through wheel spokes'],
    source: 'RK002 - Brake System',
  },
  {
    title: 'Battery / Electrical Problem',
    symptoms: ['battery', 'start', 'crank', 'electrical', 'charging', 'alternator', 'click', 'dead'],
    possible_causes: ['Weak or dead battery', 'Faulty alternator', 'Bad starter motor', 'Corroded terminals'],
    complexity: 'Simple', cost_min: 800, cost_max: 8000,
    repair_time: '30 min – 2 hours', safe_to_drive: true, risk: 'Low',
    diy: ['Check battery terminals for corrosion', 'Measure battery voltage (12.6V = fully charged)'],
    source: 'RK005 - Battery / Electrical',
  },
  {
    title: 'Transmission / Gearbox Issue',
    symptoms: ['gear', 'transmission', 'slip', 'jerk', 'shudder', 'shift', 'clutch', 'vibrat'],
    possible_causes: ['Low transmission fluid', 'Worn clutch plate', 'Faulty solenoid', 'Damaged synchros'],
    complexity: 'Complex', cost_min: 5000, cost_max: 60000,
    repair_time: '4-12 hours', safe_to_drive: false, risk: 'High',
    diy: ['Check clutch fluid level', 'Note exact driving conditions when issue occurs'],
    source: 'RK006 - Transmission',
  },
  {
    title: 'AC / Air Conditioning Problem',
    symptoms: ['aircon', 'conditioning', 'compressor', 'refrigerant', 'blower', 'cooling', 'musty', 'humid', 'vent'],
    possible_causes: ['Low refrigerant', 'Faulty compressor', 'Blocked condenser', 'Clogged cabin filter'],
    complexity: 'Moderate', cost_min: 1500, cost_max: 15000,
    repair_time: '1-4 hours', safe_to_drive: true, risk: 'Low',
    diy: ['Check cabin air filter', 'Clean condenser fins of debris'],
    source: 'RK007 - AC System',
  },
  {
    title: 'Suspension / Steering Issue',
    symptoms: ['suspension', 'steering', 'noise', 'bump', 'pothole', 'bounce', 'wobble', 'pull', 'vibrat', 'shock'],
    possible_causes: ['Worn shock absorbers', 'Damaged ball joints', 'Worn tie rods', 'Wheel alignment issue'],
    complexity: 'Moderate', cost_min: 2000, cost_max: 20000,
    repair_time: '2-6 hours', safe_to_drive: false, risk: 'High',
    diy: ['Check tyre pressure', 'Push down on each corner — excess bounce = worn shocks'],
    source: 'RK008 - Suspension',
  },
  {
    title: 'Engine Oil Pressure / Oil System',
    symptoms: ['oil', 'pressure', 'warning', 'light', 'leak', 'smoke', 'burning', 'level'],
    possible_causes: ['Low oil level', 'Faulty oil pressure sensor', 'Oil pump failure', 'Clogged oil filter'],
    complexity: 'Moderate', cost_min: 500, cost_max: 25000,
    repair_time: '1-6 hours', safe_to_drive: false, risk: 'Critical',
    diy: ['Check oil level on dipstick', 'Check for oil leaks under engine'],
    source: 'RK003 - Oil Pressure',
  },
  {
    title: 'Check Engine Light / O2 Sensor',
    symptoms: ['check', 'engine', 'cel', 'mil', 'oxygen', 'o2', 'sensor', 'emission', 'fuel', 'misfire'],
    possible_causes: ['Faulty O2 / Lambda sensor', 'Loose fuel cap', 'Spark plug issue', 'EGR valve fault'],
    complexity: 'Moderate', cost_min: 1000, cost_max: 12000,
    repair_time: '1-4 hours', safe_to_drive: true, risk: 'Medium',
    diy: ['Tighten fuel cap', 'Read OBD fault codes with a scanner'],
    source: 'RK004 - CEL / O2 Sensor',
  },
];

function clientFallback(req: DiagnoseRequest): DiagnosisReport {
  const text = (
    req.problem_description + ' ' +
    req.warning_lights.join(' ') + ' ' +
    req.when_occurs.join(' ')
  ).toLowerCase();

  // Exact word matching only — no substring match to avoid false positives
  const words = new Set(text.split(/\W+/).filter(w => w.length > 1));

  // Boost AC category when "AC On" is selected as when_occurs
  const acBoost = req.when_occurs.some(w => w.toLowerCase().includes('ac'));

  let best: KBCase | null = null;
  let bestScore = 0;
  for (const c of KB) {
    let score = c.symptoms.filter(s => words.has(s)).length;
    if (acBoost && c.title.includes('AC')) score += 2;
    if (score > bestScore) { bestScore = score; best = c; }
  }

  if (!best) {
    return {
      id: crypto.randomUUID(),
      preliminary_diagnosis:
        'Unable to identify a specific issue from the symptoms provided. ' +
        'Please consult a certified mechanic for a proper diagnostic scan.',
      possible_causes: [{ cause: 'Unknown — requires professional OBD scan', confidence: 50, explanation: 'Insufficient symptom data for automated diagnosis' }],
      repair_complexity: 'Unknown', cost_min_inr: 500, cost_max_inr: 50000,
      repair_time_estimate: 'To be determined', safe_to_drive: false, risk_level: 'Medium',
      recommended_steps: ['Visit a certified service center', 'Request an OBD-II diagnostic scan', 'Do not ignore warning lights'],
      diy_fixes: ['Check all fluid levels', 'Inspect for visible leaks'],
      immediate_service_required: req.severity === 'high' || req.severity === 'critical',
      preventive_maintenance: ['Follow manufacturer service schedule', 'Check tyre pressure monthly'],
      retrieved_sources: [], ollama_used: false, analysis_confidence: 20,
      disclaimer: DISCLAIMER, created_at: new Date().toISOString(),
    };
  }

  const causes: PossibleCause[] = best.possible_causes.slice(0, 3).map((c, i) => ({
    cause: c,
    confidence: Math.max(30, 75 - i * 15),
    explanation: 'Based on reported symptoms matching known repair patterns',
  }));

  return {
    id: crypto.randomUUID(),
    preliminary_diagnosis:
      `Based on the reported symptoms, the most likely issue is related to: ${best.title}. ` +
      'A professional inspection is recommended to confirm.',
    possible_causes: causes,
    repair_complexity: best.complexity,
    cost_min_inr: best.cost_min,
    cost_max_inr: best.cost_max,
    repair_time_estimate: best.repair_time,
    safe_to_drive: best.safe_to_drive,
    risk_level: best.risk,
    recommended_steps: [
      'Have the vehicle inspected by a certified mechanic',
      'Request an OBD-II diagnostic scan',
      'Do not defer safety-critical repairs',
    ],
    diy_fixes: best.diy,
    immediate_service_required: !best.safe_to_drive,
    preventive_maintenance: ['Follow manufacturer service schedule', 'Use manufacturer-recommended fluids and parts'],
    retrieved_sources: [best.source],
    ollama_used: false,
    analysis_confidence: 45,
    disclaimer: DISCLAIMER,
    created_at: new Date().toISOString(),
  };
}

@Injectable({ providedIn: 'root' })
export class DiagnosisService {
  private readonly api = `${environment.apiUrl}/diagnosis`;

  loading = signal(false);
  error = signal<string | null>(null);
  report = signal<DiagnosisReport | null>(null);

  constructor(private http: HttpClient) {}

  async analyse(request: DiagnoseRequest): Promise<DiagnosisReport | null> {
    this.loading.set(true);
    this.error.set(null);
    this.report.set(null);

    // Show client-side result immediately (no API latency / no backend required)
    const immediate = clientFallback(request);
    this.report.set(immediate);
    this.loading.set(false);

    // Fire-and-forget: upgrade to real AI result if the backend is available
    this.http
      .post<DiagnosisReport>(`${this.api}/analyse`, request)
      .toPromise()
      .then(result => { if (result) this.report.set(result); })
      .catch(() => { /* keep the already-displayed client result */ });

    return immediate;
  }

  riskColor(level: string): string {
    return ({ Low: '#10B981', Medium: '#F59E0B', High: '#EF4444', Critical: '#7C3AED' } as any)[level] ?? '#6B7280';
  }

  riskBg(level: string): string {
    return ({ Low: 'rgba(16,185,129,0.12)', Medium: 'rgba(245,158,11,0.12)', High: 'rgba(239,68,68,0.12)', Critical: 'rgba(124,58,237,0.12)' } as any)[level] ?? 'rgba(107,114,128,0.12)';
  }

  complexityColor(c: string): string {
    return ({ Simple: '#10B981', Moderate: '#3B82F6', Complex: '#F59E0B', Major: '#EF4444' } as any)[c] ?? '#6B7280';
  }

  confidenceLabel(score: number): string {
    if (score >= 80) return 'High Confidence';
    if (score >= 60) return 'Moderate Confidence';
    if (score >= 40) return 'Low Confidence';
    return 'Uncertain';
  }
}
