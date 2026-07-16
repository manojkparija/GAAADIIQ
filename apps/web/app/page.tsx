import Link from "next/link";
import { Car, ChevronRight } from "lucide-react";

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

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, oklch(0.12 0.05 255) 0%, oklch(0.18 0.07 255) 55%, oklch(0.14 0.06 260) 100%)" }}
      >
        {/* Atmospheric radial glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 60% 60% at 65% 40%, oklch(0.73 0.12 78 / 0.12) 0%, transparent 70%)" }}
        />

        <div className="relative max-w-7xl mx-auto px-4 py-16 md:py-24 flex flex-col md:flex-row items-center gap-12">
          {/* Text */}
          <div className="flex-1">
            <span className="inline-block text-accent text-xs font-semibold uppercase tracking-[0.2em] mb-4">
              India&apos;s Premier Automotive Platform
            </span>
            <h1 className="text-4xl md:text-6xl font-display font-semibold text-primary-foreground leading-[1.1] tracking-tight mb-5">
              Find Your<br />
              <span className="italic text-accent">Perfect</span> Car
            </h1>
            {/* Gold rule */}
            <div className="gold-rule mb-5" />
            <p className="text-primary-foreground/80 text-base mb-8 max-w-sm leading-relaxed">
              50,000+ curated listings with price valuation, loan comparison, and expert guidance.
            </p>
            <div className="flex gap-3 flex-wrap">
              <Link
                href="/listings?listing_type=new"
                className="px-6 py-2.5 bg-accent text-accent-foreground text-sm font-semibold rounded-sm hover:bg-accent/90 transition-colors"
              >
                New Cars
              </Link>
              <Link
                href="/listings?listing_type=used"
                className="px-6 py-2.5 border border-primary-foreground/25 text-primary-foreground/80 text-sm font-medium rounded-sm hover:border-accent hover:text-accent transition-colors"
              >
                Used Cars
              </Link>
            </div>
          </div>

          {/* Hero visual — restrained mark (no emoji) */}
          <div className="shrink-0 w-full md:w-[420px] h-56 md:h-72 rounded-sm border border-white/10 bg-white/5 backdrop-blur-sm flex items-center justify-center">
            <div className="text-center flex flex-col items-center gap-3">
              <div className="h-20 w-20 rounded-full border border-accent/40 bg-accent/10 flex items-center justify-center">
                <Car className="h-10 w-10 text-accent" strokeWidth={1.25} aria-hidden />
              </div>
              <p className="text-primary-foreground/45 text-xs tracking-widest uppercase">Curated Inventory</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── BROWSE BY TYPE ───────────────────────────────────────── */}
      <section className="py-12 bg-background border-b border-border">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-end justify-between mb-7">
            <div>
              <h2 className="text-2xl font-display font-semibold text-foreground">Browse by Type</h2>
              <div className="gold-rule mt-2" />
            </div>
            <Link href="/listings" className="text-sm text-accent font-medium flex items-center gap-0.5 hover:underline">
              View all <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-none">
            {BODY_TYPES.map((type) => (
              <Link
                key={type.label}
                href={type.href}
                className="flex-shrink-0 px-5 py-2.5 border border-border rounded-sm text-sm font-medium text-muted-foreground hover:border-accent hover:text-accent hover:bg-accent/5 transition-all whitespace-nowrap"
              >
                {type.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── BROWSE BY BRAND ──────────────────────────────────────── */}
      <section className="py-12 bg-surface-alt border-b border-border">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-end justify-between mb-7">
            <div>
              <h2 className="text-2xl font-display font-semibold text-foreground">Popular Brands</h2>
              <div className="gold-rule mt-2" />
            </div>
            <Link href="/cars" className="text-sm text-accent font-medium flex items-center gap-0.5 hover:underline">
              All brands <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
            {POPULAR_MAKES.map((make, i) => (
              <Link
                key={make.name}
                href={`/listings?make=${encodeURIComponent(make.name)}`}
                className="anim-card flex flex-col items-center gap-2 p-3 rounded-sm bg-card border border-border hover:border-accent/50 hover:shadow-sm transition-all"
                style={{ "--i": i } as React.CSSProperties}
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-xs"
                  style={{ backgroundColor: make.color }}
                >
                  {make.short}
                </div>
                <span className="text-xs font-medium text-center leading-tight text-muted-foreground">{make.name}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── BROWSE BY BUDGET ─────────────────────────────────────── */}
      <section className="py-12 bg-background border-b border-border">
        <div className="max-w-7xl mx-auto px-4">
          <div className="mb-7">
            <h2 className="text-2xl font-display font-semibold text-foreground">Browse by Budget</h2>
            <div className="gold-rule mt-2" />
          </div>
          <div className="flex flex-wrap gap-2.5">
            {BUDGET_RANGES.map((b) => (
              <Link
                key={b.label}
                href={b.href}
                className="px-5 py-2 border border-border rounded-sm text-sm font-medium text-muted-foreground hover:border-accent hover:text-accent hover:bg-accent/5 transition-colors"
              >
                {b.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY GAADIIQ ──────────────────────────────────────────── */}
      <section className="py-14 bg-surface-alt">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-display font-semibold text-foreground mb-3">Why GAADIIQ?</h2>
            <div className="gold-rule mx-auto" />
            <p className="text-muted-foreground text-sm mt-4 max-w-sm mx-auto">
              Intelligent tools for every stage of your car journey.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {WHY_ITEMS.map((f, i) => (
              <div
                key={f.title}
                className="anim-card p-6 rounded-sm bg-card border border-border hover:border-accent/40 hover:shadow-sm transition-all"
                style={{ "--i": i } as React.CSSProperties}
              >
                <span className="text-accent text-lg font-display leading-none">✦</span>
                <h3 className="font-display font-semibold text-base text-foreground mt-3 mb-1.5">{f.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SELL CTA ─────────────────────────────────────────────── */}
      <section
        className="py-16"
        style={{ background: "linear-gradient(135deg, oklch(0.12 0.05 255) 0%, oklch(0.18 0.07 255) 100%)" }}
      >
        <div className="max-w-7xl mx-auto px-4 text-center">
          <span className="text-accent text-xs font-semibold uppercase tracking-[0.2em] block mb-3">Sell Smarter</span>
          <h2 className="text-3xl md:text-4xl font-display font-semibold text-primary-foreground mb-3">
            Ready to Sell Your Car?
          </h2>
          <div className="gold-rule mx-auto mb-6" />
          <p className="text-primary-foreground/55 text-sm mb-8 max-w-sm mx-auto leading-relaxed">
            List free, reach curated buyers, and get a price valuation in seconds.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link
              href="/register"
              className="px-7 py-2.5 bg-accent text-accent-foreground text-sm font-semibold rounded-sm hover:bg-accent/90 transition-colors"
            >
              List Your Car Free
            </Link>
            <Link
              href="/login"
              className="px-7 py-2.5 border border-white/20 text-primary-foreground/75 text-sm font-medium rounded-sm hover:border-accent/60 hover:text-accent transition-colors"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────── */}
      <footer className="bg-primary text-primary-foreground/50 py-12">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
            <div className="col-span-2 md:col-span-1">
              <p className="font-display font-semibold text-primary-foreground text-xl mb-1 tracking-wide">
                <span className="text-accent">✦</span> GAADIIQ
              </p>
              <p className="text-xs leading-relaxed mt-2">India&apos;s premium AI automotive platform.</p>
            </div>
            <div>
              <p className="font-semibold text-primary-foreground text-xs mb-3 uppercase tracking-wider">Buy</p>
              <ul className="space-y-1.5 text-xs">
                <li><Link href="/listings" className="hover:text-accent transition-colors">All Cars</Link></li>
                <li><Link href="/listings?listing_type=used" className="hover:text-accent transition-colors">Used Cars</Link></li>
                <li><Link href="/listings?listing_type=new" className="hover:text-accent transition-colors">New Cars</Link></li>
                <li><Link href="/listings?fuel_type=electric" className="hover:text-accent transition-colors">Electric</Link></li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-primary-foreground text-xs mb-3 uppercase tracking-wider">Sell</p>
              <ul className="space-y-1.5 text-xs">
                <li><Link href="/register" className="hover:text-accent transition-colors">List Your Car</Link></li>
                <li><Link href="/dashboard" className="hover:text-accent transition-colors">Dashboard</Link></li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-primary-foreground text-xs mb-3 uppercase tracking-wider">Tools</p>
              <ul className="space-y-1.5 text-xs">
                <li><Link href="/compare" className="hover:text-accent transition-colors">Compare Cars</Link></li>
                <li><Link href="/tco" className="hover:text-accent transition-colors">TCO Calculator</Link></li>
                <li><Link href="/recommend" className="hover:text-accent transition-colors">Car Advisor</Link></li>
                <li><a href="mailto:support@gaadiiq.com" className="hover:text-accent transition-colors">Contact</a></li>
              </ul>
            </div>
          </div>
          {/* Gold rule before copyright */}
          <div className="border-t border-white/10 pt-6 flex flex-col md:flex-row items-center justify-between gap-1 text-xs">
            <p>© {new Date().getFullYear()} GAADIIQ. All rights reserved.</p>
            <p>Crafted for India&apos;s discerning car buyers.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
