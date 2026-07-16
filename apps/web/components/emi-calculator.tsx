"use client";

import { useState, useEffect, useCallback } from "react";

interface EMIResult {
  monthly_emi: number;
  total_payment: number;
  total_interest: number;
  down_payment_20pct: number;
}

function formatINR(n: number) {
  if (n >= 10_00_000) return `₹${(n / 10_00_000).toFixed(2)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(0)}K`;
  return `₹${Math.round(n)}`;
}

interface Props {
  listingPrice: number;
}

export default function EMICalculator({ listingPrice }: Props) {
  const [principal, setPrincipal] = useState(Math.round(listingPrice * 0.8));
  const [rate, setRate] = useState(9.5);
  const [tenure, setTenure] = useState(60);
  const [result, setResult] = useState<EMIResult | null>(null);
  const [loading, setLoading] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

  const calculate = useCallback(async () => {
    if (principal <= 0 || rate <= 0 || tenure < 6) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${apiUrl}/loans/emi-calculator?principal=${principal}&annual_rate=${rate}&tenure_months=${tenure}`
      );
      if (res.ok) setResult(await res.json());
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [principal, rate, tenure, apiUrl]);

  useEffect(() => {
    const t = setTimeout(calculate, 300);
    return () => clearTimeout(t);
  }, [calculate]);

  const pct = result
    ? Math.round((result.total_interest / result.total_payment) * 100)
    : 0;

  return (
    <div className="rounded-xl border p-5 space-y-5">
      <h3 className="font-semibold text-sm">EMI Calculator</h3>

      {/* Loan amount */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Loan Amount</span>
          <span className="font-medium">{formatINR(principal)}</span>
        </div>
        <input
          type="range"
          min={50000}
          max={Math.max(listingPrice, 5_000_000)}
          step={10000}
          value={principal}
          onChange={(e) => setPrincipal(parseInt(e.target.value))}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>₹50K</span><span>{formatINR(Math.max(listingPrice, 5_000_000))}</span>
        </div>
      </div>

      {/* Interest rate */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Interest Rate (% p.a.)</span>
          <span className="font-medium">{rate.toFixed(1)}%</span>
        </div>
        <input
          type="range" min={6} max={20} step={0.5}
          value={rate}
          onChange={(e) => setRate(parseFloat(e.target.value))}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>6%</span><span>20%</span>
        </div>
      </div>

      {/* Tenure */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Tenure</span>
          <span className="font-medium">{tenure} months ({Math.round(tenure / 12)} yrs)</span>
        </div>
        <input
          type="range" min={6} max={84} step={6}
          value={tenure}
          onChange={(e) => setTenure(parseInt(e.target.value))}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>6 mo</span><span>7 yrs</span>
        </div>
      </div>

      {/* Result */}
      {result && (
        <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Monthly EMI</span>
            <span className="text-xl font-bold text-primary">{formatINR(result.monthly_emi)}</span>
          </div>

          {/* Mini donut-like bar */}
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${100 - pct}%` }}
            />
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div>
              <p className="text-muted-foreground">Principal</p>
              <p className="font-semibold">{formatINR(principal)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Interest</p>
              <p className="font-semibold text-accent">{formatINR(result.total_interest)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Total</p>
              <p className="font-semibold">{formatINR(result.total_payment)}</p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Suggested 20% down: <strong>{formatINR(result.down_payment_20pct)}</strong>
          </p>
        </div>
      )}

      {loading && <p className="text-xs text-center text-muted-foreground">Calculating…</p>}
    </div>
  );
}
