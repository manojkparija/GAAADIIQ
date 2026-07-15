import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import {
  Bot, Landmark, ShieldCheck, Car, BarChart2, Bell,
  CarFront, Truck, Users, Zap, Award, ChevronRight,
} from "lucide-react";

const POPULAR_MAKES = [
  { name: "Maruti Suzuki", short: "MS", color: "#003087" },
  { name: "Hyundai", short: "HY", color: "#002c5f" },
  { name: "Tata Motors", short: "TM", color: "#00519b" },
  { name: "Mahindra", short: "MH", color: "#c41230" },
  { name: "Honda", short: "HO", color: "#cc0000" },
  { name: "Toyota", short: "TY", color: "#eb0a1e" },
  { name: "Kia", short: "KI", color: "#bb162b" },
  { name: "MG Motor", short: "MG", color: "#d50000" },
];

const BODY_TYPES = [
  { label: "Hatchback", Icon: Car,      href: "/listings?body_type=hatchback" },
  { label: "Sedan",     Icon: CarFront, href: "/listings?body_type=sedan" },
  { label: "SUV",       Icon: Truck,    href: "/listings?body_type=suv" },
  { label: "MUV",       Icon: Users,    href: "/listings?body_type=muv" },
  { label: "Electric",  Icon: Zap,      href: "/listings?fuel_type=electric" },
  { label: "Luxury",    Icon: Award,    href: "/listings?min_price=3000000" },
];

const BUDGET_RANGES = [
  { label: "Under ₹5L",    href: "/listings?max_price=500000" },
  { label: "₹5L – ₹10L",  href: "/listings?min_price=500000&max_price=1000000" },
  { label: "₹10L – ₹20L", href: "/listings?min_price=1000000&max_price=2000000" },
  { label: "₹20L – ₹50L", href: "/listings?min_price=2000000&max_price=5000000" },
  { label: "Above ₹50L",  href: "/listings?min_price=5000000" },
];

const FEATURES = [
  { Icon: Bot,         title: "AI Price Valuation",   desc: "Instant fair-market valuation for any car — no guesswork, just data." },
  { Icon: Landmark,    title: "Loan Comparison",      desc: "Compare EMI options from top banks and get pre-approved in minutes." },
  { Icon: ShieldCheck, title: "Verified Listings",    desc: "Every listing is verified by our team. No fake ads, no hidden charges." },
  { Icon: Car,         title: "Test Drive Booking",   desc: "Book a test drive directly with the seller — from your couch." },
  { Icon: BarChart2,   title: "Market Intelligence",  desc: "Real-time price trends, depreciation charts, and resale value forecasts." },
  { Icon: Bell,        title: "Price Drop Alerts",    desc: "Set a target price and get notified the moment a listing drops below it." },
];

const STATS = [
  { value: "50,000+", label: "Verified Listings" },
  { value: "100+",    label: "Cities Covered" },
  { value: "₹500Cr+", label: "Cars Sold" },
  { value: "4.8★",    label: "Buyer Rating" },
];

