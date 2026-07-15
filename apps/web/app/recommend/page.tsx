"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Car, ChevronRight, RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import type { Listing } from "@/types/listing";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Step = "budget" | "fuel" | "body" | "usage" | "results";

interface Answers {
  budget?: string;
  fuel?: string;
  body?: string;
  usage?: string;
}

const BUDGET_OPTIONS = [
  { label: "Under ₹5 L", value: "under_5l", max: 500000 },
  { label: "₹5 L – ₹10 L", value: "5l_10l", max: 1000000, min: 500000 },
  { label: "₹10 L – ₹20 L", value: "10l_20l", max: 2000000, min: 1000000 },
  { label: "₹20 L – ₹50 L", value: "20l_50l", max: 5000000, min: 2000000 },
  { label: "Above ₹50 L", value: "above_50l", min: 5000000 },
];

const FUEL_OPTIONS = [
  { label: "Petrol", value: "petrol", icon: "⛽" },
  { label: "Diesel", value: "diesel", icon: "🛢️" },
  { label: "Electric", value: "electric", icon: "⚡" },
  { label: "Hybrid", value: "hybrid", icon: "🌿" },
  { label: "Any", value: "any", icon: "🔄" },
];

const BODY_OPTIONS = [
  { label: "Hatchback", value: "hatchback", icon: "🚗" },
  { label: "Sedan", value: "sedan", icon: "🚙" },
  { label: "SUV", value: "suv", icon: "🚐" },
  { label: "MPV", value: "mpv", icon: "🚌" },
  { label: "Any", value: "any", icon: "🔄" },
];

const USAGE_OPTIONS = [
  { label: "Daily city commute", value: "city" },
  { label: "Long highway trips", value: "highway" },
  { label: "Family car", value: "family" },
  { label: "First car / budget", value: "first" },
  { label: "Luxury / performance", value: "luxury" },
];

function formatPrice(p: number) {
  if (p >= 1_00_00_000) return `₹${(p / 1_00_00_000).toFixed(2)} Cr`;
  if (p >= 1_00_000) return `₹${(p / 1_00_000).toFixed(1)} L`;
  return `₹${p.toLocaleString("en-IN")}`;
}

async function fetchRecommendations(answers: Answers): Promise<Listing[]> {
  const budget = BUDGET_OPTIONS.find((b) => b.value === answers.budget);
  const params = new URLSearchParams({ page_size: "6" });
  if (budget?.max) params.set("max_price", String(budget.max));
  if (budget?.min) params.set("min_price", String(budget.min));
  if (answers.fuel && answers.fuel !== "any") params.set("fuel_type", answers.fuel);
  if (answers.body && answers.body !== "any") params.set("body_type", answers.body);

  try {
    const res = await fetch(`${API_URL}/listings?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return data.items ?? [];
  } catch {
    return [];
  }
}

interface OptionButtonProps {
  label: string;
  icon?: string;
  selected: boolean;
  onClick: () => void;
}

function OptionButton({ label, icon, selected, onClick }: OptionButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 px-5 py-4 rounded-xl border-2 text-left transition-all w-full
        ${selected
          ? "border-primary bg-primary/5 text-primary font-medium"
          : "border-border hover:border-primary/50 hover:bg-muted/40"
        }`}
    >
      {icon && <span className="text-xl">{icon}</span>}
      <span>{label}</span>
      {selected && <ChevronRight className="ml-auto h-4 w-4" />}
    </button>
  );
}

