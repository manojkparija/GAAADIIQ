"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Car, CarFront, Truck, Users, ChevronRight, RotateCcw, Sparkles,
  Fuel, Droplets, Zap, Leaf, ArrowRightLeft,
} from "lucide-react";
import Link from "next/link";
import ToolPageHeader from "@/components/tool-page-header";
import type { Listing } from "@/types/listing";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Step = "budget" | "fuel" | "body" | "usage" | "results";

interface Answers {
  budget?: string;
  fuel?: string;
  body?: string;
  usage?: string;
}

interface RecommendedListing {
  listing: Listing;
  match_score: number;
  reasons: string[];
}

const BUDGET_OPTIONS = [
  { label: "Under ₹5 L",      value: "under_5l" },
  { label: "₹5 L – ₹10 L",   value: "5l_10l" },
  { label: "₹10 L – ₹20 L",  value: "10l_20l" },
  { label: "₹20 L – ₹50 L",  value: "20l_50l" },
  { label: "Above ₹50 L",     value: "above_50l" },
];

const FUEL_OPTIONS = [
  { label: "Petrol",   value: "petrol",   Icon: Fuel },
  { label: "Diesel",   value: "diesel",   Icon: Droplets },
  { label: "Electric", value: "electric", Icon: Zap },
  { label: "Hybrid",   value: "hybrid",   Icon: Leaf },
  { label: "Any",      value: "any",      Icon: ArrowRightLeft },
];

const BODY_OPTIONS = [
  { label: "Hatchback", value: "hatchback", Icon: Car },
  { label: "Sedan",     value: "sedan",     Icon: CarFront },
  { label: "SUV",       value: "suv",       Icon: Truck },
  { label: "MPV",       value: "mpv",       Icon: Users },
  { label: "Any",       value: "any",       Icon: ArrowRightLeft },
];

const USAGE_OPTIONS = [
  { label: "Daily city commute",   value: "city" },
  { label: "Long highway trips",   value: "highway" },
  { label: "Family car",           value: "family" },
  { label: "First car / budget",   value: "first" },
  { label: "Luxury / performance", value: "luxury" },
];

function formatPrice(p: number) {
  if (p >= 1_00_00_000) return `₹${(p / 1_00_00_000).toFixed(2)} Cr`;
  if (p >= 1_00_000) return `₹${(p / 1_00_000).toFixed(1)} L`;
  return `₹${p.toLocaleString("en-IN")}`;
}

async function fetchRecommendations(answers: Answers): Promise<RecommendedListing[]> {
  try {
    const res = await fetch(`${API_URL}/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        budget: answers.budget,
        fuel: answers.fuel,
        body: answers.body,
        usage: answers.usage,
        page_size: 6,
      }),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.items ?? [];
  } catch {
    return [];
  }
}

function MatchScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? "bg-accent/15 text-accent border-accent/30" :
    score >= 50 ? "bg-primary/10 text-primary border-primary/20" :
    "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${color}`}>
      {score}% match
    </span>
  );
}

interface OptionButtonProps {
  label: string;
  Icon?: React.ComponentType<{ className?: string }>;
  selected: boolean;
  onClick: () => void;
}

