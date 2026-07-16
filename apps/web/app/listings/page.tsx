import type { Metadata } from "next";
import { Suspense } from "react";
import { AlertTriangle, Search } from "lucide-react";
import { getListings } from "@/lib/api";
import ListingCard from "@/components/listing-card";
import ListingsFilter from "@/components/listings-filter";
import { Skeleton } from "@/components/ui/skeleton";
import type { ListingFilters } from "@/types/listing";

export const metadata: Metadata = {
  title: "Browse Used & New Cars for Sale | GAADIIQ",
  description: "Find verified used and new car listings across India. Filter by brand, model, fuel type, price, and city on GAADIIQ — India's AI-first automotive platform.",
  openGraph: {
    title: "Browse Cars for Sale | GAADIIQ",
    description: "Find verified used and new car listings across India on GAADIIQ.",
    type: "website",
  },
};

interface PageProps {
  searchParams: Promise<Record<string, string>>;
}

function ListingCardSkeleton() {
  return (
    <div className="rounded-sm border overflow-hidden bg-card">
      <Skeleton className="h-48 w-full" />
      <div className="p-4 flex flex-col gap-3">
        <Skeleton className="h-4 w-3/4" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-16 rounded-sm" />
          <Skeleton className="h-5 w-16 rounded-sm" />
        </div>
        <div className="flex justify-between items-center pt-2 border-t">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
      </div>
    </div>
  );
}

async function ListingsGrid({ filters }: { filters: ListingFilters }) {
  let data;
  try {
    data = await getListings(filters);
  } catch {
    return (
      <div className="col-span-full py-16 text-center">
        <div className="max-w-sm mx-auto">
          <AlertTriangle className="h-10 w-10 mx-auto mb-4 text-accent" aria-hidden />
          <h3 className="font-display font-semibold text-lg mb-2">Could not load listings</h3>
          <p className="text-muted-foreground text-sm">
            The API server may be starting up. Please refresh in a moment.
          </p>
        </div>
      </div>
    );
  }

  if (data.items.length === 0) {
    return (
      <div className="col-span-full py-16 text-center">
        <div className="max-w-sm mx-auto">
          <Search className="h-12 w-12 mx-auto mb-4 text-accent" aria-hidden />
          <h3 className="font-display font-semibold text-lg mb-2">No listings found</h3>
          <p className="text-muted-foreground text-sm mb-4">
            Try adjusting or clearing your filters to see more results.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {data.items.map((listing) => (
        <ListingCard key={listing.id} listing={listing} />
      ))}
      <p className="col-span-full text-xs text-muted-foreground text-center pt-6 pb-2">
        Showing {data.items.length} of {data.total} listings
      </p>
    </>
  );
}

export default async function ListingsPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const filters: ListingFilters = {
    listing_type: (sp.listing_type as ListingFilters["listing_type"]) || undefined,
    city: sp.city || undefined,
    make: sp.make || undefined,
    model: sp.model || undefined,
    fuel_type: (sp.fuel_type as ListingFilters["fuel_type"]) || undefined,
    body_type: (sp.body_type as ListingFilters["body_type"]) || undefined,
    min_price: sp.min_price ? Number(sp.min_price) : undefined,
    max_price: sp.max_price ? Number(sp.max_price) : undefined,
    min_year: sp.min_year ? Number(sp.min_year) : undefined,
    max_year: sp.max_year ? Number(sp.max_year) : undefined,
    max_km: sp.max_km ? Number(sp.max_km) : undefined,
    page: sp.page ? Number(sp.page) : 1,
    page_size: 20,
  };

  const activeFilterCount = [
    sp.listing_type, sp.city, sp.make, sp.model,
    sp.fuel_type, sp.body_type, sp.min_price, sp.max_price,
  ].filter(Boolean).length;

  return (
    <main className="min-h-screen bg-surface-alt">
      {/* Page header */}
      <div className="bg-card border-b">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold">
            {sp.listing_type === "new" ? "New Cars" :
             sp.listing_type === "used" ? "Used Cars" :
             sp.make ? `${sp.make} Cars` :
             sp.fuel_type === "electric" ? "Electric Cars" :
             "Explore All Cars"}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Find your perfect car — verified listings across India
            {activeFilterCount > 0 && ` · ${activeFilterCount} filter${activeFilterCount > 1 ? "s" : ""} applied`}
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row gap-6">
          {/* Filter sidebar */}
          <Suspense fallback={<div className="w-56 shrink-0 h-96 animate-pulse bg-white rounded-2xl" />}>
            <ListingsFilter />
          </Suspense>

          {/* Listings grid */}
          <div className="flex-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 content-start">
              <Suspense
                fallback={Array.from({ length: 6 }).map((_, i) => (
                  <ListingCardSkeleton key={i} />
                ))}
              >
                <ListingsGrid filters={filters} />
              </Suspense>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
