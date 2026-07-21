"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface ValuationData {
  mid: number;
  low?: number;
  high?: number;
  method?: 'claude' | 'ollama' | 'heuristic';
  confidence?: number;
}

interface Props {
  listingId: string;
  currentValuation: number | null;
}

function formatPrice(price: number) {
  if (price >= 10_00_000) return `₹${(price / 10_00_000).toFixed(2)} Lakh`;
  return `₹${price.toLocaleString("en-IN")}`;
}

export default function ValuationButton({ listingId, currentValuation }: Props) {
  const { data: session } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [valuation, setValuation] = useState<number | null>(currentValuation);
  const [valuationData, setValuationData] = useState<ValuationData | null>(null);
  const [error, setError] = useState("");

  async function handleValuate() {
    if (!session) {
      router.push("/login");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
      const token = (session as { accessToken?: string }).accessToken;

      const res = await fetch(`${apiUrl}/listings/${listingId}/valuate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? "Valuation failed");
      }

      const data = await res.json();
      setValuation(data.ai_valuation ?? data.mid ?? null);
      setValuationData(data);
      router.refresh(); // revalidate server component data
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border p-4 bg-gradient-to-br from-primary/5 to-primary/10">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">🤖</span>
        <h3 className="font-semibold text-sm">AI Price Valuation</h3>
      </div>

      {valuation ? (
        <div>
          <p className="text-xl font-bold text-primary">{formatPrice(valuation)}</p>
          {valuationData?.low && valuationData?.high && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatPrice(valuationData.low)} – {formatPrice(valuationData.high)} range
            </p>
          )}
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              valuationData?.method === 'claude' || valuationData?.method === 'ollama'
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
            }`}>
              {valuationData?.method === 'claude' ? '🤖 AI' : valuationData?.method === 'ollama' ? '🦙 AI' : '📐 Formula'}
            </span>
            {valuationData?.confidence && (
              <span className="text-xs text-muted-foreground">{valuationData.confidence}% confidence</span>
            )}
          </div>
          {valuationData?.method === 'heuristic' && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Formula estimate — AI unavailable</p>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 text-xs h-7"
            onClick={handleValuate}
            disabled={loading}
          >
            {loading ? "Re-valuating…" : "Re-run valuation"}
          </Button>
        </div>
      ) : (
        <div>
          <p className="text-sm text-muted-foreground mb-3">
            Get an instant AI-powered fair market price estimate for this car.
          </p>
          <Button
            size="sm"
            onClick={handleValuate}
            disabled={loading}
            className="w-full"
          >
            {loading ? "Analysing…" : session ? "Get AI Valuation" : "Sign in to valuate"}
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-destructive mt-2">{error}</p>}
    </div>
  );
}
