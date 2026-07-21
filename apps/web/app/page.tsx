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
  { label: "SUV",         href: "/listings?body_type=suv",        emoji: "🚙" },
  { label: "Hatchback",   href: "/listings?body_type=hatchback",  emoji: "🚗" },
  { label: "Sedan",       href: "/listings?body_type=sedan",      emoji: "🚘" },
  { label: "MUV / MPV",   href: "/listings?body_type=muv",        emoji: "🚐" },
  { label: "Electric",    href: "/listings?fuel_type=electric",   emoji: "⚡" },
  { label: "Luxury",      href: "/listings?min_price=3000000",    emoji: "✨" },
];

const BUDGET_RANGES = [
  { label: "Under ₹5L",    href: "/listings?max_price=500000" },
  { label: "₹5L – ₹10L",  href: "/listings?min_price=500000&max_price=1000000" },
  { label: "₹10L – ₹20L", href: "/listings?min_price=1000000&max_price=2000000" },
  { label: "₹20L – ₹50L", href: "/listings?min_price=2000000&max_price=5000000" },
  { label: "Above ₹50L",  href: "/listings?min_price=5000000" },
];

const WHY_ITEMS = [
  { title: "AI Price Valuation",  desc: "Instant fair-market price for any car." },
  { title: "Loan Comparison",     desc: "Compare EMI from top banks in minutes." },
  { title: "Verified Listings",   desc: "No fake ads, no hidden charges." },
  { title: "Test Drive Booking",  desc: "Book directly with the seller, online." },
  { title: "Market Intelligence", desc: "Real-time depreciation and price trends." },
  { title: "Price Drop Alerts",   desc: "Get notified when your target car drops." },
];

