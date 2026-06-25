import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getListing } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import ValuationButton from "@/components/valuation-button";
import EMICalculator from "@/components/emi-calculator";
import LoanInquiryForm from "@/components/loan-inquiry-form";
import PriceAlertButton from "@/components/price-alert-button";
import ReviewsSection from "@/components/reviews-section";
import ListingCard from "@/components/listing-card";
import { Listing } from "@/types/listing";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  try {
    const listing = await getListing(id);
    const { car } = listing;
    const title = `${car.year} ${car.make} ${car.model} for Sale in ${listing.city} | GAADIIQ`;
    const price = listing.price >= 100000
      ? `₹${(listing.price / 100000).toFixed(2)} Lakh`
      : `₹${listing.price.toLocaleString()}`;
    const description = `Buy ${car.year} ${car.make} ${car.model} (${car.fuel_type}, ${car.transmission}) in ${listing.city} for ${price}. ${listing.km_driven ? `${listing.km_driven.toLocaleString()} km driven. ` : ""}Find verified car listings on GAADIIQ.`;
    const image = listing.image_urls?.[0];
    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: "website",
        ...(image ? { images: [{ url: image, width: 1200, height: 630, alt: `${car.make} ${car.model}` }] } : {}),
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        ...(image ? { images: [image] } : {}),
      },
    };
  } catch {
    return { title: "Car Listing | GAADIIQ" };
  }
}

function formatPrice(price: number) {
  if (price >= 10_00_000) return `₹${(price / 10_00_000).toFixed(2)} Lakh`;
  if (price >= 1_000) return `₹${(price / 1_000).toFixed(0)},000`;
  return `₹${price}`;
}

const SPEC_ICONS: Record<string, string> = {
  fuel_type: "⛽",
  transmission: "⚙️",
  body_type: "🚗",
  seating_capacity: "💺",
  engine_cc: "🔧",
};

export default async function ListingDetailPage({ params }: PageProps) {
  const { id } = await params;

  let listing;
  try {
    listing = await getListing(id);
  } catch {
    notFound();
  }

  const { car } = listing;
  const specs = [
    { label: "Fuel", key: "fuel_type", value: car.fuel_type },
    { label: "Transmission", key: "transmission", value: car.transmission },
    { label: "Body", key: "body_type", value: car.body_type },
    { label: "Seats", key: "seating_capacity", value: car.seating_capacity?.toString() },
    { label: "Engine", key: "engine_cc", value: car.engine_cc ? `${car.engine_cc} cc` : null },
    { label: "KM Driven", key: "km_driven", value: listing.km_driven ? `${listing.km_driven.toLocaleString()} km` : null },
    { label: "Owners", key: "owners_count", value: listing.owners_count?.toString() },
    { label: "Reg. Year", key: "registration_year", value: listing.registration_year?.toString() },
    { label: "Reg. State", key: "registration_state", value: listing.registration_state },
    { label: "Condition", key: "condition", value: listing.condition },
  ].filter((s) => s.value);

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      {/* Back */}
      <Link href="/listings" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-6">
        ← Back to listings
      </Link>

      <div className="grid md:grid-cols-2 gap-8">
        {/* Left: Image gallery */}
        <div className="flex flex-col gap-3">
          <div className="relative rounded-xl overflow-hidden bg-muted h-64 md:h-80 flex items-center justify-center">
            {listing.image_urls[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={listing.image_urls[0]}
                alt={`${car.make} ${car.model}`}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-7xl">🚗</span>
            )}
            <Badge
              className="absolute top-3 left-3"
              variant={listing.listing_type === "new" ? "default" : "secondary"}
            >
              {listing.listing_type === "new" ? "New" : "Used"}
            </Badge>
            {listing.is_featured && (
              <Badge className="absolute top-3 right-3 bg-amber-500 hover:bg-amber-500">
                ⭐ Featured
              </Badge>
            )}
          </div>

          {/* Thumbnail strip */}
          {listing.image_urls.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {listing.image_urls.map((url, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={url}
                  alt={`Photo ${i + 1}`}
                  className="h-16 w-24 object-cover rounded-md border shrink-0"
                />
              ))}
            </div>
          )}

          {/* Specs grid */}
          <div className="rounded-xl border p-4 mt-2">
            <h3 className="font-semibold text-sm mb-3">Specifications</h3>
            <div className="grid grid-cols-2 gap-y-3 gap-x-4">
              {specs.map((s) => (
                <div key={s.key}>
                  <p className="text-xs text-muted-foreground">{SPEC_ICONS[s.key] ?? "•"} {s.label}</p>
                  <p className="text-sm font-medium capitalize">{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Details + CTA */}
        <div className="flex flex-col gap-5">
          {/* Title & price */}
          <div>
            <h1 className="text-2xl font-bold leading-tight">
              {car.year} {car.make} {car.model}
              {car.variant ? ` ${car.variant}` : ""}
            </h1>
            {listing.city && (
              <p className="text-muted-foreground text-sm mt-1">📍 {listing.city}</p>
            )}

            <div className="flex items-baseline gap-3 mt-4">
              <span className="text-3xl font-bold">{formatPrice(listing.price)}</span>
              {listing.negotiable && (
                <span className="text-sm text-green-600 font-medium">Negotiable</span>
              )}
            </div>

          </div>

          <Separator />

          {/* AI Valuation — interactive client component */}
          <ValuationButton listingId={listing.id} currentValuation={listing.ai_valuation} />

          {/* Description */}
          {listing.description && (
            <div>
              <h3 className="font-semibold text-sm mb-2">About this car</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{listing.description}</p>
            </div>
          )}

          {/* Seller info */}
          <div className="rounded-xl border p-4 bg-muted/30">
            <h3 className="font-semibold text-sm mb-2">Seller</h3>
            <p className="text-sm font-medium">{listing.seller.full_name ?? "Private Seller"}</p>
            <p className="text-xs text-muted-foreground capitalize">{listing.seller.role}</p>
          </div>

          {/* EMI Calculator */}
          <EMICalculator listingPrice={listing.price} />

          {/* Loan Inquiry */}
          <LoanInquiryForm listingId={listing.id} listingPrice={listing.price} />

          {/* Price drop alert */}
          <PriceAlertButton listingId={listing.id} />

          {/* Test drive CTA — links to bookings flow (Phase 12) */}
          <Button size="lg" className="w-full" asChild>
            <Link href={`/listings/${listing.id}/book`}>🚗 Book Test Drive</Link>
          </Button>

          {/* Meta */}
          <p className="text-xs text-muted-foreground text-center">
            {listing.views_count} views · Listed {new Date(listing.created_at).toLocaleDateString("en-IN")}
          </p>
        </div>
      </div>

      {/* Reviews */}
      <ReviewsSection listingId={listing.id} sellerId={listing.seller.id} />

      {/* Similar cars */}
      <SimilarListings listingId={id} />
    </main>
  );
}

async function SimilarListings({ listingId }: { listingId: string }) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  let similar: Listing[] = [];
  try {
    const res = await fetch(`${apiUrl}/listings/${listingId}/similar`, { cache: "no-store" });
    if (res.ok) similar = await res.json();
  } catch { /* silent */ }

  if (similar.length === 0) return null;

  return (
    <section className="mt-12 border-t pt-8">
      <h2 className="text-xl font-bold mb-6">Similar Cars</h2>
      <div className="flex gap-5 overflow-x-auto pb-3 snap-x snap-mandatory">
        {similar.map((l) => (
          <div key={l.id} className="shrink-0 w-72 snap-start">
            <ListingCard listing={l} />
          </div>
        ))}
      </div>
    </section>
  );
}
