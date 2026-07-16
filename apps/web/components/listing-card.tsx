import Link from "next/link";
import type { Listing } from "@/types/listing";

function formatPrice(price: number) {
  if (price >= 10_00_000) return `₹${(price / 10_00_000).toFixed(1)} L`;
  if (price >= 1_000) return `₹${(price / 1_000).toFixed(0)}K`;
  return `₹${price}`;
}

function CarPlaceholder({ make }: { make: string }) {
  return (
    <div className="w-full h-full bg-primary/5 flex flex-col items-center justify-center gap-2">
      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center font-display font-semibold text-lg text-primary/40">
        {make.charAt(0).toUpperCase()}
      </div>
      <p className="text-muted-foreground/50 text-xs">{make}</p>
    </div>
  );
}

export default function ListingCard({ listing }: { listing: Listing }) {
  const { car } = listing;
  const thumb = listing.image_urls[0];

  return (
    <Link href={`/listings/${listing.id}`} className="group block">
      <div className="rounded-sm bg-card border border-border overflow-hidden card-hover h-full flex flex-col">
        {/* Image */}
        <div className="relative bg-surface-alt h-44 overflow-hidden">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumb}
              alt={`${car.make} ${car.model}`}
              className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-400"
            />
          ) : (
            <CarPlaceholder make={car.make} />
          )}

          {/* Featured badge — gold */}
          {listing.is_featured && (
            <span className="absolute top-2 left-2 bg-accent text-accent-foreground text-[10px] font-semibold px-2 py-0.5 rounded-sm tracking-wide">
              Featured
            </span>
          )}

          {/* New / Used */}
          <span className={`absolute top-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded-sm tracking-wide
            ${listing.listing_type === "new"
              ? "bg-primary text-primary-foreground"
              : "bg-card/90 text-muted-foreground border border-border"
            }`}
          >
            {listing.listing_type === "new" ? "New" : "Used"}
          </span>
        </div>

        {/* Content */}
        <div className="p-4 flex flex-col gap-1.5 flex-1">
          <h3 className="font-display font-semibold text-sm text-foreground leading-snug group-hover:text-accent transition-colors">
            {car.year} {car.make} {car.model}
            {car.variant ? ` ${car.variant}` : ""}
          </h3>

          {/* Subtle meta */}
          <p className="text-[11px] text-muted-foreground">
            {[
              car.fuel_type,
              listing.km_driven ? `${(listing.km_driven / 1000).toFixed(0)}K km` : null,
              listing.city,
            ].filter(Boolean).join(" · ")}
          </p>

          {/* Price row */}
          <div className="mt-auto pt-3 flex items-end justify-between border-t border-border">
            <div>
              <p className="text-lg font-display font-semibold text-foreground">{formatPrice(listing.price)}</p>
              {listing.negotiable && (
                <p className="text-[10px] text-accent font-medium tracking-wide">Negotiable</p>
              )}
            </div>
            <span className="text-[11px] font-medium text-accent border border-accent/40 px-2.5 py-1 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity">
              View →
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
