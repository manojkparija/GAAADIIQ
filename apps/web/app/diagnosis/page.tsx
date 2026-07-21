"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// ── Constants ──────────────────────────────────────────────────────────────

const MAKES_MODELS: Record<string, string[]> = {
  "Maruti Suzuki": ["Alto", "Alto K10", "S-Presso", "Celerio", "WagonR", "Swift", "Dzire", "Ignis", "Baleno", "Fronx", "Jimny", "Brezza", "Ertiga", "XL6", "Grand Vitara"],
  "Hyundai": ["Santro", "Grand i10 Nios", "i20", "Aura", "Verna", "Creta", "Alcazar", "Tucson", "Venue", "Exter"],
  "Tata": ["Tiago", "Tigor", "Altroz", "Nexon", "Punch", "Harrier", "Safari", "Curvv", "Nexon EV", "Tiago EV"],
  "Mahindra": ["Bolero", "Scorpio", "Scorpio N", "Thar", "XUV300", "XUV400", "XUV700", "BE 6"],
  "Kia": ["Sonet", "Seltos", "Carens", "EV6", "Carnival"],
  "Honda": ["Amaze", "City", "Elevate", "Jazz", "WR-V"],
  "Toyota": ["Glanza", "Urban Cruiser Hyryder", "Innova Crysta", "Innova HyCross", "Fortuner", "Camry"],
  "MG": ["Hector", "Astor", "ZS EV", "Windsor EV", "Gloster"],
  "Skoda": ["Kushaq", "Slavia", "Kodiaq", "Superb", "Octavia"],
  "Volkswagen": ["Taigun", "Virtus", "Tiguan", "Polo"],
  "Renault": ["Kwid", "Triber", "Kiger", "Duster"],
  "Nissan": ["Magnite", "Kicks", "Micra"],
  "Other": ["Other"],
};

const WARNING_LIGHTS = [
  "Check Engine (MIL)", "Oil Pressure", "Battery / Charging", "Temperature / Overheat",
  "Brake Warning", "ABS Warning", "Airbag / SRS", "TPMS (Tyre Pressure)",
  "Transmission Warning", "DPF Warning", "EV Battery Warning", "Service Due",
  "Fuel Low", "Power Steering", "ADAS / Lane Warning",
];

const WHEN_OPTIONS = [
  "Cold Start", "Hot Start", "After Warm-Up", "Idle / Stationary",
  "Low Speed Driving", "Highway Driving", "Braking", "Acceleration",
  "Turning / Cornering", "Gear Change", "Going Uphill", "Going Downhill",
  "AC On", "Rainy / Wet Conditions", "Always / Constantly",
];

const FUEL_TYPES = ["Petrol", "Diesel", "CNG", "Electric", "Hybrid", "LPG"];
const TRANSMISSIONS = ["Manual", "Automatic", "CVT", "DCT", "AMT"];
const YEARS = Array.from({ length: 35 }, (_, i) => new Date().getFullYear() - i);

const SEVERITIES = [
  { value: "low", label: "Low", desc: "Slight inconvenience, car drives fine" },
  { value: "medium", label: "Medium", desc: "Noticeable issue, drivability affected" },
  { value: "high", label: "High", desc: "Significant problem, use with caution" },
  { value: "critical", label: "Critical", desc: "Dangerous — do not drive" },
];

const DISCLAIMER =
  "⚠️ IMPORTANT DISCLAIMER: This is a preliminary AI-assisted assessment only. " +
  "It is NOT a professional diagnosis. Results may be inaccurate or incomplete. " +
  "A certified automotive mechanic must physically inspect the vehicle to confirm any diagnosis. " +
  "For safety-critical issues (brakes, steering, engine warning lights), do NOT drive the vehicle " +
  "until it has been professionally inspected.";

// ── KB fallback ────────────────────────────────────────────────────────────

