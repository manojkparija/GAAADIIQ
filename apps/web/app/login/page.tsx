"use client";

import { useState, useEffect, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (searchParams.get("registered") === "1") {
      setSuccess("Account created! Please sign in.");
    }
  }, [searchParams]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);
    if (result?.error) {
      setError("Invalid email or password. Please try again.");
    } else {
      router.push("/dashboard");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {success && (
        <div className="bg-success/10 border border-success/30 text-success text-sm px-4 py-3 rounded-sm">
          {success}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Email Address
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          placeholder="rahul@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input-royal"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Password
          </label>
          <Link href="/forgot-password" className="text-xs text-accent-readable hover:underline">
            Forgot password?
          </Link>
        </div>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input-royal"
        />
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive text-sm px-4 py-3 rounded-sm">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="inline-flex h-10 w-full items-center justify-center rounded-sm bg-accent px-4 text-sm font-semibold tracking-wide text-accent-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <span className="w-4 h-4 border-2 border-accent-foreground/30 border-t-accent-foreground rounded-full animate-spin" />
            Signing in…
          </span>
        ) : "Sign In"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-[calc(100vh-6rem)] flex">
      {/* Navy brand panel */}
      <aside className="hidden md:flex w-[42%] hero-navy relative items-end p-12">
        <div>
          <p className="font-display text-5xl font-semibold tracking-[0.08em] text-primary-foreground mb-4">
            <span className="text-accent">✦</span> GAADIIQ
          </p>
          <div className="gold-rule-lg mb-5" />
          <p className="text-primary-foreground/65 text-sm font-light leading-relaxed max-w-xs">
            Welcome back to India&apos;s private automotive gallery.
          </p>
        </div>
      </aside>

      <div className="flex-1 surface-royal flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="bg-card panel-royal rounded-sm p-8 md:p-10">
            <div className="mb-8 md:hidden text-center">
              <Link href="/" className="inline-block font-display font-semibold text-2xl tracking-[0.08em] text-foreground">
                <span className="text-accent">✦</span> GAADIIQ
              </Link>
            </div>
            <div className="mb-8">
              <p className="text-[11px] uppercase tracking-[0.22em] text-accent-readable font-medium mb-2">Account</p>
              <h1 className="text-3xl font-display font-semibold text-foreground">Welcome back</h1>
              <div className="gold-rule mt-3 mb-3" />
              <p className="text-sm text-muted-foreground font-light">
                Sign in to your GAADIIQ account
              </p>
            </div>
            <Suspense fallback={<div className="h-48 animate-pulse rounded-sm bg-muted" />}>
              <LoginForm />
            </Suspense>
          </div>

          <p className="text-sm text-muted-foreground text-center mt-6 font-light">
            Don&apos;t have an account?{" "}
            <Link href="/register" className="text-accent-readable font-semibold hover:underline">
              Register free
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
