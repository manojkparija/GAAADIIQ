import Link from "next/link";
import { ChevronRight } from "lucide-react";

const POPULAR_MAKES = [
  { name: "Maruti Suzuki", short: "MS", color: "#003087" },
  { name: "Hyundai",       short: "HY", color: "#002c5f" },
  { name: "Tata Motors",   short: "TM", color: "#00519b" },
  { name: "Mahindra",      short: "MH", color: "#c41230" },
  { name: "Honda",         short: "HO", color: "#cc0000" },
  { name: "Toyota",        short: "TY", color: "#eb0a1e" },
  { name: "Kia",           short: "KI", color: "#bb162b" },
  { name: "MG Motor",      short: "MG", color: "#d50000" },
];

const BODY_TYPES = [
  { label: "SUV",       href: "/listings?body_type=suv" },
  { label: "Hatchback", href: "/listings?body_type=hatchback" },
  { label: "Sedan",     href: "/listings?body_type=sedan" },
  { label: "MUV / MPV", href: "/listings?body_type=muv" },
  { label: "Electric",  href: "/listings?fuel_type=electric" },
  { label: "Luxury",    href: "/listings?min_price=3000000" },
];

const BUDGET_RANGES = [
  { label: "Under ₹5L",    href: "/listings?max_price=500000" },
  { label: "₹5L – ₹10L",  href: "/listings?min_price=500000&max_price=1000000" },
  { label: "₹10L – ₹20L", href: "/listings?min_price=1000000&max_price=2000000" },
  { label: "₹20L – ₹50L", href: "/listings?min_price=2000000&max_price=5000000" },
  { label: "Above ₹50L",  href: "/listings?min_price=5000000" },
];

const WHY_ITEMS = [
  { title: "AI Price Valuation",  desc: "Instant fair-market price backed by real transaction data." },
  { title: "Loan Comparison",     desc: "Compare EMI from top banks. Get pre-approved in minutes." },
  { title: "Verified Listings",   desc: "Every listing reviewed. No ghost ads, no hidden charges." },
  { title: "Test Drive Booking",  desc: "Schedule directly with the seller — from your couch." },
  { title: "Market Intelligence", desc: "Depreciation curves, price trends, resale forecasts." },
  { title: "Price Drop Alerts",   desc: "Set a target and we notify you the moment it's met." },
];

