"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { buttonVariants } from "@/components/ui/button";
import SearchBar from "@/components/search-bar";
import NotificationBell from "@/components/notification-bell";
import ThemeToggle from "@/components/theme-toggle";

export default function Navbar() {
  const { data: session } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
        {/* Logo */}
        <Link href="/" className="font-bold text-xl tracking-tight text-primary shrink-0 flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M10 1L18.66 6v8L10 19 1.34 14V6L10 1z" fill="currentColor" className="text-accent" />
          </svg>
          GAADIIQ
        </Link>

        {/* Nav links — desktop */}
        <nav className="hidden md:flex items-center gap-1 text-sm font-medium">
          <Link href="/listings" className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            Explore
          </Link>
          <Link href="/listings?listing_type=used" className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            Used Cars
          </Link>
          <Link href="/listings?listing_type=new" className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            New Cars
          </Link>
          <Link href="/listings?fuel_type=electric" className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            Electric
          </Link>
          <Link href="/cars" className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            Brands
          </Link>
          <Link href="/compare" className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            Compare
          </Link>
          <Link href="/tco" className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            TCO
          </Link>
          <Link href="/recommend" className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            AI Advisor
          </Link>
        </nav>

        {/* Search bar — desktop */}
        <SearchBar className="hidden md:block w-64 lg:w-80" placeholder="Search cars…" />

        {/* Auth — desktop */}
        <div className="hidden md:flex items-center gap-2 shrink-0">
          <ThemeToggle />
          {session ? (
            <>
              <NotificationBell />
              <Link href="/dashboard" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Dashboard
              </Link>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Sign in
              </Link>
              <Link
                href="/register"
                className={buttonVariants({ size: "sm" }) + " bg-accent text-accent-foreground hover:bg-accent/90"}
              >
                Register
              </Link>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-2 rounded-md hover:bg-muted transition-colors"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {mobileOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t bg-white px-4 py-4 flex flex-col gap-2">
          <SearchBar className="w-full mb-2" placeholder="Search cars…" />
          <Link href="/listings" className="px-3 py-2 rounded-md text-sm font-medium hover:bg-muted" onClick={() => setMobileOpen(false)}>
            Explore All Cars
          </Link>
          <Link href="/listings?listing_type=used" className="px-3 py-2 rounded-md text-sm font-medium hover:bg-muted" onClick={() => setMobileOpen(false)}>
            Used Cars
          </Link>
          <Link href="/listings?listing_type=new" className="px-3 py-2 rounded-md text-sm font-medium hover:bg-muted" onClick={() => setMobileOpen(false)}>
            New Cars
          </Link>
          <Link href="/listings?fuel_type=electric" className="px-3 py-2 rounded-md text-sm font-medium hover:bg-muted" onClick={() => setMobileOpen(false)}>
            Electric Cars
          </Link>
          <div className="border-t pt-3 mt-1 flex flex-col gap-2">
            {session ? (
              <>
                <Link href="/dashboard" className={buttonVariants({ variant: "outline", size: "sm" }) + " w-full justify-center"} onClick={() => setMobileOpen(false)}>
                  Dashboard
                </Link>
                <button
                  onClick={() => { signOut({ callbackUrl: "/" }); setMobileOpen(false); }}
                  className={buttonVariants({ variant: "ghost", size: "sm" }) + " w-full justify-center"}
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className={buttonVariants({ variant: "outline", size: "sm" }) + " w-full justify-center"} onClick={() => setMobileOpen(false)}>
                  Sign in
                </Link>
                <Link
                  href="/register"
                  className={buttonVariants({ size: "sm" }) + " w-full justify-center bg-accent text-accent-foreground hover:bg-accent/90"}
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
