import { auth } from "@/auth";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Listing } from "@/types/listing";
import DeleteListingButton from "./delete-button";
import BoostListingButton from "@/components/boost-listing-button";

interface MyListingsResponse {
  items: Listing[];
  total: number;
}

async function getMyListings(token: string): Promise<MyListingsResponse> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  try {
    const res = await fetch(`${apiUrl}/listings/me?page_size=50`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return { items: [], total: 0 };
    const data = await res.json();
    return data;
  } catch {
    return { items: [], total: 0 };
  }
}

function formatPrice(price: number) {
  if (price >= 10_00_000) return `₹${(price / 10_00_000).toFixed(2)}L`;
  return `₹${(price / 1000).toFixed(0)}K`;
}

export default async function MyListingsPage() {
  const session = await auth();
  const token = (session as { accessToken?: string })?.accessToken ?? "";
  const { items } = await getMyListings(token);
  const listings = items;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-display font-semibold">My Listings</h1>
        <Link href="/dashboard/listings/new" className={buttonVariants()}>
          + Add Listing
        </Link>
      </div>

      {listings.length === 0 ? (
        <div className="rounded-xl border p-12 text-center text-muted-foreground">
          <p className="text-lg mb-4">No listings yet.</p>
          <Link href="/dashboard/listings/new" className={buttonVariants()}>
            Create your first listing
          </Link>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Car</th>
                <th className="text-left px-4 py-3 font-medium">Price</th>
                <th className="text-left px-4 py-3 font-medium">City</th>
                <th className="text-left px-4 py-3 font-medium">Views</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {listings.map((listing) => (
                <tr key={listing.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium">
                      {listing.car.year} {listing.car.make} {listing.car.model}
                    </p>
                    <p className="text-muted-foreground text-xs capitalize">
                      {listing.listing_type} · {listing.km_driven?.toLocaleString()} km
                    </p>
                  </td>
                  <td className="px-4 py-3 font-semibold">{formatPrice(listing.price)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{listing.city ?? "—"}</td>
                  <td className="px-4 py-3">{listing.views_count}</td>
                  <td className="px-4 py-3">
                    <Badge variant={listing.is_active ? "default" : "secondary"}>
                      {listing.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 flex-wrap">
                      <Link
                        href={`/listings/${listing.id}`}
                        className={buttonVariants({ variant: "ghost", size: "sm" })}
                      >
                        View
                      </Link>
                      <BoostListingButton listingId={listing.id} isFeatured={listing.is_featured} />
                      <DeleteListingButton listingId={listing.id} token={token} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