export default function HomePage() {
  return (
    <main className="flex flex-col min-h-screen bg-background">

      {/* ── HERO — full-bleed navy plane, brand-first ───────────── */}
      <section className="relative overflow-hidden hero-navy min-h-[78vh] md:min-h-[85vh] flex items-center">
        {/* Soft linen texture */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent, transparent 2px, oklch(0.95 0.01 82) 2px, oklch(0.95 0.01 82) 3px)",
          }}
          aria-hidden
        />

        <div className="relative max-w-7xl mx-auto px-4 py-20 md:py-28 w-full">
          <p className="anim-fade-up font-display text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-semibold tracking-[0.04em] text-primary-foreground leading-none mb-6">
            <span className="text-accent">✦</span> GAADIIQ
          </p>
          <h1 className="anim-fade-up anim-delay-1 text-2xl md:text-4xl font-display font-medium text-primary-foreground/95 leading-snug max-w-xl mb-5">
            The private gallery for India&apos;s finest cars
          </h1>
          <div className="gold-rule-lg anim-rule mb-6" />
          <p className="anim-fade-up anim-delay-2 text-primary-foreground/70 text-base md:text-lg mb-10 max-w-md leading-relaxed font-light">
            Curated inventory, AI valuation, and white-glove guidance — from first glance to the keys.
          </p>
          <div className="anim-fade-up anim-delay-3 flex gap-3 flex-wrap">
            <Link
              href="/listings?listing_type=new"
              className="px-8 py-3 bg-accent text-accent-foreground text-sm font-semibold tracking-wide rounded-sm hover:bg-accent/90 transition-colors"
            >
              Explore New Cars
            </Link>
            <Link
              href="/listings?listing_type=used"
              className="px-8 py-3 border border-primary-foreground/30 text-primary-foreground/90 text-sm font-medium tracking-wide rounded-sm hover:border-accent hover:text-accent transition-colors"
            >
              Browse Used
            </Link>
          </div>
        </div>
      </section>

      {/* ── BROWSE BY TYPE ───────────────────────────────────────── */}
      <section className="py-14 md:py-16 surface-royal border-b border-border">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-end justify-between mb-8">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-accent-readable font-medium mb-2">Collection</p>
              <h2 className="text-3xl md:text-4xl font-display font-semibold text-foreground">Browse by Type</h2>
              <div className="gold-rule mt-3" />
            </div>
            <Link href="/listings" className="text-sm text-accent-readable font-medium flex items-center gap-0.5 hover:underline">
              View all <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none">
            {BODY_TYPES.map((type) => (
              <Link
                key={type.label}
                href={type.href}
                className="flex-shrink-0 px-6 py-3 border border-border/80 bg-card/60 text-sm font-medium tracking-wide text-foreground/80 hover:border-accent hover:text-accent-readable transition-all whitespace-nowrap"
              >
                {type.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── BROWSE BY BRAND ──────────────────────────────────────── */}
      <section className="py-14 md:py-16 bg-surface-alt border-b border-border">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-end justify-between mb-8">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-accent-readable font-medium mb-2">Houses</p>
              <h2 className="text-3xl md:text-4xl font-display font-semibold text-foreground">Popular Brands</h2>
              <div className="gold-rule mt-3" />
            </div>
            <Link href="/cars" className="text-sm text-accent-readable font-medium flex items-center gap-0.5 hover:underline">
              All brands <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-4">
            {POPULAR_MAKES.map((make, i) => (
              <Link
                key={make.name}
                href={`/listings?make=${encodeURIComponent(make.name)}`}
                className="anim-card group flex flex-col items-center gap-3 py-4 px-2 transition-colors"
                style={{ "--i": i } as React.CSSProperties}
              >
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold text-xs ring-1 ring-border group-hover:ring-accent/50 transition-all"
                  style={{ backgroundColor: make.color }}
                >
                  {make.short}
                </div>
                <span className="text-xs font-medium text-center leading-tight text-muted-foreground group-hover:text-foreground transition-colors">
                  {make.name}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── BROWSE BY BUDGET ─────────────────────────────────────── */}
      <section className="py-14 md:py-16 bg-background border-b border-border">
        <div className="max-w-7xl mx-auto px-4">
          <div className="mb-8">
            <p className="text-[11px] uppercase tracking-[0.22em] text-accent-readable font-medium mb-2">Investment</p>
            <h2 className="text-3xl md:text-4xl font-display font-semibold text-foreground">Browse by Budget</h2>
            <div className="gold-rule mt-3" />
          </div>
          <div className="flex flex-wrap gap-3">
            {BUDGET_RANGES.map((b) => (
              <Link
                key={b.label}
                href={b.href}
                className="px-6 py-2.5 border border-border bg-card/40 text-sm font-medium tracking-wide text-foreground/80 hover:border-accent hover:text-accent-readable transition-colors"
              >
                {b.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY GAADIIQ — editorial, not cards ───────────────────── */}
      <section className="py-16 md:py-20 surface-royal">
        <div className="max-w-7xl mx-auto px-4">
          <div className="max-w-xl mb-12">
            <p className="text-[11px] uppercase tracking-[0.22em] text-accent-readable font-medium mb-2">Distinction</p>
            <h2 className="text-3xl md:text-5xl font-display font-semibold text-foreground mb-4">Why GAADIIQ</h2>
            <div className="gold-rule mb-5" />
            <p className="text-muted-foreground text-sm md:text-base leading-relaxed font-light">
              Intelligent tools for every stage of a considered purchase.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-10">
            {WHY_ITEMS.map((f, i) => (
              <div
                key={f.title}
                className="anim-card border-t border-accent/35 pt-5"
                style={{ "--i": i } as React.CSSProperties}
              >
                <h3 className="font-display font-semibold text-xl text-foreground mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed font-light">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SELL CTA ─────────────────────────────────────────────── */}
      <section className="py-20 hero-navy">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="font-display text-4xl md:text-5xl font-semibold text-primary-foreground tracking-wide mb-4">
            Sell with presence
          </p>
          <div className="gold-rule-lg mx-auto anim-rule mb-6" />
          <p className="text-primary-foreground/60 text-sm md:text-base mb-10 max-w-md mx-auto leading-relaxed font-light">
            List free, reach discerning buyers, and receive a valuation in seconds.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link
              href="/register"
              className="px-8 py-3 bg-accent text-accent-foreground text-sm font-semibold tracking-wide rounded-sm hover:bg-accent/90 transition-colors"
            >
              List Your Car
            </Link>
            <Link
              href="/login"
              className="px-8 py-3 border border-white/25 text-primary-foreground/80 text-sm font-medium tracking-wide rounded-sm hover:border-accent/70 hover:text-accent transition-colors"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────── */}
      <footer className="bg-primary text-primary-foreground/50 py-14 border-t border-accent/20">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-10">
            <div className="col-span-2 md:col-span-1">
              <p className="font-display font-semibold text-primary-foreground text-2xl mb-2 tracking-[0.06em]">
                <span className="text-accent">✦</span> GAADIIQ
              </p>
              <div className="gold-rule mb-3" />
              <p className="text-xs leading-relaxed font-light">India&apos;s premium AI automotive platform.</p>
            </div>
            <div>
              <p className="font-display text-primary-foreground text-sm mb-4 tracking-wide">Buy</p>
              <ul className="space-y-2 text-xs font-light">
                <li><Link href="/listings" className="hover:text-accent transition-colors">All Cars</Link></li>
                <li><Link href="/listings?listing_type=used" className="hover:text-accent transition-colors">Used Cars</Link></li>
                <li><Link href="/listings?listing_type=new" className="hover:text-accent transition-colors">New Cars</Link></li>
                <li><Link href="/listings?fuel_type=electric" className="hover:text-accent transition-colors">Electric</Link></li>
              </ul>
            </div>
            <div>
              <p className="font-display text-primary-foreground text-sm mb-4 tracking-wide">Sell</p>
              <ul className="space-y-2 text-xs font-light">
                <li><Link href="/register" className="hover:text-accent transition-colors">List Your Car</Link></li>
                <li><Link href="/dashboard" className="hover:text-accent transition-colors">Dashboard</Link></li>
              </ul>
            </div>
            <div>
              <p className="font-display text-primary-foreground text-sm mb-4 tracking-wide">Tools</p>
              <ul className="space-y-2 text-xs font-light">
                <li><Link href="/compare" className="hover:text-accent transition-colors">Compare Cars</Link></li>
                <li><Link href="/tco" className="hover:text-accent transition-colors">TCO Calculator</Link></li>
                <li><Link href="/recommend" className="hover:text-accent transition-colors">Car Advisor</Link></li>
                <li><a href="mailto:support@gaadiiq.com" className="hover:text-accent transition-colors">Contact</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/10 pt-6 flex flex-col md:flex-row items-center justify-between gap-2 text-[11px] tracking-wide">
            <p>© {new Date().getFullYear()} GAADIIQ. All rights reserved.</p>
            <p className="font-light">Crafted for India&apos;s discerning car buyers.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