function OptionButton({ label, Icon, selected, onClick }: OptionButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 px-5 py-4 rounded-xl border-2 text-left transition-all w-full
        ${selected
          ? "border-accent bg-accent/5 text-accent font-medium"
          : "border-border hover:border-accent/50 hover:bg-muted/40"
        }`}
    >
      {Icon && <Icon className="h-5 w-5 shrink-0" />}
      <span>{label}</span>
      {selected && <ChevronRight className="ml-auto h-4 w-4" />}
    </button>
  );
}

export default function RecommendPage() {
  const [step, setStep] = useState<Step>("budget");
  const [answers, setAnswers] = useState<Answers>({});
  const [results, setResults] = useState<RecommendedListing[]>([]);
  const [loading, setLoading] = useState(false);

  const steps: Step[] = ["budget", "fuel", "body", "usage", "results"];
  const currentIndex = steps.indexOf(step);
  const progress = (currentIndex / (steps.length - 1)) * 100;

  async function goToResults(finalAnswers: Answers) {
    setLoading(true);
    setStep("results");
    const items = await fetchRecommendations(finalAnswers);
    setResults(items);
    setLoading(false);
  }

  function restart() {
    setAnswers({});
    setResults([]);
    setStep("budget");
  }

  return (
    <main className="min-h-screen bg-background">
      <ToolPageHeader
        eyebrow="Personalised Picks"
        title="Car Advisor"
        subtitle="Find Your Perfect Car — answer four quick questions and we'll surface the best-matched listings for your needs and budget."
        icon={<Sparkles className="h-6 w-6 text-accent" />}
      />

      <div className="max-w-2xl mx-auto px-4 py-10">
        {step !== "results" && (
          <div className="mb-8">
            <div className="flex justify-between text-xs text-muted-foreground mb-2">
              <span>Step {currentIndex + 1} of {steps.length - 1}</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        <div className="bg-card rounded-sm border panel-royal p-6 anim-fade-up">
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
                    onClick={() => { const next = { ...answers, budget: opt.value }; setAnswers(next); setTimeout(() => setStep("fuel"), 200); }}
                  />
                ))}
              </div>
            </div>
          )}

          {step === "fuel" && (
            <div>
              <h2 className="text-xl font-semibold mb-1">Preferred fuel type?</h2>
              <p className="text-muted-foreground text-sm mb-6">Electric saves running costs; diesel suits highway driving.</p>
              <div className="flex flex-col gap-3">
                {FUEL_OPTIONS.map((opt) => (
                  <OptionButton
                    key={opt.value}
                    label={opt.label}
                    Icon={opt.Icon}
                    selected={answers.fuel === opt.value}
                    onClick={() => { const next = { ...answers, fuel: opt.value }; setAnswers(next); setTimeout(() => setStep("body"), 200); }}
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
                    Icon={opt.Icon}
                    selected={answers.body === opt.value}
                    onClick={() => { const next = { ...answers, body: opt.value }; setAnswers(next); setTimeout(() => setStep("usage"), 200); }}
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
                    onClick={() => { const next = { ...answers, usage: opt.value }; setAnswers(next); goToResults(next); }}
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
                  <p>Finding your best matches…</p>
                </div>
              ) : results.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Car className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="mb-4">No matches found — try broadening your criteria.</p>
                  <Button variant="outline" onClick={restart}>Adjust Preferences</Button>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {results.map(({ listing, match_score, reasons }) => (
                    <Link
                      key={listing.id}
                      href={`/listings/${listing.id}`}
                      className="flex items-start gap-4 p-4 rounded-xl border hover:border-primary/50 hover:bg-muted/30 transition-colors group"
                    >
                      <div className="h-16 w-20 bg-muted rounded-lg flex items-center justify-center shrink-0">
                        <Car className="h-8 w-8 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-sm truncate">
                            {listing.car?.make} {listing.car?.model} ({listing.car?.year})
                          </p>
                          <MatchScoreBadge score={match_score} />
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {listing.car?.fuel_type && <Badge variant="secondary" className="text-xs">{listing.car.fuel_type}</Badge>}
                          {listing.car?.body_type && <Badge variant="outline" className="text-xs">{listing.car.body_type}</Badge>}
                          {listing.city && <Badge variant="outline" className="text-xs">{listing.city}</Badge>}
                        </div>
                        {reasons.length > 0 && (
                          <p className="text-xs text-muted-foreground mt-1.5 truncate">
                            {reasons[0]}{reasons.length > 1 ? ` · ${reasons[1]}` : ""}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-display font-semibold text-primary">{formatPrice(listing.price)}</p>
                        {listing.km_driven != null && (
                          <p className="text-xs text-muted-foreground">{listing.km_driven.toLocaleString("en-IN")} km</p>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0 mt-1" />
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
