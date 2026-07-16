import type { Metadata } from "next";
import Link from "next/link";
import { Car, CarFront, Truck, Users, ChevronRight, Gauge, Star } from "lucide-react";
import ToolPageHeader from "@/components/tool-page-header";

export const metadata: Metadata = {
  title: "Car Brands & Models | GAADIIQ",
  description: "Browse all car brands and models available on GAADIIQ — India's AI-first automotive marketplace.",
};

const BRANDS = [
  { make: "Maruti Suzuki", slug: "maruti-suzuki", popular: ["Swift", "Baleno", "Brezza", "Wagon R", "Alto"] },
  { make: "Hyundai",       slug: "hyundai",       popular: ["Creta", "i20", "Venue", "Verna", "Tucson"] },
  { make: "Tata",          slug: "tata",           popular: ["Nexon", "Punch", "Harrier", "Altroz", "Safari"] },
  { make: "Mahindra",      slug: "mahindra",       popular: ["Scorpio-N", "XUV700", "Thar", "XUV300", "Bolero"] },
  { make: "Toyota",        slug: "toyota",         popular: ["Innova Crysta", "Fortuner", "Hyryder", "Glanza", "Camry"] },
  { make: "Honda",         slug: "honda",          popular: ["City", "Amaze", "Elevate", "WR-V", "Jazz"] },
  { make: "Kia",           slug: "kia",            popular: ["Seltos", "Sonet", "Carens", "EV6", "Carnival"] },
  { make: "Volkswagen",    slug: "volkswagen",     popular: ["Taigun", "Virtus", "Tiguan", "Polo"] },
  { make: "Skoda",         slug: "skoda",          popular: ["Kushaq", "Slavia", "Kodiaq", "Superb"] },
  { make: "MG Motor",      slug: "mg-motor",       popular: ["Hector", "Astor", "ZS EV", "Gloster"] },
  { make: "Ford",          slug: "ford",           popular: ["EcoSport", "Endeavour", "Figo", "Aspire"] },
  { make: "Renault",       slug: "renault",        popular: ["Kwid", "Kiger", "Triber", "Duster"] },
  { make: "Nissan",        slug: "nissan",         popular: ["Magnite", "Kicks", "X-Trail"] },
  { make: "BMW",           slug: "bmw",            popular: ["3 Series", "5 Series", "X5", "X1", "7 Series"] },
  { make: "Mercedes-Benz", slug: "mercedes-benz",  popular: ["C-Class", "E-Class", "GLC", "GLE", "S-Class"] },
  { make: "Audi",          slug: "audi",           popular: ["A4", "A6", "Q5", "Q7", "e-tron"] },
];

const BODY_TYPES = [
  { type: "Hatchback",   Icon: Car,       desc: "Compact and city-friendly",    href: "/listings?body_type=hatchback" },
  { type: "Sedan",       Icon: CarFront,  desc: "Comfortable family saloons",   href: "/listings?body_type=sedan" },
  { type: "SUV",         Icon: Truck,     desc: "Space and road presence",      href: "/listings?body_type=suv" },
  { type: "MPV",         Icon: Users,     desc: "Maximum passenger capacity",   href: "/listings?body_type=mpv" },
  { type: "Performance", Icon: Gauge,     desc: "Sporty driving character",     href: "/listings?body_type=coupe" },
  { type: "Luxury",      Icon: Star,      desc: "Premium open-top experience",  href: "/listings?min_price=3000000" },
];

export default function CarsPage() {
  return (
    <main className="min-h-screen bg-background">
      <ToolPageHeader
        eyebrow="Brand Directory"
        title="Car Catalogue"
        subtitle="Every make and body type on GAADIIQ — find what moves you."
        icon={<Car className="h-6 w-6 text-accent" />}
      />

      <div className="max-w-7xl mx-auto px-4 py-10">
        {/* Browse by body type */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-4 tracking-tight">Browse by Body Type</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {BODY_TYPES.map((bt) => (
              <Link
                key={bt.type}
                href={bt.href}
                className="flex flex-col items-center gap-2.5 p-5 rounded-xl border bg-card hover:border-primary/50 hover:bg-primary hover:text-primary-foreground text-center transition-all card-hover group"
              >
                <bt.Icon className="h-7 w-7" />
                <span className="font-semibold text-sm">{bt.type}</span>
                <span className="text-xs opacity-70 group-hover:opacity-90">{bt.desc}</span>
              </Link>
            ))}
          </div>
        </section>

        {/* Browse by brand */}
        <section>
          <h2 className="text-xl font-semibold mb-4 tracking-tight">Browse by Brand</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {BRANDS.map((brand) => (
              <Link
                key={brand.slug}
                href={`/cars/${brand.slug}`}
                className="bg-card rounded-xl border p-5 hover:border-primary/50 hover:shadow-sm transition-all group card-hover"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Car className="h-5 w-5 text-primary" />
                    </div>
                    <span className="font-semibold group-hover:text-primary transition-colors">
                      {brand.make}
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {brand.popular.slice(0, 3).map((model) => (
                    <span
                      key={model}
                      className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground"
                    >
                      {model}
                    </span>
                  ))}
                  {brand.popular.length > 3 && (
                    <span className="text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                      +{brand.popular.length - 3} more
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
