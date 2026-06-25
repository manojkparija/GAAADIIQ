"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

export default function Navbar() {
  const { data: session } = useSession();

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="font-bold text-xl tracking-tight text-primary">
          GAADIIQ
        </Link>

        {/* Nav links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          <Link href="/listings" className="text-muted-foreground hover:text-foreground transition-colors">
            Explore Cars
          </Link>
          <Link href="/listings?listing_type=used" className="text-muted-foreground hover:text-foreground transition-colors">
            Used Cars
          </Link>
          <Link href="/listings?listing_type=new" className="text-muted-foreground hover:text-foreground transition-colors">
            New Cars
          </Link>
        </nav>

        {/* Auth */}
        <div className="flex items-center gap-3">
          {session ? (
            <>
              <span className="hidden md:block text-sm text-muted-foreground truncate max-w-[140px]">
                {session.user?.email}
              </span>
              <Button variant="outline" size="sm" onClick={() => signOut({ callbackUrl: "/" })}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm">Sign in</Button>
              </Link>
              <Link href="/register">
                <Button size="sm">Register</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