export default function RecommendPage() {
  const [step, setStep] = useState<Step>("budget");
  const [answers, setAnswers] = useState<Answers>({});
  const [results, setResults] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(false);

  const steps: Step[] = ["budget", "fuel", "body", "usage", "results"];
  const currentIndex = steps.indexOf(step);
  const progress = ((currentIndex) / (steps.length - 1)) * 100;

  async function goToResults(finalAnswers: Answers) {
    setLoading(true);
    setStep("results");
    const listings = await fetchRecommendations(finalAnswers);
    setResults(listings);
    setLoading(false);
  }

  function restart() {
    setAnswers({});
    setResults([]);
    setStep("budget");
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-muted/30 to-background">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary rounded-full px-4 py-1.5 text-sm font-medium mb-4">
            <Sparkles className="h-4 w-4" />
            AI Car Advisor
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Find Your Perfect Car</h1>
          <p className="text-muted-foreground mt-2">
            Answer a few questions and we&apos;ll recommend the best cars for you.
          </p>
        </div>

        {step !== "results" && (
          <div className="mb-8">
            <div className="flex justify-between text-xs text-muted-foreground mb-2">
              <span>Step {currentIndex + 1} of {steps.length - 1}</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        <div className="bg-card rounded-2xl border shadow-sm p-6">
          {step === "budget" && (
            <div>
              <h2 className="text-xl font-semibold mb-1">What&apos;s your budget?</h2>
              <p className="text-muted-foreground text-sm mb-6">Include registration and insurance costs.</p>
              <div className="flex flex-col gap-3">
                {BUDGET_OPTIONS.map((opt) => (
                  <OptionButton
                    key={opt.value}
                    label={opt.label}
                    selected={answers.budget === opt.value}
                    onClick={() => {
                      const next = { ...answers, budget: opt.value };
                      setAnswers(next);
                      setTimeout(() => setStep("fuel"), 200);
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {step === "fuel" && (
            <div>
              <h2 className="text-xl font-semibold mb-1">Preferred fuel type?</h2>
              <p className="text-muted-foreground text-sm mb-6">Electric saves running costs; diesel suits highway.</p>
              <div className="flex flex-col gap-3">
                {FUEL_OPTIONS.map((opt) => (
                  <OptionButton
                    key={opt.value}
                    label={opt.label}
                    icon={opt.icon}
                    selected={answers.fuel === opt.value}
                    onClick={() => {
                      const next = { ...answers, fuel: opt.value };
                      setAnswers(next);
                      setTimeout(() => setStep("body"), 200);
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {step === "body" && (
            <div>
              <h2 className="text-xl font-semibold mb-1">Body type preference?</h2>
              <p className="text-muted-foreground text-sm mb-6">SUVs offer more space; hatchbacks are city-friendly.</p>
              <div className="flex flex-col gap-3">
                {BODY_OPTIONS.map((opt) => (
                  <OptionButton
                    key={opt.value}
                    label={opt.label}
                    icon={opt.icon}
                    selected={answers.body === opt.value}
                    onClick={() => {
                      const next = { ...answers, body: opt.value };
                      setAnswers(next);
                      setTimeout(() => setStep("usage"), 200);
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {step === "usage" && (
            <div>
              <h2 className="text-xl font-semibold mb-1">Primarily used for?</h2>
              <p className="text-muted-foreground text-sm mb-6">This helps us prioritise the right features.</p>
              <div className="flex flex-col gap-3">
                {USAGE_OPTIONS.map((opt) => (
                  <OptionButton
                    key={opt.value}
                    label={opt.label}
                    selected={answers.usage === opt.value}
                    onClick={() => {
                      const next = { ...answers, usage: opt.value };
                      setAnswers(next);
                      goToResults(next);
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {step === "results" && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">Your Recommendations</h2>
                <Button variant="outline" size="sm" onClick={restart} className="gap-1.5">
                  <RotateCcw className="h-3.5 w-3.5" />
                  Start over
                </Button>
              </div>

              {loading ? (
                <div className="flex flex-col items-center py-12 gap-3 text-muted-foreground">
                  <Sparkles className="h-8 w-8 animate-pulse" />
                  <p>Finding your perfect matches…</p>
                </div>
              ) : results.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Car className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="mb-4">No exact matches — try broadening your criteria.</p>
                  <Button variant="outline" onClick={restart}>Adjust Preferences</Button>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {results.map((listing) => (
                    <Link
                      key={listing.id}
                      href={`/listings/${listing.id}`}
                      className="flex items-center gap-4 p-4 rounded-xl border hover:border-primary/50 hover:bg-muted/30 transition-colors group"
                    >
                      <div className="h-16 w-20 bg-muted rounded-lg flex items-center justify-center shrink-0">
                        <Car className="h-8 w-8 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">
                          {listing.car?.make} {listing.car?.model} ({listing.car?.year})
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {listing.car?.fuel_type && <Badge variant="secondary" className="text-xs">{listing.car.fuel_type}</Badge>}
                          {listing.car?.body_type && <Badge variant="outline" className="text-xs">{listing.car.body_type}</Badge>}
                          {listing.city && <Badge variant="outline" className="text-xs">{listing.city}</Badge>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold text-primary">{formatPrice(listing.price)}</p>
                        {listing.km_driven != null && (
                          <p className="text-xs text-muted-foreground">{listing.km_driven.toLocaleString("en-IN")} km</p>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                    </Link>
                  ))}
                  <div className="pt-2 text-center">
                    <Link href="/listings">
                      <Button variant="outline" className="gap-2">
                        Browse all listings
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