interface KBCase {
  title: string; symptoms: string[]; causes: string[];
  complexity: string; costMin: number; costMax: number;
  repairTime: string; safeToDrive: boolean; risk: string;
  diy: string[]; source: string;
}

const KB: KBCase[] = [
  { title: "Engine Overheating", symptoms: ["overheat","temperature","coolant","radiator","steam","thermostat"], causes: ["Low coolant / coolant leak","Faulty thermostat","Failed water pump","Clogged radiator"], complexity: "Moderate", costMin: 2000, costMax: 18000, repairTime: "2–6 hours", safeToDrive: false, risk: "Critical", diy: ["Check coolant level when engine is cold","Inspect radiator cap","Look for leaks under the vehicle"], source: "RK001" },
  { title: "Brake System Issue", symptoms: ["brake","grinding","squealing","squeaking","pedal","stopping","abs"], causes: ["Worn brake pads","Warped brake disc","Low brake fluid","Brake caliper sticking"], complexity: "Moderate", costMin: 1500, costMax: 12000, repairTime: "1–4 hours", safeToDrive: false, risk: "High", diy: ["Check brake fluid level","Visually inspect pad thickness through wheel spokes"], source: "RK002" },
  { title: "Battery / Electrical Problem", symptoms: ["battery","start","crank","electrical","charging","alternator","click","dead"], causes: ["Weak or dead battery","Faulty alternator","Bad starter motor","Corroded terminals"], complexity: "Simple", costMin: 800, costMax: 8000, repairTime: "30 min – 2 hours", safeToDrive: true, risk: "Low", diy: ["Check battery terminals for corrosion","Measure battery voltage (12.6V = fully charged)"], source: "RK005" },
  { title: "Transmission / Gearbox Issue", symptoms: ["gear","transmission","slip","jerk","shudder","shift","clutch","vibrat"], causes: ["Low transmission fluid","Worn clutch plate","Faulty solenoid","Damaged synchros"], complexity: "Complex", costMin: 5000, costMax: 60000, repairTime: "4–12 hours", safeToDrive: false, risk: "High", diy: ["Check clutch fluid level","Note exact driving conditions when issue occurs"], source: "RK006" },
  { title: "AC / Air Conditioning Problem", symptoms: ["aircon","conditioning","compressor","refrigerant","blower","cooling","musty","humid","vent"], causes: ["Low refrigerant","Faulty compressor","Blocked condenser","Clogged cabin filter"], complexity: "Moderate", costMin: 1500, costMax: 15000, repairTime: "1–4 hours", safeToDrive: true, risk: "Low", diy: ["Check cabin air filter","Clean condenser fins of debris"], source: "RK007" },
  { title: "Suspension / Steering Issue", symptoms: ["suspension","steering","noise","bump","pothole","bounce","wobble","shock"], causes: ["Worn shock absorbers","Damaged ball joints","Worn tie rods","Wheel alignment issue"], complexity: "Moderate", costMin: 2000, costMax: 20000, repairTime: "2–6 hours", safeToDrive: false, risk: "High", diy: ["Check tyre pressure","Push down on each corner — excess bounce = worn shocks"], source: "RK008" },
  { title: "Engine Oil Pressure / Oil System", symptoms: ["oil","pressure","leak","smoke","burning","level"], causes: ["Low oil level","Faulty oil pressure sensor","Oil pump failure","Clogged oil filter"], complexity: "Moderate", costMin: 500, costMax: 25000, repairTime: "1–6 hours", safeToDrive: false, risk: "Critical", diy: ["Check oil level on dipstick","Check for oil leaks under engine"], source: "RK003" },
  { title: "Check Engine Light / O2 Sensor", symptoms: ["check","engine","cel","mil","oxygen","sensor","emission","fuel","misfire"], causes: ["Faulty O2 / Lambda sensor","Loose fuel cap","Spark plug issue","EGR valve fault"], complexity: "Moderate", costMin: 1000, costMax: 12000, repairTime: "1–4 hours", safeToDrive: true, risk: "Medium", diy: ["Tighten fuel cap","Read OBD fault codes with a scanner"], source: "RK004" },
];

