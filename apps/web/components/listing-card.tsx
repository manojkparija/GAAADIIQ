import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { MapPin, Star } from "lucide-react";
import type { Listing } from "@/types/listing";

function formatPrice(price: number) {
  if (price >= 10_00_000) return `₹${(price / 10_00_000).toFixed(1)}L`;
  if (price >= 1_000) return `₹${(price / 1_000).toFixed(0)}K`;
  return `₹${price}`;
}

function formatKm(km: number) {
  return km >= 1000 ? `${(km / 1000).toFixed(0)}K km` : `${km} km`;
}

/* Brand gradients for placeholder imagery — intentional brand identity colors */
const MAKE_COLORS: Record<string, string> = {
  "maruti": "from-blue-700 to-blue-900",
  "maruti suzuki": "from-blue-700 to-blue-900",
  "hyundai": "from-slate-600 to-slate-900",
  "tata": "from-sky-700 to-blue-900",
  "tata motors": "from-sky-700 to-blue-900",
  "mahindra": "from-red-700 to-rose-900",
  "honda": "from-red-600 to-slate-800",
  "toyota": "from-red-700 to-gray-900",
  "kia": "from-red-600 to-slate-900",
  "mg": "from-red-800 to-red-950",
  "mg motor": "from-red-800 to-red-950",
  "renault": "from-yellow-600 to-orange-700",
  "volkswagen": "from-blue-600 to-indigo-900",
  "skoda": "from-emerald-700 to-emerald-900",
  "ford": "from-blue-500 to-blue-800",
  "nissan": "from-red-600 to-gray-900",
  "mercedes": "from-gray-600 to-gray-900",
  "bmw": "from-blue-700 to-slate-900",
  "audi": "from-gray-700 to-gray-950",
  "default": "from-primary/80 to-primary",
};

/* Fuel badge — semantic colors tied to chart tokens */
const FUEL_COLORS: Record<string, string> = {
  petrol:   "bg-chart-5/15 text-chart-5 border-chart-5/30",
  diesel:   "bg-muted text-muted-foreground border-border",
  electric: "bg-chart-4/15 text-chart-4 border-chart-4/30",
  cng:      "bg-chart-2/15 text-chart-2 border-chart-2/30",
  hybrid:   "bg-success/15 text-success border-success/30",
};

function CarPlaceholder({ make, model }: { make: string; model: string }) {
  const gradient = MAKE_COLORS[make.toLowerCase()] ?? MAKE_COLORS["default"];
  return (
    <div className={`w-full h-full bg-gradient-to-br ${gradient} flex flex-col items-center justify-center gap-2`}>
      <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-2xl">
        {make.charAt(0).toUpperCase()}
      </div>
      <p className="text-white/70 text-xs font-medium">{make} {model}</p>
    </div>
  );
}

export default function ListingCard({ listing }: { listing: Listing }) {
  const { car } = listing;
  const thumb = listing.image_urls[0];
  const fuelClass = FUEL_COLORS[car.fuel_type?.toLowerCase() ?? ""] ?? "bg-muted text-muted-foreground border-border";

  return (
    <Link href={`/listings/${listing.id}`} className="group block">
      <div className="rounded-2xl border bg-card overflow-hidden card-hover h-full flex flex-col">
        {/* Image */}
        <div className="relative bg-muted h-48 overflow-hidden">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumb}
              alt={`${car.make} ${car.model}`}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <CarPlaceholder make={car.make} model={car.model} />
          )}

          {/* Featured badge */}
          {listing.is_featured && (
            <div className="absolute top-2.5 left-2.5">
              <span className="inline-flex items-center gap-1 bg-accent text-accent-foreground text-xs font-semibold px-2 py-0.5 rounded-full">
                <Star className="h-3 w-3 fill-current" />
                Featured
              </span>
            </div>
          )}

          {/* New / Used badge */}
          <div className="absolute top-2.5 right-2.5">
            <Badge variant={listing.listing_type === "new" ? "default" : "secondary"}>
              {listing.listing_type === "new" ? "New" : "Used"}
            </Badge>
          </div>

          {/* Location overlay */}
          {listing.city && (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/50 to-transparent px-3 py-2">
              <p className="text-white text-xs font-medium flex items-center gap-1">
                <MapPin className="h-3 w-3 shrink-0" />
                {listing.city}
              </p>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-4 flex flex-col gap-3 flex-1">
          <h3 className="font-bold text-sm leading-snug group-hover:text-primary transition-colors">
            {car.year} {car.make} {car.model}
            {car.variant ? ` ${car.variant}` : ""}
          </h3>

          {/* Specs */}
          <div className="flex flex-wrap gap-1.5">
            {car.fuel_type && (
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium capitalize ${fuelClass}`}>
                {car.fuel_type}
              </span>
            )}
            {car.transmission && (
              <span className="text-xs px-2 py-0.5 rounded-full border bg-muted text-muted-foreground border-border font-medium capitalize">
                {car.transmission}
              </span>
            )}
            {listing.km_driven != null && listing.km_driven > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full border bg-muted text-muted-foreground border-border font-medium">
                {formatKm(listing.km_driven)}
              </span>
            )}
            {listing.owners_count != null && listing.owners_count > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full border bg-muted text-muted-foreground border-border font-medium">
                {listing.owners_count} owner{listing.owners_count > 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Price */}
          <div className="mt-auto flex items-center justify-between pt-3 border-t">
            <div>
              <p className="text-xl font-bold text-primary">{formatPrice(listing.price)}</p>
              {listing.ai_valuation && (
                <p className="text-xs text-muted-foreground">
                  AI: {formatPrice(listing.ai_valuation)}
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1">
              {listing.negotiable && (
                <span className="text-xs text-success font-semibold bg-success/10 px-2 py-0.5 rounded-full">
                  Negotiable
                </span>
              )}
              <span className="text-xs text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                View →
              </span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
