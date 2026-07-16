"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface ValuationResult {
  ai_valuation: number | null;
  ai_method: string | null;
  ai_confidence: string | null;
  ai_reasoning: string | null;
}

interface Props {
  listingId: string;
  currentValuation: number | null;
  currentMethod?: string | null;
  currentConfidence?: string | null;
  currentReasoning?: string | null;
}

function formatPrice(price: number) {
  if (price >= 10_00_000) return `₹${(price / 10_00_000).toFixed(2)} Lakh`;
  return `₹${price.toLocaleString("en-IN")}`;
}

function MethodBadge({ method }: { method: string }) {
  const isHeuristic = method.startsWith("heuristic");
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${
        isHeuristic
          ? "bg-muted text-muted-foreground"
          : "bg-accent/15 text-accent"
      }`}
    >
      {isHeuristic ? "Heuristic estimate" : "AI analysis"}
    </span>
  );
}

function ConfidenceDots({ confidence }: { confidence: string }) {
  const level = confidence === "high" ? 3 : confidence === "medium" ? 2 : 1;
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`inline-block w-1.5 h-1.5 rounded-full ${
            i <= level ? "bg-accent" : "bg-border"
          }`}
        />
      ))}
      <span className="text-[10px] text-muted-foreground ml-1 capitalize">{confidence}</span>
    </span>
  );
}

export default function ValuationButton({
  listingId,
  currentValuation,
  currentMethod,
  currentConfidence,
  currentReasoning,
}: Props) {
  const { data: session } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ValuationResult>({
    ai_valuation: currentValuation,
    ai_method: currentMethod ?? null,
    ai_confidence: currentConfidence ?? null,
    ai_reasoning: currentReasoning ?? null,
  });
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
      setResult({
        ai_valuation: data.ai_valuation,
        ai_method: data.ai_method,
        ai_confidence: data.ai_confidence,
        ai_reasoning: data.ai_reasoning,
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border p-4 bg-card">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-accent font-display text-base">✦</span>
        <h3 className="font-semibold text-sm">Price Valuation</h3>
      </div>

      {result.ai_valuation ? (
        <div className="flex flex-col gap-2">
          <p className="text-2xl font-bold text-primary">{formatPrice(result.ai_valuation)}</p>

          <div className="flex items-center gap-2 flex-wrap">
            {result.ai_method && <MethodBadge method={result.ai_method} />}
            {result.ai_confidence && <ConfidenceDots confidence={result.ai_confidence} />}
          </div>

          {result.ai_reasoning && (
            <p className="text-xs text-muted-foreground leading-relaxed border-l-2 border-accent/30 pl-2">
              {result.ai_reasoning}
            </p>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="mt-1 text-xs h-7 self-start"
            onClick={handleValuate}
            disabled={loading}
          >
            {loading ? "Re-valuating…" : "Refresh estimate"}
          </Button>
        </div>
      ) : (
        <div>
          <p className="text-sm text-muted-foreground mb-3">
            Get a fair market price estimate based on depreciation, mileage, and market data.
          </p>
          <Button
            size="sm"
            onClick={handleValuate}
            disabled={loading}
            className="w-full"
          >
            {loading ? "Analysing…" : session ? "Get Valuation" : "Sign in to valuate"}
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-destructive mt-2">{error}</p>}
    </div>
  );
}
