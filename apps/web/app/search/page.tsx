import { Suspense } from "react";
import SearchBar from "@/components/search-bar";
import ListingCard from "@/components/listing-card";
import { Listing, ListingListResponse } from "@/types/listing";

interface Props {
  searchParams: Promise<{ q?: string; page?: string }>;
}

async function searchListings(q: string, page: number): Promise<ListingListResponse> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  try {
    const res = await fetch(
      `${apiUrl}/search?q=${encodeURIComponent(q)}&page=${page}&page_size=20`,
      { cache: "no-store" }
    );
    if (!res.ok) return { items: [], total: 0, page, page_size: 20 };
    return res.json();
  } catch {
    return { items: [], total: 0, page, page_size: 20 };
  }
}

async function SearchResults({ q, page }: { q: string; page: number }) {
  const data = await searchListings(q, page);

  if (data.total === 0) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <p className="text-xl mb-2">No results for &ldquo;{q}&rdquo;</p>
        <p className="text-sm">Try a different make, model, or city.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-6">
        {data.total} result{data.total !== 1 ? "s" : ""} for &ldquo;{q}&rdquo;
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {data.items.map((listing: Listing) => (
          <ListingCard key={listing.id} listing={listing} />
        ))}
      </div>
    </div>
  );
}

export default async function SearchPage({ searchParams }: Props) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const page = Math.max(1, parseInt(params.page ?? "1") || 1);

  return (
    <main className="min-h-screen surface-royal">
      <section className="hero-navy border-b border-accent/20">
        <div className="max-w-2xl mx-auto px-4 py-12 md:py-16 text-center">
          <p className="text-accent text-[11px] font-semibold uppercase tracking-[0.24em] mb-3">Discover</p>
          <h1 className="text-3xl md:text-5xl font-display font-semibold text-primary-foreground mb-4">Search Cars</h1>
          <div className="gold-rule-lg mx-auto anim-rule mb-8" />
          <SearchBar initialQuery={q} className="w-full" variant="navy" />
        </div>
      </section>
      <div className="max-w-7xl mx-auto px-4 py-10">
        {q ? (
          <Suspense fallback={<p className="text-center text-muted-foreground font-light">Searching…</p>}>
            <SearchResults q={q} page={page} />
          </Suspense>
        ) : (
          <p className="text-center text-muted-foreground font-light">
            Type a make, model, or city above to search.
          </p>
        )}
      </div>
    </main>
  );
}
