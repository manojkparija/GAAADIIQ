"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

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
      setValuation(data.ai_valuation);
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
          <p className="text-xs text-muted-foreground mt-0.5">AI estimated fair market value</p>
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
