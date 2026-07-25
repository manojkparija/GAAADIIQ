import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface PossibleCause {
  cause: string;
  confidence: number;
  explanation: string;
}

export interface FixSolution {
  title: string;
  difficulty: 'DIY' | 'Mechanic' | 'Specialist';
  steps: string[];
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
  fix_solutions: FixSolution[];
  immediate_service_required: boolean;
  preventive_maintenance: string[];
  retrieved_sources: string[];
  ollama_used: boolean;
  analysis_confidence: number;
  disclaimer: string;
  created_at: string;
  /** BR-AI-10 — present only when confidence is below the threshold. */
  follow_up_questions?: string[];
  needs_more_info?: boolean;
  /** BR-ML-04 — a non-English response was asked for but could not be produced. */
  translation_failed?: boolean;
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
  maintenance_history?: {item: string; date?: string; odometer_km?: number}[];
  audio_url?: string;
  video_url?: string;
  user_id?: string;
  detected_language?: string;
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
  fix_solutions: FixSolution[];
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
    fix_solutions: [
      { title: 'Top up coolant (temporary bypass)', difficulty: 'DIY', steps: ['Let engine cool completely (30+ min)', 'Open bonnet & locate coolant reservoir', 'Fill to MAX line with 50/50 coolant-water mix', 'Start engine and monitor temperature gauge'] },
      { title: 'Replace faulty thermostat', difficulty: 'Mechanic', steps: ['Drain coolant into a clean container', 'Locate thermostat housing (follow upper radiator hose)', 'Remove housing bolts and replace thermostat + gasket', 'Refill coolant and bleed air from system'] },
      { title: 'Flush & inspect cooling system', difficulty: 'Specialist', steps: ['Pressure-test entire cooling system for leaks', 'Perform full coolant flush and refill', 'Inspect water pump impeller and radiator fins', 'Check head gasket integrity if overheating is severe'] },
    ],
    source: 'RK001 - Engine Overheating',
  },
  {
    title: 'Brake System Issue',
    symptoms: ['brake', 'grinding', 'squealing', 'squeaking', 'pull', 'pedal', 'stopping', 'abs'],
    possible_causes: ['Worn brake pads', 'Warped brake disc', 'Low brake fluid', 'Brake caliper sticking'],
    complexity: 'Moderate', cost_min: 1500, cost_max: 12000,
    repair_time: '1-4 hours', safe_to_drive: false, risk: 'High',
    diy: ['Check brake fluid level', 'Visually inspect pad thickness through wheel spokes'],
    fix_solutions: [
      { title: 'Top up brake fluid (bypass only)', difficulty: 'DIY', steps: ['Locate brake fluid reservoir under bonnet', 'Use DOT-3 or DOT-4 fluid as specified on cap', 'Fill to MAX line — do NOT overfill', 'Check for fluid leaks before driving'] },
      { title: 'Replace brake pads', difficulty: 'Mechanic', steps: ['Jack up vehicle and remove wheel', 'Remove caliper bolts and slide out old pads', 'Compress caliper piston using a C-clamp', 'Insert new pads, reassemble and bed them in with 10 gentle stops'] },
      { title: 'Resurface or replace brake discs', difficulty: 'Specialist', steps: ['Measure disc thickness with a micrometer', 'Resurface if within spec, replace if below minimum', 'Replace both sides simultaneously for even braking', 'Test drive and check for pulling or vibration'] },
    ],
    source: 'RK002 - Brake System',
  },
  {
    title: 'Battery / Electrical Problem',
    symptoms: ['battery', 'start', 'crank', 'electrical', 'charging', 'alternator', 'click', 'dead'],
    possible_causes: ['Weak or dead battery', 'Faulty alternator', 'Bad starter motor', 'Corroded terminals'],
    complexity: 'Simple', cost_min: 800, cost_max: 8000,
    repair_time: '30 min – 2 hours', safe_to_drive: true, risk: 'Low',
    diy: ['Check battery terminals for corrosion', 'Measure battery voltage (12.6V = fully charged)'],
    fix_solutions: [
      { title: 'Jump-start the vehicle', difficulty: 'DIY', steps: ['Connect red (+) jumper cable to dead battery positive', 'Connect other red end to good battery positive', 'Connect black (–) to good battery negative', 'Connect other black end to unpainted metal on dead car, then start'] },
      { title: 'Clean terminals & recharge battery', difficulty: 'DIY', steps: ['Disconnect negative cable first, then positive', 'Scrub terminals with baking soda + water solution', 'Reconnect and charge battery at 10A for 4–6 hours', 'Test voltage: 12.6V+ = good, below 12V = replace'] },
      { title: 'Replace battery or alternator', difficulty: 'Mechanic', steps: ['Load-test battery to confirm failure', 'Disconnect old battery (negative first)', 'Install new battery of same CCA rating', 'Test alternator output (13.5–14.5V at idle) — replace if out of range'] },
    ],
    source: 'RK005 - Battery / Electrical',
  },
  {
    title: 'Transmission / Gearbox Issue',
    symptoms: ['gear', 'transmission', 'slip', 'jerk', 'shudder', 'shift', 'clutch', 'vibrat'],
    possible_causes: ['Low transmission fluid', 'Worn clutch plate', 'Faulty solenoid', 'Damaged synchros'],
    complexity: 'Complex', cost_min: 5000, cost_max: 60000,
    repair_time: '4-12 hours', safe_to_drive: false, risk: 'High',
    diy: ['Check clutch fluid level', 'Note exact driving conditions when issue occurs'],
    fix_solutions: [
      { title: 'Check & top up transmission fluid', difficulty: 'DIY', steps: ['Locate transmission dipstick (if accessible)', 'Check fluid level and colour — dark/burnt = needs change', 'Top up with manufacturer-specified ATF or MTF', 'Re-check after a short drive'] },
      { title: 'Replace clutch fluid & bleed system', difficulty: 'Mechanic', steps: ['Locate clutch master cylinder reservoir', 'Flush old fluid and refill with fresh DOT-4', 'Bleed slave cylinder until no air bubbles appear', 'Test clutch engagement point — adjust if needed'] },
      { title: 'Full gearbox inspection & repair', difficulty: 'Specialist', steps: ['Remove gearbox for internal inspection', 'Check solenoids, synchros, bearings and seals', 'Replace worn components and reseal unit', 'Refill with correct fluid and road-test thoroughly'] },
    ],
    source: 'RK006 - Transmission',
  },
  {
    title: 'AC / Air Conditioning Problem',
    symptoms: ['aircon', 'conditioning', 'compressor', 'refrigerant', 'blower', 'cooling', 'musty', 'humid', 'vent'],
    possible_causes: ['Low refrigerant', 'Faulty compressor', 'Blocked condenser', 'Clogged cabin filter'],
    complexity: 'Moderate', cost_min: 1500, cost_max: 15000,
    repair_time: '1-4 hours', safe_to_drive: true, risk: 'Low',
    diy: ['Check cabin air filter', 'Clean condenser fins of debris'],
    fix_solutions: [
      { title: 'Replace cabin air filter', difficulty: 'DIY', steps: ['Locate filter behind glove box or under dashboard', 'Remove old filter — note airflow direction arrow', 'Insert new filter in same orientation', 'Run AC for 5 minutes and check airflow improvement'] },
      { title: 'Clean condenser & regas AC', difficulty: 'Mechanic', steps: ['Flush condenser fins with low-pressure water', 'Connect AC manifold gauge set and check pressure', 'Evacuate system and recharge with correct R134a quantity', 'Check for leaks with UV dye before completing'] },
      { title: 'Compressor replacement', difficulty: 'Specialist', steps: ['Recover all refrigerant safely (mandatory)', 'Remove old compressor and check for metal debris in system', 'Flush system lines to remove contamination', 'Install new compressor, replace receiver-drier, recharge and leak-test'] },
    ],
    source: 'RK007 - AC System',
  },
  {
    title: 'Suspension / Steering Issue',
    symptoms: ['suspension', 'steering', 'noise', 'bump', 'pothole', 'bounce', 'wobble', 'pull', 'vibrat', 'shock'],
    possible_causes: ['Worn shock absorbers', 'Damaged ball joints', 'Worn tie rods', 'Wheel alignment issue'],
    complexity: 'Moderate', cost_min: 2000, cost_max: 20000,
    repair_time: '2-6 hours', safe_to_drive: false, risk: 'High',
    diy: ['Check tyre pressure', 'Push down on each corner — excess bounce = worn shocks'],
    fix_solutions: [
      { title: 'Correct tyre pressure & wheel balance', difficulty: 'DIY', steps: ['Inflate tyres to manufacturer spec (door sticker)', 'Check for uneven tread wear pattern', 'Visit a tyre shop for wheel balancing (₹100–200/wheel)', 'Re-check steering feel after balancing'] },
      { title: 'Wheel alignment & shock inspection', difficulty: 'Mechanic', steps: ['Perform 4-wheel alignment on a laser alignment machine', 'Inspect shock absorbers for oil leaks or collapse', 'Check ball joints and tie rod ends for play', 'Replace worn shocks in pairs (both front or both rear)'] },
      { title: 'Ball joint & tie rod replacement', difficulty: 'Specialist', steps: ['Press out old ball joints using a ball joint press', 'Inspect control arms and subframe for cracks', 'Install new ball joints and tie rod ends', 'Perform full 4-wheel alignment after reassembly'] },
    ],
    source: 'RK008 - Suspension',
  },
  {
    title: 'Engine Oil Pressure / Oil System',
    symptoms: ['oil', 'pressure', 'warning', 'light', 'leak', 'smoke', 'burning', 'level'],
    possible_causes: ['Low oil level', 'Faulty oil pressure sensor', 'Oil pump failure', 'Clogged oil filter'],
    complexity: 'Moderate', cost_min: 500, cost_max: 25000,
    repair_time: '1-6 hours', safe_to_drive: false, risk: 'Critical',
    diy: ['Check oil level on dipstick', 'Check for oil leaks under engine'],
    fix_solutions: [
      { title: 'Top up engine oil immediately', difficulty: 'DIY', steps: ['Switch off engine and wait 5 minutes', 'Remove dipstick, wipe clean, reinsert fully', 'Check level — add oil if below MIN mark', 'Use manufacturer-specified grade (e.g. 5W-30)'] },
      { title: 'Oil & filter change', difficulty: 'DIY', steps: ['Warm engine for 2 minutes, then switch off', 'Drain old oil via sump plug into a container', 'Replace oil filter with a new OEM-spec unit', 'Refill with correct oil quantity and grade, check level'] },
      { title: 'Oil pressure sensor & pump inspection', difficulty: 'Specialist', steps: ['Fit a mechanical oil pressure gauge to verify actual pressure', 'Replace oil pressure sensor if pressure is normal', 'Inspect oil pump pickup tube for blockage', 'Replace oil pump if pressure is genuinely low at idle'] },
    ],
    source: 'RK003 - Oil Pressure',
  },
  {
    title: 'Check Engine Light / O2 Sensor',
    symptoms: ['check', 'engine', 'cel', 'mil', 'oxygen', 'o2', 'sensor', 'emission', 'fuel', 'misfire'],
    possible_causes: ['Faulty O2 / Lambda sensor', 'Loose fuel cap', 'Spark plug issue', 'EGR valve fault'],
    complexity: 'Moderate', cost_min: 1000, cost_max: 12000,
    repair_time: '1-4 hours', safe_to_drive: true, risk: 'Medium',
    diy: ['Tighten fuel cap', 'Read OBD fault codes with a scanner'],
    fix_solutions: [
      { title: 'Check & tighten fuel cap', difficulty: 'DIY', steps: ['Open fuel cap and reseat firmly until it clicks', 'Drive for 1–2 days — CEL may clear automatically', 'If CEL returns, proceed to OBD scan', 'Replace fuel cap if seal is cracked or worn'] },
      { title: 'OBD-II scan & spark plug replacement', difficulty: 'Mechanic', steps: ['Connect OBD-II scanner and note all fault codes', 'Clear codes and test drive to confirm which return', 'Replace spark plugs if P030X misfires are present', 'Use manufacturer-specified plug type and gap'] },
      { title: 'O2 sensor or EGR valve replacement', difficulty: 'Specialist', steps: ['Confirm faulty O2 sensor via live data on scanner', 'Apply penetrating oil to sensor threads, wait 10 minutes', 'Remove with O2 sensor socket and install new unit', 'Clear codes, test drive and verify readiness monitors pass'] },
    ],
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
      fix_solutions: [
        { title: 'Check all fluid levels', difficulty: 'DIY' as const, steps: ['Check engine oil on dipstick', 'Check coolant level in reservoir', 'Check brake fluid level', 'Check power steering fluid if applicable'] },
        { title: 'Perform OBD-II diagnostic scan', difficulty: 'Mechanic' as const, steps: ['Connect an OBD-II scanner to the diagnostic port', 'Note all active and pending fault codes', 'Research each code to narrow down the issue', 'Clear codes and test drive to see which return'] },
        { title: 'Full workshop inspection', difficulty: 'Specialist' as const, steps: ['Book a comprehensive vehicle health check', 'Request a printed inspection report', 'Prioritise safety-critical items first', 'Get a written cost estimate before authorising work'] },
      ],
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
    fix_solutions: best.fix_solutions,
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

  /** Fetch the logged-in user's past diagnosis reports (MOB-036). */
  getHistory(): Observable<DiagnosisReport[]> {
    return this.http.get<DiagnosisReport[]>(`${this.api}/history`);
  }

  /**
   * Fetch one saved report in full (BR-UX-03). Owner-only server-side —
   * a report belonging to someone else returns 403 (MOB-007).
   */
  getDiagnosis(id: string): Observable<DiagnosisReport> {
    return this.http.get<DiagnosisReport>(`${this.api}/${id}`);
  }

  /** Delete one of the caller's own reports (BR-SEC-05). */
  deleteDiagnosis(id: string): Observable<void> {
    return this.http.delete<void>(`${this.api}/${id}`);
  }

  /** Erase all stored voice transcripts and conversations (BR-SEC-06, DPDP). */
  deleteVoiceData(): Observable<{ transcripts_deleted: number; conversations_deleted: number }> {
    return this.http.delete<{ transcripts_deleted: number; conversations_deleted: number }>(
      `${this.api}/voice/data`
    );
  }

  /** Record a mic consent decision server-side (BR-SEC-01). */
  recordConsent(granted: boolean, consentVersion: number, language: string): Observable<any> {
    return this.http.post(`${this.api}/voice/consent`, {
      granted, consent_version: consentVersion, language,
    });
  }
}
