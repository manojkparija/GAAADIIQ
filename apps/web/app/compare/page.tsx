"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { X, Plus, Car, Fuel, Settings, Calendar, MapPin, Users } from "lucide-react";
import type { Listing } from "@/types/listing";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const MAX_COMPARE = 3;

interface CompareSlot {
  listing: Listing | null;
  loading: boolean;
  error: string | null;
}

function emptySlot(): CompareSlot {
  return { listing: null, loading: false, error: null };
}

function formatPrice(p: number) {
  if (p >= 1_00_00_000) return `₹${(p / 1_00_00_000).toFixed(2)} Cr`;
  if (p >= 1_00_000) return `₹${(p / 1_00_000).toFixed(1)} L`;
  return `₹${p.toLocaleString("en-IN")}`;
}

function formatKm(k: number) {
  return `${k.toLocaleString("en-IN")} km`;
}

interface SearchResult {
  id: string;
  label: string;
  listing: Listing;
}

async function searchListings(query: string): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  try {
    const res = await fetch(
      `${API_URL}/search?q=${encodeURIComponent(query)}&page_size=8`,
      { cache: "no-store" }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items ?? []).map((l: Listing) => ({
      id: l.id,
      label: `${l.car?.make} ${l.car?.model} (${l.car?.year}) – ${l.city}`,
      listing: l,
    }));
  } catch {
    return [];
  }
}

function SpecRow({ label, values }: { label: string; values: (string | number | null | undefined)[] }) {
  const allSame = values.every((v) => v === values[0]);
  return (
    <tr className="border-b last:border-0">
      <td className="py-3 px-4 text-sm font-medium text-muted-foreground w-36 shrink-0">{label}</td>
      {values.map((v, i) => (
        <td
          key={i}
          className={`py-3 px-4 text-sm text-center ${
            !allSame && v != null ? "font-semibold text-emerald-600" : ""
          }`}
        >
          {v ?? <span className="text-muted-foreground/50">—</span>}
        </td>
      ))}
      {Array.from({ length: MAX_COMPARE - values.length }).map((_, i) => (
        <td key={`empty-${i}`} className="py-3 px-4" />
      ))}
    </tr>
  );
}