export default function HomePage() {
  return (
    <main className="flex flex-col min-h-screen bg-white">

      {/* ── HERO BANNER ───────────────────────────────────────────── */}
      <section className="bg-[#f7f7f7] border-b">
        <div className="max-w-7xl mx-auto px-4 py-10 md:py-16 flex flex-col md:flex-row items-center gap-8">
          {/* Text side */}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#F15B22] mb-2">
              India&apos;s AI-First Marketplace
            </p>
            <h1 className="text-3xl md:text-5xl font-bold text-[#111] leading-tight mb-4">
              Find Your Perfect Car
            </h1>
            <p className="text-gray-500 text-base mb-6 max-w-sm">
              50,000+ verified listings. AI valuation, loan compare, and test drive — all in one place.
            </p>
            <div className="flex gap-3 flex-wrap">
              <Link
                href="/listings?listing_type=new"
                className="px-5 py-2.5 bg-[#F15B22] text-white text-sm font-semibold rounded-md hover:bg-[#d44e1c] transition-colors"
              >
                New Cars
              </Link>
              <Link
                href="/listings?listing_type=used"
                className="px-5 py-2.5 border-2 border-[#F15B22] text-[#F15B22] text-sm font-semibold rounded-md hover:bg-orange-50 transition-colors"
              >
                Used Cars
              </Link>
            </div>
          </div>

          {/* Illustration placeholder */}
          <div className="shrink-0 w-full md:w-96 h-52 md:h-60 bg-white rounded-2xl border flex items-center justify-center overflow-hidden shadow-sm">
            <div className="text-center">
              <div className="text-8xl mb-2">🚗</div>
              <p className="text-xs text-gray-400 font-medium">Car Image</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── BODY TYPE TABS ────────────────────────────────────────── */}
      <section className="py-10 bg-white border-b">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-[#111]">Browse by Type</h2>
            <Link href="/listings" className="text-sm text-[#F15B22] font-medium flex items-center gap-0.5 hover:underline">
              View all <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Tab-style body type selector */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {BODY_TYPES.map((type) => (
              <Link
                key={type.label}
                href={type.href}
                className="flex-shrink-0 flex flex-col items-center gap-2 px-5 py-3 rounded-xl border-2 border-transparent hover:border-[#F15B22] hover:bg-orange-50 transition-all group"
              >
                <span className="text-2xl">{type.emoji}</span>
                <span className="text-xs font-semibold text-gray-700 group-hover:text-[#F15B22] whitespace-nowrap">
                  {type.label}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── BROWSE BY BRAND ───────────────────────────────────────── */}
      <section className="py-10 bg-[#f7f7f7] border-b">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-[#111]">Popular Brands</h2>
            <Link href="/cars" className="text-sm text-[#F15B22] font-medium flex items-center gap-0.5 hover:underline">
              All brands <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
            {POPULAR_MAKES.map((make, i) => (
              <Link
                key={make.name}
                href={`/listings?make=${encodeURIComponent(make.name)}`}
                className="anim-card flex flex-col items-center gap-2 p-3 rounded-xl bg-white border hover:border-[#F15B22]/50 hover:shadow-sm transition-all"
                style={{ "--i": i } as React.CSSProperties}
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-xs"
                  style={{ backgroundColor: make.color }}
                >
                  {make.short}
                </div>
                <span className="text-xs font-medium text-center leading-tight text-gray-700">{make.name}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── BROWSE BY BUDGET ──────────────────────────────────────── */}
      <section className="py-10 bg-white border-b">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="text-xl font-bold text-[#111] mb-6">Browse by Budget</h2>
          <div className="flex flex-wrap gap-2.5">
            {BUDGET_RANGES.map((b) => (
              <Link
                key={b.label}
                href={b.href}
                className="px-4 py-2 rounded-full border text-sm font-medium text-gray-700 hover:border-[#F15B22] hover:text-[#F15B22] hover:bg-orange-50 transition-colors"
              >
                {b.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY GAADIIQ ───────────────────────────────────────────── */}
      <section className="py-12 bg-[#f7f7f7]">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="text-xl font-bold text-[#111] mb-2">Why GAADIIQ?</h2>
          <p className="text-gray-500 text-sm mb-8">Your intelligent car-buying co-pilot.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {WHY_ITEMS.map((f, i) => (
              <div
                key={f.title}
                className="anim-card p-5 rounded-xl bg-white border hover:shadow-sm transition-shadow"
                style={{ "--i": i } as React.CSSProperties}
              >
                <div className="w-2 h-2 rounded-full bg-[#F15B22] mb-3" />
                <h3 className="font-bold text-sm text-[#111] mb-1">{f.title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SELL CTA ──────────────────────────────────────────────── */}
      <section className="py-12 bg-[#111]">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <h2 className="text-2xl font-bold text-white mb-2">Ready to Sell?</h2>
          <p className="text-gray-400 mb-7 max-w-sm mx-auto text-sm">
            List free, reach thousands of buyers, get AI valuation instantly.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link
              href="/register"
              className="px-6 py-2.5 bg-[#F15B22] text-white text-sm font-semibold rounded-md hover:bg-[#d44e1c] transition-colors"
            >
              List Your Car Free
            </Link>
            <Link
              href="/login"
              className="px-6 py-2.5 border border-white/20 text-white text-sm font-medium rounded-md hover:bg-white/10 transition-colors"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────── */}
      <footer className="bg-[#1a1a1a] text-gray-400 py-10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
            <div className="col-span-2 md:col-span-1">
              <p className="font-bold text-white mb-2 tracking-tight">GAADIIQ</p>
              <p className="text-xs leading-relaxed">India&apos;s AI-first car marketplace.</p>
            </div>
            <div>
              <p className="font-semibold text-white text-xs mb-3 uppercase tracking-wider">Buy</p>
              <ul className="space-y-1.5 text-xs">
                <li><Link href="/listings" className="hover:text-white transition-colors">All Cars</Link></li>
                <li><Link href="/listings?listing_type=used" className="hover:text-white transition-colors">Used Cars</Link></li>
                <li><Link href="/listings?listing_type=new" className="hover:text-white transition-colors">New Cars</Link></li>
                <li><Link href="/listings?fuel_type=electric" className="hover:text-white transition-colors">Electric</Link></li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-white text-xs mb-3 uppercase tracking-wider">Sell</p>
              <ul className="space-y-1.5 text-xs">
                <li><Link href="/register" className="hover:text-white transition-colors">List Your Car</Link></li>
                <li><Link href="/dashboard" className="hover:text-white transition-colors">Dashboard</Link></li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-white text-xs mb-3 uppercase tracking-wider">Tools</p>
              <ul className="space-y-1.5 text-xs">
                <li><Link href="/compare" className="hover:text-white transition-colors">Compare Cars</Link></li>
                <li><Link href="/tco" className="hover:text-white transition-colors">TCO Calculator</Link></li>
                <li><Link href="/recommend" className="hover:text-white transition-colors">AI Advisor</Link></li>
                <li><Link href="/diagnosis" className="hover:text-white transition-colors">AI Diagnosis</Link></li>
                <li><a href="mailto:support@gaadiiq.com" className="hover:text-white transition-colors">Contact</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/10 pt-5 text-xs flex flex-col md:flex-row items-center justify-between gap-1">
            <p>© {new Date().getFullYear()} GAADIIQ. All rights reserved.</p>
            <p>Built for India&apos;s car buyers and sellers.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
