"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const MAKES = [
  "Maruti Suzuki", "Hyundai", "Tata", "Mahindra", "Honda", "Toyota",
  "Kia", "MG Motor", "Volkswagen", "Skoda", "Renault", "Nissan",
  "BMW", "Mercedes-Benz", "Audi", "Other",
];
const FUELS = ["Petrol", "Diesel", "Electric", "CNG", "Hybrid"];
const TRANSMISSIONS = ["Manual", "Automatic", "AMT", "CVT", "DCT"];
const OWNERS = ["1st Owner", "2nd Owner", "3rd Owner", "4th+ Owner"];
const CONDITIONS = ["Excellent", "Good", "Fair", "Needs Work"];

const YEARS = Array.from({ length: 27 }, (_, i) => new Date().getFullYear() - i);

// Segment fallback base prices (₹)
const SEGMENT_BASE: Record<string, number> = {
  BMW: 5000000, "Mercedes-Benz": 6000000, Audi: 5000000,
  Toyota: 1800000, Honda: 1200000, Hyundai: 1200000,
  Kia: 1200000, "MG Motor": 1500000, Tata: 900000,
  Mahindra: 1200000, "Maruti Suzuki": 750000, Skoda: 1500000,
  Volkswagen: 1300000, Renault: 700000, Nissan: 800000,
};

interface Result {
  low: number; mid: number; high: number;
  confidence: number; depreciation: number;
  marketTrend: string; tips: string[];
  method: "claude" | "heuristic";
}

function fmt(p: number) {
  if (p >= 10_00_000) return `₹${(p / 10_00_000).toFixed(2)}L`;
  return `₹${p.toLocaleString("en-IN")}`;
}

function heuristic(form: Record<string, string>): Result {
  const age = new Date().getFullYear() - +form.year;
  const km = +form.km;
  const base = SEGMENT_BASE[form.make] ?? 900000;

  let dep = 0;
  for (let i = 0; i < age; i++) dep += i === 0 ? 0.15 : i < 5 ? 0.10 : 0.07;
  dep = Math.min(dep, 0.75);

  const kmPenalty = Math.max(0, (km - age * 15000) / 10000) * 0.01;
  const ownerPenalty = form.owners === "1st Owner" ? 0 : form.owners === "2nd Owner" ? 0.05 : form.owners === "3rd Owner" ? 0.10 : 0.15;
  const condMod = form.condition === "Excellent" ? 1.05 : form.condition === "Good" ? 1.0 : form.condition === "Fair" ? 0.92 : 0.82;
  const fuelMod = form.fuel === "Electric" ? 1.08 : form.fuel === "Hybrid" ? 1.04 : form.fuel === "CNG" ? 0.96 : 1.0;
  const transMod = form.transmission === "Automatic" || form.transmission === "DCT" ? 1.03 : 1.0;

  const mid = Math.round(base * (1 - dep - kmPenalty - ownerPenalty) * condMod * fuelMod * transMod / 1000) * 1000;
  const tips: string[] = [];
  if (km > 80000) tips.push("Full service record boosts buyer confidence significantly.");
  if (age >= 5) tips.push("Paint polish and interior detailing can improve first impression.");
  if (form.owners !== "1st Owner") tips.push("Highlight any warranty or extended service packages.");
  if (form.condition !== "Excellent") tips.push("Minor dent/scratch repairs can add ₹20–40k to your price.");
  if (!tips.length) tips.push("Great shape — list at the high end of the range!");

  return {
    low: Math.round(mid * 0.90 / 1000) * 1000,
    mid,
    high: Math.round(mid * 1.10 / 1000) * 1000,
    confidence: 65,
    depreciation: Math.round((dep + kmPenalty + ownerPenalty) * 100),
    marketTrend: form.fuel === "Electric" ? "📈 EVs in strong demand" : form.fuel === "Diesel" ? "📉 Diesel softening in metros" : "➡️ Petrol market stable",
    tips,
    method: "heuristic",
  };
}