export default function HomePage() {
  return (
    <main className="flex flex-col min-h-screen">
      {/* ── HERO ───────────────────────────────────────────────── */}
      <section className="hero-gradient text-white overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 py-20 md:py-32">
          <div className="max-w-3xl">
            <span className="anim-fade-up inline-block bg-accent/20 text-accent text-xs font-semibold uppercase tracking-widest px-3 py-1 rounded-full mb-6 border border-accent/30">
              India&apos;s AI-First Automotive Platform
            </span>
            <h1 className="anim-fade-up anim-delay-1 text-4xl md:text-6xl font-bold leading-tight mb-6 tracking-tight">
              Buy &amp; Sell Cars{" "}
              <span className="text-amber-gradient">Intelligently</span>
            </h1>
            <p className="anim-fade-up anim-delay-2 text-lg md:text-xl text-white/70 mb-10 max-w-xl leading-relaxed">
              AI-powered car discovery, real-time valuations, loan comparisons,
              and dealer intelligence — all in one place.
            </p>
            <div className="anim-fade-up anim-delay-3 flex flex-wrap gap-4">
              <Link
                href="/listings"
                className={buttonVariants({ size: "lg" }) + " bg-accent text-accent-foreground hover:bg-accent/90 font-semibold px-8"}
              >
                Explore Cars
              </Link>
              <Link
                href="/listings?listing_type=used"
                className={buttonVariants({ size: "lg", variant: "outline" }) + " border-white/30 text-white hover:bg-white/10 px-8"}
              >
                Browse Used Cars
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS BAR ─────────────────────────────────────────── */}
      <section className="bg-card border-b">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:divide-x divide-border">
            {STATS.map((s) => (
              <div key={s.label} className="text-center md:first:pl-0 md:px-6">
                <p className="text-2xl md:text-3xl font-bold text-primary font-variant-numeric tabular-nums">{s.value}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── BROWSE BY BRAND ───────────────────────────────────── */}
      <section className="bg-surface-alt py-14">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-end justify-between mb-8">
            <div>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Browse by Brand</h2>
              <p className="text-muted-foreground text-sm mt-1">India&apos;s most popular car brands</p>
            </div>
            <Link href="/cars" className="text-sm font-medium text-primary hover:underline hidden md:flex items-center gap-1">
              All brands <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
            {POPULAR_MAKES.map((make, i) => (
              <Link
                key={make.name}
                href={`/listings?make=${encodeURIComponent(make.name)}`}
                className="anim-card group flex flex-col items-center gap-2 p-3 rounded-xl bg-card border hover:border-primary/40 hover:shadow-md transition-all card-hover"
                style={{ "--i": i } as React.CSSProperties}
              >
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-sm"
                  style={{ backgroundColor: make.color }}
                >
                  {make.short}
                </div>
                <span className="text-xs font-medium text-center leading-tight">{make.name}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── BROWSE BY TYPE ────────────────────────────────────── */}
      <section className="py-14 bg-background">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-2">Browse by Type</h2>
          <p className="text-muted-foreground text-sm mb-8">Find the right body style for your lifestyle</p>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
            {BODY_TYPES.map((t, i) => (
              <Link
                key={t.label}
                href={t.href}
                className="anim-card flex flex-col items-center gap-3 p-5 rounded-2xl border bg-card hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all card-hover group"
                style={{ "--i": i } as React.CSSProperties}
              >
                <t.Icon className="h-7 w-7" />
                <span className="text-sm font-semibold">{t.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── BROWSE BY BUDGET ──────────────────────────────────── */}
      <section className="py-14 bg-surface-alt">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-2">Browse by Budget</h2>
          <p className="text-muted-foreground text-sm mb-8">Find cars that fit your budget perfectly</p>
          <div className="flex flex-wrap gap-3">
            {BUDGET_RANGES.map((b) => (
              <Link
                key={b.label}
                href={b.href}
                className="px-5 py-2.5 rounded-full border-2 border-primary/20 text-sm font-semibold hover:border-primary hover:bg-primary hover:text-primary-foreground transition-all"
              >
                {b.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY GAADIIQ ───────────────────────────────────────── */}
      <section className="py-16 bg-background">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Why Choose GAADIIQ?</h2>
            <p className="text-muted-foreground mt-2 max-w-xl mx-auto">
              We&apos;re not just another car marketplace — we&apos;re your intelligent car-buying co-pilot.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className="anim-card p-6 rounded-2xl border bg-card hover:shadow-md transition-shadow"
                style={{ "--i": i } as React.CSSProperties}
              >
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <f.Icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-bold text-base mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SELL CTA ──────────────────────────────────────────── */}
      <section className="hero-gradient py-16">
        <div className="max-w-7xl mx-auto px-4 text-center text-white">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">Ready to Sell Your Car?</h2>
          <p className="text-white/70 mb-8 max-w-md mx-auto">
            List for free, reach thousands of buyers, and get the best price with our AI valuation.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link
              href="/register"
              className={buttonVariants({ size: "lg" }) + " bg-accent text-accent-foreground hover:bg-accent/90 font-semibold px-8"}
            >
              List Your Car Free
            </Link>
            <Link
              href="/login"
              className={buttonVariants({ size: "lg", variant: "outline" }) + " border-white/30 text-white hover:bg-white/10 px-8"}
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────── */}
      <footer className="bg-primary text-white/60 py-12">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
            <div className="col-span-2 md:col-span-1">
              <p className="font-bold text-white text-lg mb-3 tracking-tight">GAADIIQ</p>
              <p className="text-sm leading-relaxed">
                India&apos;s AI-first automotive intelligence platform. Smarter car buying and selling.
              </p>
            </div>
            <div>
              <p className="font-semibold text-white text-sm mb-3">Buy</p>
              <ul className="space-y-2 text-sm">
                <li><Link href="/listings" className="hover:text-white transition-colors">All Cars</Link></li>
                <li><Link href="/listings?listing_type=used" className="hover:text-white transition-colors">Used Cars</Link></li>
                <li><Link href="/listings?listing_type=new" className="hover:text-white transition-colors">New Cars</Link></li>
                <li><Link href="/listings?fuel_type=electric" className="hover:text-white transition-colors">Electric Cars</Link></li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-white text-sm mb-3">Sell</p>
              <ul className="space-y-2 text-sm">
                <li><Link href="/register" className="hover:text-white transition-colors">List Your Car</Link></li>
                <li><Link href="/dashboard" className="hover:text-white transition-colors">Seller Dashboard</Link></li>
                <li><Link href="/dashboard/listings/new" className="hover:text-white transition-colors">Add Listing</Link></li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-white text-sm mb-3">Tools</p>
              <ul className="space-y-2 text-sm">
                <li><Link href="/compare" className="hover:text-white transition-colors">Compare Cars</Link></li>
                <li><Link href="/tco" className="hover:text-white transition-colors">TCO Calculator</Link></li>
                <li><Link href="/recommend" className="hover:text-white transition-colors">AI Advisor</Link></li>
                <li><a href="mailto:support@gaadiiq.com" className="hover:text-white transition-colors">Contact Us</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/10 pt-6 flex flex-col md:flex-row items-center justify-between gap-2 text-xs">
            <p>© {new Date().getFullYear()} GAADIIQ. All rights reserved.</p>
            <p>Built for India&apos;s car buyers and sellers.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