interface DiagnosisReport {
  preliminary_diagnosis: string;
  possible_causes: { cause: string; confidence: number; explanation: string }[];
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
  analysis_confidence: number;
  ollama_used?: boolean;
}

function clientFallback(description: string, lights: string[], when: string[], severity: string): DiagnosisReport {
  const text = (description + " " + lights.join(" ") + " " + when.join(" ")).toLowerCase();
  const words = new Set(text.split(/\W+/).filter(w => w.length > 1));
  const acBoost = when.some(w => w.toLowerCase().includes("ac"));

  let best: KBCase | null = null;
  let bestScore = 0;
  for (const c of KB) {
    let score = c.symptoms.filter(s => words.has(s)).length;
    if (acBoost && c.title.includes("AC")) score += 2;
    if (score > bestScore) { bestScore = score; best = c; }
  }

  if (!best) {
    return {
      preliminary_diagnosis: "Unable to identify a specific issue from the symptoms provided. Please consult a certified mechanic for a proper diagnostic scan.",
      possible_causes: [{ cause: "Unknown — requires professional OBD scan", confidence: 50, explanation: "Insufficient symptom data" }],
      repair_complexity: "Unknown", cost_min_inr: 500, cost_max_inr: 50000,
      repair_time_estimate: "To be determined", safe_to_drive: false, risk_level: "Medium",
      recommended_steps: ["Visit a certified service center", "Request an OBD-II diagnostic scan"],
      diy_fixes: ["Check all fluid levels", "Inspect for visible leaks"],
      immediate_service_required: severity === "high" || severity === "critical",
      preventive_maintenance: ["Follow manufacturer service schedule"],
      analysis_confidence: 20,
    };
  }

  return {
    preliminary_diagnosis: `Based on the reported symptoms, the most likely issue is related to: ${best.title}. A professional inspection is recommended to confirm.`,
    possible_causes: best.causes.slice(0, 3).map((c, i) => ({
      cause: c, confidence: Math.max(30, 75 - i * 15),
      explanation: "Based on reported symptoms matching known repair patterns",
    })),
    repair_complexity: best.complexity,
    cost_min_inr: best.costMin, cost_max_inr: best.costMax,
    repair_time_estimate: best.repairTime, safe_to_drive: best.safeToDrive,
    risk_level: best.risk,
    recommended_steps: ["Have the vehicle inspected by a certified mechanic", "Request an OBD-II diagnostic scan"],
    diy_fixes: best.diy,
    immediate_service_required: !best.safeToDrive,
    preventive_maintenance: ["Follow manufacturer service schedule", "Use manufacturer-recommended fluids"],
    analysis_confidence: 45,
  };
}

