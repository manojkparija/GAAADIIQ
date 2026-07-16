"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Star, CheckCircle } from "lucide-react";
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
  { days: 7,  label: "7 days",  price: "₹499" },
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
          Authorization: `Bearer ${(session as { access_token?: string })?.access_token}`,
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to boost listing");
    } finally {
      setLoading(false);
    }
  }

  if (isFeatured) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-accent bg-accent/10 border border-accent/30 px-2 py-1 rounded-full">
        <Star className="h-3 w-3 fill-current" />
        Featured
      </span>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex items-center gap-1.5 text-sm font-medium border border-accent/40 text-accent hover:bg-accent/10 rounded-md px-3 h-8 transition-colors">
        <Star className="h-3.5 w-3.5" />
        Boost
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
            <CheckCircle className="h-12 w-12 text-success mx-auto mb-3" />
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
                      ? "border-accent bg-accent/10 text-accent-foreground font-medium"
                      : "border-border hover:border-accent/30"
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
              <Button
                onClick={handleBoost}
                disabled={loading}
                className="bg-accent text-accent-foreground hover:bg-accent/90"
              >
                {loading ? "Processing…" : "Boost now"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