export default function ValuationPage() {
  const [form, setForm] = useState({
    make: "", model: "", variant: "", year: String(new Date().getFullYear() - 2),
    km: "", fuel: "", transmission: "", owners: "", condition: "",
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const valid = form.make && form.year && form.km && form.fuel && form.owners && form.condition;

  async function estimate() {
    if (!valid) return;
    setLoading(true);
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (supabaseUrl && supabaseKey) {
        const res = await fetch(`${supabaseUrl}/functions/v1/ai-valuation`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "apikey": supabaseKey },
          body: JSON.stringify(form),
        });
        if (res.ok) {
          const data = await res.json();
          if (!data.error) {
            setResult({ ...data, method: data.method ?? "claude" });
            return;
          }
        }
      }
    } catch { /* fall through */ }
    finally { setLoading(false); }
    setResult(heuristic(form));
  }

  function reset() { setResult(null); setForm({ make: "", model: "", variant: "", year: String(new Date().getFullYear() - 2), km: "", fuel: "", transmission: "", owners: "", condition: "" }); }

  function field(key: string, val: string) { setForm(f => ({ ...f, [key]: val, ...(key === "make" ? { model: "", variant: "" } : {}) })); }

  if (result) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-10">
        <div className="mb-6">
          <p className="text-sm text-muted-foreground">{form.make} {form.model} · {form.year} · {form.fuel}</p>
          <h1 className="text-2xl font-bold mt-1">Market Valuation</h1>
          <div className="flex gap-2 mt-2">
            <Badge variant={result.method === "claude" ? "default" : "secondary"}>
              {result.method === "claude" ? "🤖 AI-powered" : "📐 Formula estimate"}
            </Badge>
            <Badge variant="outline">{result.confidence}% confidence</Badge>
          </div>
        </div>

        {result.method === "heuristic" && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-4 mb-6 text-sm">
            <strong className="text-amber-700 dark:text-amber-400">ℹ️ Formula estimate</strong>
            <p className="text-amber-600 dark:text-amber-300 mt-1">AI engine was unavailable. This is a depreciation-model estimate — verify with a dealer for a precise quote.</p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: "Distress Sale", value: result.low, dim: true },
            { label: "Fair Market", value: result.mid, highlight: true },
            { label: "Premium Ask", value: result.high, dim: true },
          ].map(({ label, value, highlight, dim }) => (
            <div key={label} className={`rounded-xl border p-4 text-center ${highlight ? "border-primary bg-primary/5" : ""}`}>
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <p className={`font-bold ${highlight ? "text-xl text-primary" : "text-base"}`}>{fmt(value)}</p>
              {highlight && <p className="text-xs text-muted-foreground mt-1">Best price to list</p>}
            </div>
          ))}
        </div>

        <div className="rounded-xl border p-4 mb-6 space-y-3">
          <Row label="Total Depreciation" value={`−${result.depreciation}%`} />
          <Row label="Market Trend" value={result.marketTrend} />
          <Row label="Kilometres" value={`${Number(form.km).toLocaleString("en-IN")} km`} />
          <Row label="Ownership" value={form.owners} />
          <Row label="Condition" value={form.condition} />
        </div>

        <div className="rounded-xl border p-4 mb-8">
          <h3 className="font-semibold mb-3">💡 Tips to Maximise Your Price</h3>
          <ul className="space-y-2">
            {result.tips.map((t, i) => <li key={i} className="text-sm text-muted-foreground flex gap-2"><span className="text-primary font-bold">→</span>{t}</li>)}
          </ul>
        </div>

        <div className="flex gap-3 flex-wrap">
          <Button asChild><a href="/listings">Browse Listings</a></Button>
          <Button variant="outline" onClick={reset}>Value Another Car</Button>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-xl mx-auto px-4 py-10">
      <div className="mb-8">
        <Badge className="mb-3">🤖 AI Valuation</Badge>
        <h1 className="text-2xl font-bold">What Is Your Car Worth?</h1>
        <p className="text-muted-foreground text-sm mt-2">Get a free fair-market estimate — no sign-up needed.</p>
      </div>

      <div className="space-y-4">
        <Select label="Car Make *" value={form.make} options={MAKES} onChange={v => field("make", v)} placeholder="Select make" />
        <div>
          <label className="text-sm font-medium">Model</label>
          <input className="mt-1 block w-full rounded-lg border px-3 py-2 text-sm bg-background" value={form.model} onChange={e => field("model", e.target.value)} placeholder="e.g. Swift, Creta, Nexon" />
        </div>
        <Select label="Year *" value={form.year} options={YEARS.map(String)} onChange={v => field("year", v)} placeholder="Select year" />
        <div>
          <label className="text-sm font-medium">Kilometres Driven *</label>
          <input type="number" className="mt-1 block w-full rounded-lg border px-3 py-2 text-sm bg-background" value={form.km} onChange={e => field("km", e.target.value)} placeholder="e.g. 45000" min={0} />
        </div>
        <Select label="Fuel Type *" value={form.fuel} options={FUELS} onChange={v => field("fuel", v)} placeholder="Select fuel" />
        <Select label="Transmission" value={form.transmission} options={TRANSMISSIONS} onChange={v => field("transmission", v)} placeholder="Select (optional)" />
        <Select label="No. of Owners *" value={form.owners} options={OWNERS} onChange={v => field("owners", v)} placeholder="Select" />
        <Select label="Overall Condition *" value={form.condition} options={CONDITIONS} onChange={v => field("condition", v)} placeholder="Select condition" />

        <Button className="w-full" disabled={!valid || loading} onClick={estimate}>
          {loading ? "Analysing…" : "Get Valuation"}
        </Button>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center text-sm border-b last:border-0 pb-2 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Select({ label, value, options, onChange, placeholder }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <select
        className="mt-1 block w-full rounded-lg border px-3 py-2 text-sm bg-background"
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
