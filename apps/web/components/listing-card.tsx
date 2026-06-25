import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { Listing } from "@/types/listing";

function formatPrice(price: number) {
  if (price >= 10_00_000) return `₹${(price / 10_00_000).toFixed(1)}L`;
  if (price >= 1_000) return `₹${(price / 1_000).toFixed(0)}K`;
  return `₹${price}`;
}

function formatKm(km: number) {
  return km >= 1000 ? `${(km / 1000).toFixed(0)}K km` : `${km} km`;
}

export default function ListingCard({ listing }: { listing: Listing }) {
  const { car } = listing;
  const thumb = listing.image_urls[0];

  return (
    <Link href={`/listings/${listing.id}`}>
      <Card className="overflow-hidden hover:shadow-md transition-shadow h-full flex flex-col">
        {/* Thumbnail */}
        <div className="relative bg-muted h-44 flex items-center justify-center overflow-hidden">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt={`${car.make} ${car.model}`} className="w-full h-full object-cover" />
          ) : (
            <span className="text-5xl">🚗</span>
          )}
          {listing.is_featured && (
            <Badge className="absolute top-2 left-2 bg-amber-500 hover:bg-amber-500">Featured</Badge>
          )}
          <Badge
            variant={listing.listing_type === "new" ? "default" : "secondary"}
            className="absolute top-2 right-2"
          >
            {listing.listing_type === "new" ? "New" : "Used"}
          </Badge>
        </div>

        <CardContent className="p-4 flex flex-col gap-2 flex-1">
          {/* Title */}
          <div>
            <h3 className="font-semibold text-base leading-tight">
              {car.year} {car.make} {car.model}
              {car.variant ? ` ${car.variant}` : ""}
            </h3>
            {listing.city && (
              <p className="text-xs text-muted-foreground mt-0.5">{listing.city}</p>
            )}
          </div>

          {/* Specs pills */}
          <div className="flex flex-wrap gap-1.5">
            {car.fuel_type && (
              <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full capitalize">
                {car.fuel_type}
              </span>
            )}
            {car.transmission && (
              <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full capitalize">
                {car.transmission}
              </span>
            )}
            {listing.km_driven != null && (
              <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">
                {formatKm(listing.km_driven)}
              </span>
            )}
            {listing.owners_count != null && listing.owners_count > 0 && (
              <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">
                {listing.owners_count} owner{listing.owners_count > 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Price row */}
          <div className="mt-auto flex items-end justify-between pt-2 border-t">
            <div>
              <p className="text-lg font-bold">{formatPrice(listing.price)}</p>
              {listing.ai_valuation && (
                <p className="text-xs text-muted-foreground">
                  AI val: {formatPrice(listing.ai_valuation)}
                </p>
              )}
            </div>
            {listing.negotiable && (
              <span className="text-xs text-green-600 font-medium">Negotiable</span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
