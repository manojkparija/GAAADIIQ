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
      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center font-display font-semibold text-lg text-primary/35">
        {make.charAt(0).toUpperCase()}
      </div>
      <p className="text-muted-foreground/45 text-xs tracking-wide">{make}</p>
    </div>
  );
}

export default function ListingCard({ listing }: { listing: Listing }) {
  const { car } = listing;
  const thumb = listing.image_urls[0];

  return (
    <Link href={`/listings/${listing.id}`} className="group block">
      <div className="relative rounded-sm bg-card border border-border overflow-hidden card-hover h-full flex flex-col">
        {/* Gold top hairline on hover */}
        <span
          className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-accent to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-10"
          aria-hidden
        />

        <div className="relative bg-surface-alt h-44 overflow-hidden">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumb}
              alt={`${car.make} ${car.model}`}
              className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-500"
            />
          ) : (
            <CarPlaceholder make={car.make} />
          )}

          {listing.is_featured && (
            <span className="absolute top-2.5 left-2.5 bg-accent text-accent-foreground text-[10px] font-semibold px-2.5 py-0.5 tracking-[0.12em] uppercase">
              Featured
            </span>
          )}

          <span
            className={`absolute top-2.5 right-2.5 text-[10px] font-semibold px-2.5 py-0.5 tracking-[0.1em] uppercase
            ${listing.listing_type === "new"
              ? "bg-primary text-primary-foreground"
              : "bg-card/95 text-muted-foreground border border-border"
            }`}
          >
            {listing.listing_type === "new" ? "New" : "Used"}
          </span>
        </div>

        <div className="p-4 flex flex-col gap-1.5 flex-1">
          <h3 className="font-display font-semibold text-[15px] text-foreground leading-snug group-hover:text-accent-readable transition-colors">
            {car.year} {car.make} {car.model}
            {car.variant ? ` ${car.variant}` : ""}
          </h3>

          <p className="text-[11px] text-muted-foreground tracking-wide">
            {[
              car.fuel_type,
              listing.km_driven ? `${(listing.km_driven / 1000).toFixed(0)}K km` : null,
              listing.city,
            ].filter(Boolean).join(" · ")}
          </p>

          <div className="mt-auto pt-3.5 flex items-end justify-between border-t border-border/80">
            <div>
              <p className="text-xl font-display font-semibold text-foreground tracking-tight">
                {formatPrice(listing.price)}
              </p>
              {listing.negotiable && (
                <p className="text-[10px] text-accent-readable font-medium tracking-[0.14em] uppercase mt-0.5">
                  Negotiable
                </p>
              )}
            </div>
            <span className="text-[11px] font-medium tracking-wide text-accent-readable border border-accent/35 px-2.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
              View
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
