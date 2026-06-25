import { Suspense } from "react";
import { getListings } from "@/lib/api";
import ListingCard from "@/components/listing-card";
import ListingsFilter from "@/components/listings-filter";
import { Skeleton } from "@/components/ui/skeleton";
import type { ListingFilters } from "@/types/listing";

interface PageProps {
  searchParams: Promise<Record<string, string>>;
}

function ListingCardSkeleton() {
  return (
    <div className="rounded-xl border overflow-hidden">
      <Skeleton className="h-44 w-full" />
      <div className="p-4 flex flex-col gap-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <div className="flex gap-2 mt-1">
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
        <Skeleton className="h-6 w-24 mt-2" />
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
      <div className="col-span-full text-center py-16 text-muted-foreground">
        <p className="text-2xl mb-2">⚠️</p>
        <p>Could not load listings. Make sure the API server is running.</p>
      </div>
    );
  }

  if (data.items.length === 0) {
    return (
      <div className="col-span-full text-center py-16 text-muted-foreground">
        <p className="text-4xl mb-3">🔍</p>
        <p className="font-medium">No listings found</p>
        <p className="text-sm">Try adjusting your filters</p>
      </div>
    );
  }

  return (
    <>
      {data.items.map((listing) => (
        <ListingCard key={listing.id} listing={listing} />
      ))}
      {/* Pagination info */}
      <p className="col-span-full text-xs text-muted-foreground text-center pt-4">
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

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Explore Cars</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Find your perfect car — new or used, across India
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Filter sidebar — client component needs Suspense for useSearchParams */}
        <Suspense fallback={<div className="w-56 shrink-0" />}>
          <ListingsFilter />
        </Suspense>

        {/* Listings grid */}
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 content-start">
          <Suspense
            fallback={Array.from({ length: 6 }).map((_, i) => (
              <ListingCardSkeleton key={i} />
            ))}
          >
            <ListingsGrid filters={filters} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
