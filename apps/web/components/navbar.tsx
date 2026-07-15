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
    <header className="sticky top-0 z-40 w-full bg-white border-b shadow-sm">
      {/* ── Top row: logo + search + auth ── */}
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">
        {/* Logo */}
        <Link href="/" className="shrink-0 flex items-center gap-1.5 font-bold text-lg tracking-tight">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="11" fill="#F15B22" />
            <text x="11" y="15.5" textAnchor="middle" fontSize="12" fontWeight="800" fill="white" fontFamily="system-ui">G</text>
          </svg>
          <span className="text-[#111]">GAADIIQ</span>
        </Link>

        {/* Search — dominant center */}
        <div className="flex-1 hidden md:block">
          <SearchBar className="w-full max-w-xl mx-auto" placeholder="Search brand, model, or ask AI…" />
        </div>

        {/* Utility row */}
        <div className="hidden md:flex items-center gap-1 shrink-0">
          <ThemeToggle />
          {session ? (
            <>
              <NotificationBell />
              <Link
                href="/dashboard"
                className="flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-[#F15B22] px-2 py-1.5 rounded-md hover:bg-orange-50 transition-colors"
              >
                <User className="h-4 w-4" />
                Dashboard
              </Link>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="text-sm text-gray-500 hover:text-gray-800 px-2 py-1.5 rounded-md hover:bg-gray-100 transition-colors"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="text-sm font-medium text-gray-700 hover:text-[#F15B22] px-3 py-1.5 rounded-md hover:bg-orange-50 transition-colors"
              >
                Login
              </Link>
              <Link
                href="/register"
                className="text-sm font-semibold bg-[#F15B22] text-white hover:bg-[#d44e1c] px-4 py-1.5 rounded-md transition-colors"
              >
                Register
              </Link>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden ml-auto p-1.5 rounded-md hover:bg-gray-100 transition-colors"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* ── Sub-nav: category tabs ── */}
      <div className="hidden md:block border-t">
        <div className="max-w-7xl mx-auto px-4">
          <nav className="flex items-center gap-0 h-9 text-sm">
            {NAV_LINKS.map((link) => {
              const basePath = link.href.split("?")[0];
              const active = pathname === basePath || (basePath !== "/" && pathname.startsWith(basePath));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 h-full flex items-center border-b-2 font-medium transition-colors whitespace-nowrap
                    ${active
                      ? "border-[#F15B22] text-[#F15B22]"
                      : "border-transparent text-gray-600 hover:text-[#F15B22] hover:border-[#F15B22]/40"
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
        <div className="md:hidden border-t bg-white px-4 py-4 flex flex-col gap-2">
          <SearchBar className="w-full mb-1" placeholder="Search brand, model…" />
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-orange-50 hover:text-[#F15B22] transition-colors"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <div className="border-t pt-3 mt-1 flex flex-col gap-2">
            {session ? (
              <>
                <Link
                  href="/dashboard"
                  className="text-sm font-medium text-center py-2 border rounded-md hover:bg-gray-50"
                  onClick={() => setMobileOpen(false)}
                >
                  Dashboard
                </Link>
                <button
                  onClick={() => { signOut({ callbackUrl: "/" }); setMobileOpen(false); }}
                  className="text-sm text-gray-500 text-center py-2"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="text-sm font-medium text-center py-2 border rounded-md hover:bg-gray-50"
                  onClick={() => setMobileOpen(false)}
                >
                  Login
                </Link>
                <Link
                  href="/register"
                  className="text-sm font-semibold text-center py-2 bg-[#F15B22] text-white rounded-md hover:bg-[#d44e1c]"
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
