import Link from "next/link";
import type { Listing } from "@/types/listing";

function formatPrice(price: number) {
  if (price >= 10_00_000) return `₹${(price / 10_00_000).toFixed(1)} L`;
  if (price >= 1_000) return `₹${(price / 1_000).toFixed(0)}K`;
  return `₹${price}`;
}

function CarPlaceholder({ make }: { make: string }) {
  return (
    <div className="w-full h-full bg-[#f0f0f0] flex flex-col items-center justify-center gap-2">
      <span className="text-5xl">🚗</span>
      <p className="text-gray-400 text-xs font-medium">{make}</p>
    </div>
  );
}

export default function ListingCard({ listing }: { listing: Listing }) {
  const { car } = listing;
  const thumb = listing.image_urls[0];

  return (
    <Link href={`/listings/${listing.id}`} className="group block">
      <div className="rounded-xl bg-white border border-gray-200 overflow-hidden card-hover h-full flex flex-col">
        {/* Image */}
        <div className="relative bg-[#f5f5f5] h-44 overflow-hidden">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumb}
              alt={`${car.make} ${car.model}`}
              className="w-full h-full object-cover group-hover:scale-103 transition-transform duration-300"
            />
          ) : (
            <CarPlaceholder make={car.make} />
          )}

          {/* Featured badge */}
          {listing.is_featured && (
            <span className="absolute top-2 left-2 bg-[#F15B22] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
              Featured
            </span>
          )}

          {/* New / Used */}
          <span className={`absolute top-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded-full
            ${listing.listing_type === "new"
              ? "bg-black text-white"
              : "bg-white text-gray-700 border"
            }`}
          >
            {listing.listing_type === "new" ? "New" : "Used"}
          </span>
        </div>

        {/* Content */}
        <div className="p-3.5 flex flex-col gap-1.5 flex-1">
          <h3 className="font-bold text-[13px] text-[#111] leading-snug group-hover:text-[#F15B22] transition-colors">
            {car.year} {car.make} {car.model}
            {car.variant ? ` ${car.variant}` : ""}
          </h3>

          {/* Subtle meta line */}
          <p className="text-[11px] text-gray-400">
            {[
              car.fuel_type,
              listing.km_driven ? `${(listing.km_driven / 1000).toFixed(0)}K km` : null,
              listing.city,
            ].filter(Boolean).join(" · ")}
          </p>

          {/* Price row */}
          <div className="mt-auto pt-2.5 flex items-end justify-between border-t border-gray-100">
            <div>
              <p className="text-lg font-bold text-[#111]">{formatPrice(listing.price)}</p>
              {listing.negotiable && (
                <p className="text-[10px] text-[#F15B22] font-medium">Negotiable</p>
              )}
            </div>
            <span className="text-[11px] font-semibold text-[#F15B22] border border-[#F15B22]/40 px-2.5 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity">
              View →
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