function fmtCost(n: number) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(0)}K`;
  return `₹${n}`;
}

const RISK_COLOR: Record<string, string> = {
  Low: "#10B981", Medium: "#F59E0B", High: "#EF4444", Critical: "#7C3AED",
};

// ── Main page ──────────────────────────────────────────────────────────────

export default function DiagnosisPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    make: "", model: "", variant: "", year: new Date().getFullYear() - 2,
    fuel: "", transmission: "", odometer: "",
  });
  const [description, setDescription] = useState("");
  const [lights, setLights] = useState<string[]>([]);
  const [whenOccurs, setWhenOccurs] = useState<string[]>([]);
  const [severity, setSeverity] = useState("medium");
  const [images, setImages] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<DiagnosisReport | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const models = MAKES_MODELS[form.make] ?? [];
  const step1Valid = !!form.make && !!form.model && !!form.fuel && !!form.transmission;
  const step2Valid = description.trim().length >= 10;

  function field(key: string, val: string | number) {
    setForm(f => ({
      ...f, [key]: val,
      ...(key === "make" ? { model: "", variant: "" } : {}),
      ...(key === "model" ? { variant: "" } : {}),
    }));
  }

  function toggleLight(l: string) {
    setLights(prev => prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l]);
  }

  function toggleWhen(w: string) {
    setWhenOccurs(prev => prev.includes(w) ? prev.filter(x => x !== w) : [...prev, w]);
  }

  function handleImages(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) setImages(Array.from(e.target.files).slice(0, 5));
  }

  async function submit() {
    setLoading(true);
    const result = clientFallback(description, lights, whenOccurs, severity);
    setReport(result);
    setStep(4);
    setLoading(false);

    // Try to upgrade with API result
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
      const res = await fetch(`${apiUrl}/diagnosis/analyse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manufacturer: form.make, model: form.model, variant: form.variant || undefined,
          model_year: form.year, fuel_type: form.fuel, transmission: form.transmission,
          odometer_km: form.odometer ? +form.odometer : undefined,
          problem_description: description,
          warning_lights: lights, when_occurs: whenOccurs, severity,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && !data.error) setReport(data);
      }
    } catch { /* keep client result */ }
  }

  function reset() {
    setStep(1);
    setForm({ make: "", model: "", variant: "", year: new Date().getFullYear() - 2, fuel: "", transmission: "", odometer: "" });
    setDescription(""); setLights([]); setWhenOccurs([]); setSeverity("medium");
    setImages([]); setReport(null);
  }

  // ── Step 4: Report ───────────────────────────────────────────────────────
  if (step === 4 && report) {
    const riskColor = RISK_COLOR[report.risk_level] ?? "#6B7280";
    return (
      <main className="max-w-2xl mx-auto px-4 py-10">
        <div className="mb-6">
          <p className="text-sm text-muted-foreground">{form.make} {form.model} · {form.year} · {form.fuel}</p>
          <h1 className="text-2xl font-bold mt-1">AI Diagnosis Report</h1>
          <div className="flex gap-2 mt-2 flex-wrap">
            <Badge variant={report.ollama_used ? "default" : "secondary"}>
              {report.ollama_used ? "🤖 AI-powered" : "📐 Pattern match"}
            </Badge>
            <Badge variant="outline">{report.analysis_confidence}% confidence</Badge>
            {!report.safe_to_drive && <Badge variant="destructive">⚠️ Do not drive</Badge>}
          </div>
        </div>

        {!report.ollama_used && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-4 mb-6 text-sm">
            <strong className="text-amber-700 dark:text-amber-400">ℹ️ Pattern-based estimate</strong>
            <p className="text-amber-600 dark:text-amber-300 mt-1">AI engine was unavailable. Result is from our symptom knowledge base — verify with a professional mechanic.</p>
          </div>
        )}

        <div className="rounded-xl border p-5 mb-5" style={{ borderLeftColor: riskColor, borderLeftWidth: 4 }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Preliminary Diagnosis</h2>
            <span className="text-xs px-2 py-1 rounded-full font-medium text-white" style={{ background: riskColor }}>
              {report.risk_level} Risk
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{report.preliminary_diagnosis}</p>
        </div>

        <div className="rounded-xl border p-5 mb-5">
          <h3 className="font-semibold mb-3">Possible Causes</h3>
          <div className="space-y-3">
            {report.possible_causes.map((pc, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="min-w-[3rem] text-center">
                  <span className="text-xs font-medium text-primary">{pc.confidence}%</span>
                  <div className="h-1 mt-1 rounded bg-muted">
                    <div className="h-1 rounded bg-primary" style={{ width: `${pc.confidence}%` }} />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium">{pc.cause}</p>
                  <p className="text-xs text-muted-foreground">{pc.explanation}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-5">
          <div className="rounded-xl border p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Repair Cost</p>
            <p className="font-bold text-base">{fmtCost(report.cost_min_inr)} – {fmtCost(report.cost_max_inr)}</p>
          </div>
          <div className="rounded-xl border p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Repair Time</p>
            <p className="font-bold text-base">{report.repair_time_estimate}</p>
          </div>
        </div>

        {report.diy_fixes.length > 0 && (
          <div className="rounded-xl border p-4 mb-5">
            <h3 className="font-semibold mb-3">🔧 DIY Checks You Can Do Now</h3>
            <ul className="space-y-1">
              {report.diy_fixes.map((d, i) => (
                <li key={i} className="text-sm text-muted-foreground flex gap-2">
                  <span className="text-primary font-bold shrink-0">→</span>{d}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 mb-6">
          <p className="text-xs text-amber-700 dark:text-amber-400">{DISCLAIMER}</p>
        </div>

        <div className="flex gap-3 flex-wrap">
          <Link href="/listings" className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 transition-colors">Browse Cars</Link>
          <Button variant="outline" onClick={reset}>New Diagnosis</Button>
        </div>
      </main>
    );
  }

  // ── Step 3: Confirm ──────────────────────────────────────────────────────
  if (step === 3) {
    return (
      <main className="max-w-xl mx-auto px-4 py-10">
        <StepHeader step={3} total={3} />
        <h2 className="text-xl font-bold mb-1">Confirm & Submit</h2>
        <p className="text-sm text-muted-foreground mb-6">Review your details before getting the AI diagnosis.</p>

        <div className="rounded-xl border p-4 mb-6 space-y-3">
          <Row label="Vehicle" value={`${form.make} ${form.model}${form.variant ? " " + form.variant : ""}`} />
          <Row label="Year" value={String(form.year)} />
          <Row label="Fuel / Transmission" value={`${form.fuel} / ${form.transmission}`} />
          {form.odometer && <Row label="Odometer" value={`${Number(form.odometer).toLocaleString("en-IN")} km`} />}
          <Row label="Severity" value={severity.charAt(0).toUpperCase() + severity.slice(1)} />
          {lights.length > 0 && <Row label="Warning Lights" value={lights.join(", ")} />}
          {images.length > 0 && <Row label="Photos" value={`${images.length} selected`} />}
        </div>

        <div className="rounded-xl border p-4 mb-6">
          <p className="text-xs text-muted-foreground font-medium mb-1">Problem Description</p>
          <p className="text-sm">{description}</p>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setStep(2)} className="flex-1">Back</Button>
          <Button onClick={submit} disabled={loading} className="flex-1">
            {loading ? "Analysing…" : "Get AI Diagnosis"}
          </Button>
        </div>
      </main>
    );
  }

  // ── Step 2: Symptoms ─────────────────────────────────────────────────────
  if (step === 2) {
    return (
      <main className="max-w-xl mx-auto px-4 py-10">
        <StepHeader step={2} total={3} />
        <h2 className="text-xl font-bold mb-1">Describe the Problem</h2>
        <p className="text-sm text-muted-foreground mb-6">The more detail you provide, the better the diagnosis.</p>

        <div className="space-y-5">
          <div>
            <label className="text-sm font-medium">Problem Description *</label>
            <textarea
              className="mt-1 block w-full rounded-lg border px-3 py-2 text-sm bg-background min-h-[100px]"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g. My car makes a grinding noise when braking at high speed, especially on the front-left side..."
            />
            <p className="text-xs text-muted-foreground mt-1">{description.trim().length}/10 characters minimum</p>
          </div>

          <div>
            <label className="text-sm font-medium">Warning Lights On Dashboard</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {WARNING_LIGHTS.map(l => (
                <button
                  key={l}
                  type="button"
                  onClick={() => toggleLight(l)}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${lights.includes(l) ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary"}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">When Does It Occur?</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {WHEN_OPTIONS.map(w => (
                <button
                  key={w}
                  type="button"
                  onClick={() => toggleWhen(w)}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${whenOccurs.includes(w) ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary"}`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Severity</label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {SEVERITIES.map(s => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSeverity(s.value)}
                  className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${severity === s.value ? "border-primary bg-primary/5" : "border-border hover:border-primary"}`}
                >
                  <span className="font-medium block">{s.label}</span>
                  <span className="text-xs text-muted-foreground">{s.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Photos (optional, up to 5)</label>
            <div
              className="mt-2 border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-primary transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              {images.length > 0 ? (
                <div>
                  <p className="text-sm font-medium text-primary">{images.length} photo{images.length > 1 ? "s" : ""} selected</p>
                  <p className="text-xs text-muted-foreground mt-1">{images.map(f => f.name).join(", ")}</p>
                  <button
                    type="button"
                    className="text-xs text-destructive mt-2 hover:underline"
                    onClick={e => { e.stopPropagation(); setImages([]); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                  >
                    Remove all
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-muted-foreground">📷 Tap to add photos of the issue</p>
                  <p className="text-xs text-muted-foreground mt-1">Dashboard lights, visible damage, fluid leaks</p>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleImages}
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <Button variant="outline" onClick={() => setStep(1)} className="flex-1">Back</Button>
          <Button onClick={() => setStep(3)} disabled={!step2Valid} className="flex-1">
            Review & Confirm
          </Button>
        </div>
      </main>
    );
  }

  // ── Step 1: Vehicle details ──────────────────────────────────────────────
  return (
    <main className="max-w-xl mx-auto px-4 py-10">
      <div className="mb-8">
        <Badge className="mb-3">🔍 AI Diagnosis</Badge>
        <h1 className="text-2xl font-bold">AI Vehicle Diagnosis</h1>
        <p className="text-muted-foreground text-sm mt-2">Describe your car problem and get an instant preliminary diagnosis — no sign-up needed.</p>
      </div>

      <StepHeader step={1} total={3} />

      <div className="space-y-4">
        <Select label="Car Make *" value={form.make} options={Object.keys(MAKES_MODELS)} onChange={v => field("make", v)} placeholder="Select make" />
        <Select label="Model *" value={form.model} options={models} onChange={v => field("model", v)} placeholder={form.make ? "Select model" : "Select make first"} disabled={!form.make} />
        <Select label="Year" value={String(form.year)} options={YEARS.map(String)} onChange={v => field("year", +v)} placeholder="Select year" />
        <Select label="Fuel Type *" value={form.fuel} options={FUEL_TYPES} onChange={v => field("fuel", v)} placeholder="Select fuel" />
        <Select label="Transmission *" value={form.transmission} options={TRANSMISSIONS} onChange={v => field("transmission", v)} placeholder="Select transmission" />
        <div>
          <label className="text-sm font-medium">Odometer (km)</label>
          <input type="number" className="mt-1 block w-full rounded-lg border px-3 py-2 text-sm bg-background" value={form.odometer} onChange={e => field("odometer", e.target.value)} placeholder="e.g. 45000" min={0} />
        </div>

        <Button className="w-full" disabled={!step1Valid} onClick={() => setStep(2)}>
          Next — Describe Symptoms
        </Button>
      </div>
    </main>
  );
}

// ── Shared helpers ─────────────────────────────────────────────────────────

function StepHeader({ step, total }: { step: number; total: number }) {
  return (
    <div className="mb-6">
      <div className="flex justify-between text-xs text-muted-foreground mb-1">
        <span>Step {step} of {total}</span>
        <span>{Math.round((step / total) * 100)}%</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full">
        <div className="h-1.5 bg-primary rounded-full transition-all" style={{ width: `${(step / total) * 100}%` }} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-start text-sm border-b last:border-0 pb-2 last:pb-0 gap-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

function Select({ label, value, options, onChange, placeholder, disabled }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void; placeholder: string; disabled?: boolean;
}) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <select
        className="mt-1 block w-full rounded-lg border px-3 py-2 text-sm bg-background disabled:opacity-50"
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
      >
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
