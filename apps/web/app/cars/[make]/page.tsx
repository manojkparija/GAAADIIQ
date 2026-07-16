import type { Metadata } from "next";
import Link from "next/link";
import { Car, ChevronLeft, ChevronRight } from "lucide-react";
import ListingCard from "@/components/listing-card";
import type { Listing } from "@/types/listing";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface PageProps {
  params: Promise<{ make: string }>;
}

function slugToMake(slug: string): string {
  // maruti-suzuki → Maruti Suzuki, bmw → BMW, mg-motor → MG Motor
  const special: Record<string, string> = {
    "maruti-suzuki": "Maruti Suzuki",
    "mg-motor": "MG Motor",
    "mercedes-benz": "Mercedes-Benz",
    bmw: "BMW",
  };
  return special[slug] ?? slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { make } = await params;
  const makeName = slugToMake(make);
  return {
    title: `${makeName} Cars for Sale | GAADIIQ`,
    description: `Browse ${makeName} cars listed on GAADIIQ — new and used ${makeName} vehicles across India.`,
  };
}

async function getListingsByMake(make: string): Promise<Listing[]> {
  try {
    const res = await fetch(
      `${API_URL}/listings?make=${encodeURIComponent(make)}&page_size=24`,
      { next: { revalidate: 60 } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.items ?? [];
  } catch {
    return [];
  }
}

export default async function MakeListingsPage({ params }: PageProps) {
  const { make } = await params;
  const makeName = slugToMake(make);
  const listings = await getListingsByMake(makeName);

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-10">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link href="/cars" className="hover:text-foreground transition-colors flex items-center gap-1">
            <ChevronLeft className="h-4 w-4" />
            All Brands
          </Link>
          <span>/</span>
          <span className="text-foreground font-medium">{makeName}</span>
        </nav>

        <div className="mb-8">
          <div className="flex items-center gap-4 mb-2">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <Car className="h-6 w-6 text-muted-foreground" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">{makeName} Cars</h1>
          </div>
          <p className="text-muted-foreground">
            {listings.length > 0
              ? `${listings.length} listing${listings.length !== 1 ? "s" : ""} found`
              : "No listings available right now"}
          </p>
        </div>

        {listings.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        ) : (
          <div className="text-center py-24 text-muted-foreground">
            <Car className="h-14 w-14 mx-auto mb-4 opacity-20" />
            <p className="text-lg mb-2">No {makeName} listings yet</p>
            <p className="text-sm mb-6">Be the first to list your {makeName} on GAADIIQ.</p>
            <Link
              href="/listings/new"
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-5 py-2.5 text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              List Your Car
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
