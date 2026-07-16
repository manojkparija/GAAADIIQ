"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import SearchBar from "@/components/search-bar";
import NotificationBell from "@/components/notification-bell";
import ThemeToggle from "@/components/theme-toggle";
import { User, Menu, X } from "lucide-react";

const NAV_LINKS = [
  { label: "New Cars",   href: "/listings?listing_type=new" },
  { label: "Used Cars",  href: "/listings?listing_type=used" },
  { label: "Electric",   href: "/listings?fuel_type=electric" },
  { label: "Brands",     href: "/cars" },
  { label: "Compare",    href: "/compare" },
  { label: "AI Advisor", href: "/recommend" },
];

export default function Navbar() {
  const { data: session } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 w-full">
      {/* ── Primary bar: navy ── */}
      <div className="bg-primary text-primary-foreground border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 h-[52px] flex items-center gap-4">
          {/* Logo — display serif */}
          <Link href="/" className="shrink-0 flex items-center gap-2 font-display text-xl font-semibold tracking-wide text-primary-foreground">
            <span className="text-accent">✦</span>
            GAADIIQ
          </Link>

          {/* Search — grows to fill center */}
          <div className="flex-1 hidden md:block">
            <SearchBar
              className="w-full max-w-lg mx-auto"
              placeholder="Search brand, model, or ask AI…"
            />
          </div>

          {/* Utility */}
          <div className="hidden md:flex items-center gap-1 shrink-0 ml-auto">
            <ThemeToggle />
            {session ? (
              <>
                <NotificationBell />
                <Link
                  href="/dashboard"
                  className="flex items-center gap-1.5 text-sm font-medium text-primary-foreground/75 hover:text-accent px-3 py-1.5 transition-colors"
                >
                  <User className="h-3.5 w-3.5" />
                  Dashboard
                </Link>
                <button
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="text-sm text-primary-foreground/50 hover:text-primary-foreground/80 px-2 py-1.5 transition-colors"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="text-sm font-medium text-primary-foreground/75 hover:text-accent px-3 py-1.5 transition-colors"
                >
                  Login
                </Link>
                <Link
                  href="/register"
                  className="text-sm font-semibold bg-accent text-accent-foreground hover:bg-accent/90 px-4 py-1.5 rounded-sm transition-colors"
                >
                  Register
                </Link>
              </>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden ml-auto p-1.5 text-primary-foreground/70 hover:text-accent transition-colors"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* ── Sub-nav: category tabs on lighter navy ── */}
      <div className="hidden md:block bg-primary/90 border-b border-white/8">
        <div className="max-w-7xl mx-auto px-4">
          <nav className="flex items-center h-8 text-[13px]">
            {NAV_LINKS.map((link) => {
              const basePath = link.href.split("?")[0];
              const active = pathname === basePath || (basePath !== "/" && pathname.startsWith(basePath));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3.5 h-full flex items-center border-b-2 font-medium tracking-wide transition-colors whitespace-nowrap
                    ${active
                      ? "border-accent text-accent"
                      : "border-transparent text-primary-foreground/55 hover:text-accent hover:border-accent/40"
                    }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-primary border-t border-white/10 px-4 py-4 flex flex-col gap-1">
          <SearchBar className="w-full mb-3" placeholder="Search brand, model…" />
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="px-3 py-2.5 text-sm font-medium text-primary-foreground/70 hover:text-accent transition-colors"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <div className="border-t border-white/10 pt-3 mt-2 flex flex-col gap-2">
            {session ? (
              <>
                <Link
                  href="/dashboard"
                  className="text-sm font-medium text-center py-2.5 border border-white/20 rounded-sm text-primary-foreground/80 hover:text-accent hover:border-accent/50 transition-colors"
                  onClick={() => setMobileOpen(false)}
                >
                  Dashboard
                </Link>
                <button
                  onClick={() => { signOut({ callbackUrl: "/" }); setMobileOpen(false); }}
                  className="text-sm text-primary-foreground/50 text-center py-2"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="text-sm font-medium text-center py-2.5 border border-white/20 rounded-sm text-primary-foreground/80 hover:text-accent hover:border-accent/50 transition-colors"
                  onClick={() => setMobileOpen(false)}
                >
                  Login
                </Link>
                <Link
                  href="/register"
                  className="text-sm font-semibold text-center py-2.5 bg-accent text-accent-foreground rounded-sm hover:bg-accent/90 transition-colors"
                  onClick={() => setMobileOpen(false)}
                >
                  Register Free
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