function AddSlot({ onAdd }: { onAdd: (listing: Listing) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = useCallback(async (q: string) => {
    setQuery(q);
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    const r = await searchListings(q);
    setResults(r);
    setSearching(false);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center gap-4 min-h-48 bg-muted/30 rounded-xl border-2 border-dashed p-6">
      <Plus className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Add a car to compare</p>
      <div className="w-full relative">
        <Input
          placeholder="Search make, model, city…"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          className="w-full"
        />
        {(results.length > 0 || searching) && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-lg shadow-lg z-10 max-h-56 overflow-y-auto">
            {searching && <div className="px-4 py-3 text-sm text-muted-foreground">Searching…</div>}
            {results.map((r) => (
              <button
                key={r.id}
                className="w-full text-left px-4 py-3 text-sm hover:bg-muted transition-colors border-b last:border-0"
                onClick={() => { onAdd(r.listing); setQuery(""); setResults([]); }}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ComparePage() {
  const [slots, setSlots] = useState<CompareSlot[]>([emptySlot()]);

  const addListing = (listing: Listing) => {
    setSlots((prev) => {
      const existing = prev.findIndex((s) => s.listing?.id === listing.id);
      if (existing >= 0) return prev;
      const empty = prev.findIndex((s) => s.listing === null);
      if (empty >= 0) {
        const next = [...prev];
        next[empty] = { listing, loading: false, error: null };
        return next;
      }
      if (prev.length < MAX_COMPARE) {
        return [...prev, { listing, loading: false, error: null }];
      }
      return prev;
    });
  };

  const removeListing = (index: number) => {
    setSlots((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length === 0 ? [emptySlot()] : next;
    });
  };

  const addSlot = () => {
    if (slots.length < MAX_COMPARE) setSlots((prev) => [...prev, emptySlot()]);
  };

  const filledSlots = slots.filter((s) => s.listing !== null);

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Compare Cars</h1>
          <p className="text-muted-foreground mt-1">
            Compare up to {MAX_COMPARE} cars side by side to make the right choice.
          </p>
        </div>

        {/* Car selector columns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
          {slots.map((slot, i) => (
            <div key={i}>
              {slot.listing ? (
                <div className="rounded-xl border bg-card p-4 relative">
                  <button
                    onClick={() => removeListing(i)}
                    className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
                    aria-label="Remove car"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <div className="flex flex-col gap-2">
                    <div className="h-32 bg-muted rounded-lg flex items-center justify-center">
                      <Car className="h-12 w-12 text-muted-foreground" />
                    </div>
                    <h3 className="font-semibold text-base mt-1">
                      {slot.listing.car?.make} {slot.listing.car?.model}
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="secondary">{slot.listing.car?.year}</Badge>
                      <Badge variant="outline">{slot.listing.car?.fuel_type}</Badge>
                      <Badge variant="outline">{slot.listing.listing_type}</Badge>
                    </div>
                    <p className="text-lg font-bold text-primary">
                      {formatPrice(slot.listing.price)}
                    </p>
                  </div>
                </div>
              ) : (
                <AddSlot onAdd={addListing} />
              )}
            </div>
          ))}

          {slots.length < MAX_COMPARE && (
            <button
              onClick={addSlot}
              className="hidden lg:flex flex-col items-center justify-center gap-2 min-h-48 rounded-xl border-2 border-dashed text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              <Plus className="h-6 w-6" />
              <span className="text-sm">Add another car</span>
            </button>
          )}
        </div>

        {/* Comparison table */}
        {filledSlots.length >= 2 && (
          <div className="rounded-xl border overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-36">
                    Spec
                  </th>
                  {filledSlots.map((s, i) => (
                    <th key={i} className="py-3 px-4 text-center text-sm font-semibold">
                      {s.listing!.car?.make} {s.listing!.car?.model}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <SpecRow
                  label="Price"
                  values={filledSlots.map((s) => formatPrice(s.listing!.price))}
                />
                <SpecRow
                  label="Year"
                  values={filledSlots.map((s) => s.listing!.car?.year)}
                />
                <SpecRow
                  label="KM Driven"
                  values={filledSlots.map((s) =>
                    s.listing!.km_driven != null ? formatKm(s.listing!.km_driven) : null
                  )}
                />
                <SpecRow
                  label="Fuel Type"
                  values={filledSlots.map((s) => s.listing!.car?.fuel_type)}
                />
                <SpecRow
                  label="Transmission"
                  values={filledSlots.map((s) => s.listing!.car?.transmission)}
                />
                <SpecRow
                  label="Body Type"
                  values={filledSlots.map((s) => s.listing!.car?.body_type)}
                />
                <SpecRow
                  label="Owners"
                  values={filledSlots.map((s) =>
                    s.listing!.owners_count != null
                      ? `${s.listing!.owners_count} owner${s.listing!.owners_count !== 1 ? "s" : ""}`
                      : null
                  )}
                />
                <SpecRow
                  label="Condition"
                  values={filledSlots.map((s) => s.listing!.condition)}
                />
                <SpecRow
                  label="City"
                  values={filledSlots.map((s) => s.listing!.city)}
                />
                <SpecRow
                  label="AI Valuation"
                  values={filledSlots.map((s) =>
                    s.listing!.ai_valuation != null
                      ? formatPrice(s.listing!.ai_valuation)
                      : "Not valued"
                  )}
                />
              </tbody>
            </table>
          </div>
        )}

        {filledSlots.length < 2 && (
          <div className="text-center py-16 text-muted-foreground">
            <Car className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Add at least 2 cars to see a comparison.</p>
          </div>
        )}
      </div>
    </main>
  );
}
