"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const DURATION_OPTIONS = [
  { days: 7, label: "7 days", price: "₹499" },
  { days: 30, label: "30 days", price: "₹1,499" },
  { days: 90, label: "90 days", price: "₹3,499" },
];

interface BoostListingButtonProps {
  listingId: string;
  isFeatured?: boolean;
  onBoostSuccess?: () => void;
}

export default function BoostListingButton({ listingId, isFeatured, onBoostSuccess }: BoostListingButtonProps) {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(30);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  async function handleBoost() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/payments/feature-listing`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${(session as any)?.access_token}`,
        },
        body: JSON.stringify({ listing_id: listingId, duration_days: selected }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail ?? "Failed to boost listing");
      }
      const data = await res.json();
      if (data.dev_mode) {
        setSuccess(true);
        onBoostSuccess?.();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (isFeatured) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">
        ⭐ Featured
      </span>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <Button variant="outline" size="sm" className="text-amber-600 border-amber-300 hover:bg-amber-50">
          ⭐ Boost
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Boost this listing</DialogTitle>
          <DialogDescription>
            Featured listings appear at the top of search results and get 3× more views.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="py-6 text-center">
            <div className="text-4xl mb-2">🎉</div>
            <p className="font-medium">Listing boosted successfully!</p>
            <p className="text-sm text-muted-foreground mt-1">Your listing is now featured.</p>
          </div>
        ) : (
          <>
            <div className="grid gap-2 py-2">
              {DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.days}
                  onClick={() => setSelected(opt.days)}
                  className={`flex justify-between items-center p-3 rounded-lg border text-left transition-colors ${
                    selected === opt.days
                      ? "border-amber-400 bg-amber-50 text-amber-700"
                      : "border-border hover:border-amber-200"
                  }`}
                >
                  <span className="font-medium">{opt.label}</span>
                  <span className="text-sm font-semibold">{opt.price}</span>
                </button>
              ))}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </>
        )}

        <DialogFooter>
          {success ? (
            <Button onClick={() => { setOpen(false); setSuccess(false); }}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={handleBoost} disabled={loading} className="bg-amber-500 hover:bg-amber-600 text-white">
                {loading ? "Processing…" : "Boost now"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
