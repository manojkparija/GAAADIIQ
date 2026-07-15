"use client";

import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Calculator, TrendingDown, Fuel, Shield, Wrench, IndianRupee } from "lucide-react";

interface TCOInputs {
  purchasePrice: number;
  fuelType: "petrol" | "diesel" | "electric" | "cng";
  kmPerYear: number;
  yearsOwned: number;
  insurancePremiumPct: number;
  maintenancePerYear: number;
  fuelPricePerLitre: number;
  mileageKmpl: number;
}

interface TCOResult {
  depreciation: number;
  fuelCost: number;
  insurance: number;
  maintenance: number;
  total: number;
  perYear: number;
  perKm: number;
  resaleValue: number;
}

const DEFAULTS: TCOInputs = {
  purchasePrice: 1000000,
  fuelType: "petrol",
  kmPerYear: 15000,
  yearsOwned: 5,
  insurancePremiumPct: 3,
  maintenancePerYear: 15000,
  fuelPricePerLitre: 100,
  mileageKmpl: 15,
};

const FUEL_DEFAULTS: Record<TCOInputs["fuelType"], { price: number; mileage: number; label: string }> = {
  petrol: { price: 100, mileage: 15, label: "Petrol" },
  diesel: { price: 88, mileage: 18, label: "Diesel" },
  electric: { price: 8, mileage: 100, label: "Electric (₹/kWh, km/kWh equiv)" },
  cng: { price: 75, mileage: 22, label: "CNG" },
};

// Annual depreciation rates (India used car market approximation)
const DEPRECIATION = [0.2, 0.15, 0.12, 0.10, 0.08];

function calcTCO(inputs: TCOInputs): TCOResult {
  const { purchasePrice, kmPerYear, yearsOwned, insurancePremiumPct, maintenancePerYear, fuelPricePerLitre, mileageKmpl } = inputs;
  const years = Math.min(Math.max(1, yearsOwned), 10);

  // Depreciation — compound over years
  let resaleValue = purchasePrice;
  for (let y = 0; y < years; y++) {
    const rate = DEPRECIATION[Math.min(y, DEPRECIATION.length - 1)];
    resaleValue *= (1 - rate);
  }
  const depreciation = purchasePrice - resaleValue;

  const totalKm = kmPerYear * years;
  const fuelCost = (totalKm / mileageKmpl) * fuelPricePerLitre;
  const insurance = purchasePrice * (insurancePremiumPct / 100) * years;
  const maintenance = maintenancePerYear * years;

  const total = depreciation + fuelCost + insurance + maintenance;
  const perYear = total / years;
  const perKm = total / totalKm;

  return { depreciation, fuelCost, insurance, maintenance, total, perYear, perKm, resaleValue };
}

function formatINR(n: number, decimals = 0) {
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)} Cr`;
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(1)} L`;
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: decimals })}`;
}

function NumberInput({
  label,
  value,
  onChange,
  prefix,
  suffix,
  step = 1000,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
  step?: number;
  min?: number;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-foreground mb-1.5 block">{label}</label>
      <div className="flex items-center gap-2">
        {prefix && <span className="text-muted-foreground text-sm shrink-0">{prefix}</span>}
        <Input
          type="number"
          value={value}
          min={min}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full"
        />
        {suffix && <span className="text-muted-foreground text-sm shrink-0">{suffix}</span>}
      </div>
    </div>
  );
}

function CostBar({ label, value, total, color, icon }: { label: string; value: number; total: number; color: string; icon: React.ReactNode }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{formatINR(value)}</span>
          <span className="text-xs text-muted-foreground">({pct.toFixed(0)}%)</span>
        </div>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function TCOPage() {
  const [inputs, setInputs] = useState<TCOInputs>(DEFAULTS);

  const set = (key: keyof TCOInputs, value: number | string) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  };

  const setFuelType = (ft: TCOInputs["fuelType"]) => {
    const d = FUEL_DEFAULTS[ft];
    setInputs((prev) => ({ ...prev, fuelType: ft, fuelPricePerLitre: d.price, mileageKmpl: d.mileage }));
  };

  const result = useMemo(() => calcTCO(inputs), [inputs]);

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded-full px-4 py-1.5 text-sm font-medium mb-4">
            <Calculator className="h-4 w-4" />
            TCO Calculator
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Total Cost of Ownership</h1>
          <p className="text-muted-foreground mt-1">
            Beyond the sticker price — understand the true 5-year cost of owning a car.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Inputs */}
          <div className="bg-card rounded-2xl border p-6 flex flex-col gap-5">
            <h2 className="font-semibold text-lg">Vehicle Details</h2>

            <NumberInput
              label="Purchase Price"
              value={inputs.purchasePrice}
              onChange={(v) => set("purchasePrice", v)}
              prefix="₹"
              step={50000}
              min={100000}
            />

            <div>
              <label className="text-sm font-medium mb-1.5 block">Fuel Type</label>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(FUEL_DEFAULTS) as TCOInputs["fuelType"][]).map((ft) => (
                  <button
                    key={ft}
                    onClick={() => setFuelType(ft)}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-all
                      ${inputs.fuelType === ft
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-border hover:border-primary/40"}`}
                  >
                    {FUEL_DEFAULTS[ft].label.split(" ")[0]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <NumberInput
                label="KM per Year"
                value={inputs.kmPerYear}
                onChange={(v) => set("kmPerYear", v)}
                step={1000}
                min={1000}
              />
              <NumberInput
                label="Years Owned"
                value={inputs.yearsOwned}
                onChange={(v) => set("yearsOwned", Math.min(10, Math.max(1, v)))}
                step={1}
                min={1}
              />
            </div>

            <h2 className="font-semibold text-lg pt-2 border-t">Running Costs</h2>

            <div className="grid grid-cols-2 gap-4">
              <NumberInput
                label={inputs.fuelType === "electric" ? "Electricity (₹/kWh)" : "Fuel Price (₹/L)"}
                value={inputs.fuelPricePerLitre}
                onChange={(v) => set("fuelPricePerLitre", v)}
                step={1}
                min={1}
              />
              <NumberInput
                label={inputs.fuelType === "electric" ? "Range (km/kWh)" : "Mileage (km/L)"}
                value={inputs.mileageKmpl}
                onChange={(v) => set("mileageKmpl", v)}
                step={1}
                min={1}
              />
            </div>

            <NumberInput
              label="Insurance (% of value/year)"
              value={inputs.insurancePremiumPct}
              onChange={(v) => set("insurancePremiumPct", v)}
              suffix="%"
              step={0.5}
              min={0}
            />
            <NumberInput
              label="Maintenance per Year"
              value={inputs.maintenancePerYear}
              onChange={(v) => set("maintenancePerYear", v)}
              prefix="₹"
              step={5000}
              min={0}
            />
          </div>

          {/* Results */}
          <div className="flex flex-col gap-5">
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-primary/10 rounded-xl p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">Total {inputs.yearsOwned}yr Cost</p>
                <p className="text-xl font-bold text-primary">{formatINR(result.total)}</p>
              </div>
              <div className="bg-card rounded-xl border p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">Per Year</p>
                <p className="text-xl font-bold">{formatINR(result.perYear)}</p>
              </div>
              <div className="bg-card rounded-xl border p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">Per KM</p>
                <p className="text-xl font-bold">₹{result.perKm.toFixed(1)}</p>
              </div>
            </div>

            {/* Resale value */}
            <div className="bg-card rounded-xl border p-5 flex items-center gap-4">
              <TrendingDown className="h-8 w-8 text-amber-500 shrink-0" />
              <div>
                <p className="text-sm text-muted-foreground">Estimated Resale Value after {inputs.yearsOwned} years</p>
                <p className="text-2xl font-bold">{formatINR(result.resaleValue)}</p>
              </div>
              <Badge variant="outline" className="ml-auto shrink-0">
                {((result.resaleValue / inputs.purchasePrice) * 100).toFixed(0)}% retained
              </Badge>
            </div>

            {/* Cost breakdown bars */}
            <div className="bg-card rounded-2xl border p-6 flex flex-col gap-5">
              <h2 className="font-semibold text-lg">Cost Breakdown</h2>
              <CostBar
                label="Depreciation"
                value={result.depreciation}
                total={result.total}
                color="bg-rose-500"
                icon={<TrendingDown className="h-4 w-4" />}
              />
              <CostBar
                label="Fuel / Energy"
                value={result.fuelCost}
                total={result.total}
                color="bg-amber-500"
                icon={<Fuel className="h-4 w-4" />}
              />
              <CostBar
                label="Insurance"
                value={result.insurance}
                total={result.total}
                color="bg-blue-500"
                icon={<Shield className="h-4 w-4" />}
              />
              <CostBar
                label="Maintenance"
                value={result.maintenance}
                total={result.total}
                color="bg-emerald-500"
                icon={<Wrench className="h-4 w-4" />}
              />

              <div className="pt-4 border-t flex items-center justify-between">
                <span className="font-medium flex items-center gap-1.5">
                  <IndianRupee className="h-4 w-4" />
                  Grand Total
                </span>
                <span className="text-xl font-bold text-primary">{formatINR(result.total)}</span>
              </div>
            </div>

            <p className="text-xs text-muted-foreground px-1">
              * Depreciation uses market-standard rates (20%→15%→12%→10%→8% per year).
              Actual costs vary by city, driving style, and insurer.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
