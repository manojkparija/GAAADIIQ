"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL;
      if (!apiUrl) throw new Error("API URL not configured.");

      const res = await fetch(`${apiUrl}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? "Something went wrong. Please try again.");
      }

      setSubmitted(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-6rem)] surface-royal flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-card panel-royal rounded-sm p-8 md:p-10">
          <div className="mb-8">
            <Link href="/" className="inline-block font-display font-semibold text-2xl tracking-[0.08em] text-foreground mb-5">
              <span className="text-accent">✦</span> GAADIIQ
            </Link>
            <p className="text-[11px] uppercase tracking-[0.22em] text-accent-readable font-medium mb-2">Security</p>
            <h1 className="text-3xl font-display font-semibold">Forgot your password?</h1>
            <div className="gold-rule mt-3 mb-3" />
            <p className="text-sm text-muted-foreground font-light">
              Enter your email and we&apos;ll send you a reset link.
            </p>
          </div>

          {submitted ? (
            <div className="text-center py-4">
              <div className="mx-auto mb-4 h-12 w-12 border border-accent/40 bg-accent/10 flex items-center justify-center text-accent">
                <Mail className="h-5 w-5" aria-hidden />
              </div>
              <p className="font-display font-semibold text-xl mb-2">Check your inbox</p>
              <p className="text-sm text-muted-foreground mb-6 font-light">
                If an account exists for <strong>{email}</strong>, a password reset link has been sent. It expires in 1 hour.
              </p>
              <Link href="/login" className={buttonVariants({ variant: "outline" }) + " w-full rounded-sm"}>
                Back to Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
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
                    Sending…
                  </span>
                ) : "Send Reset Link"}
              </button>
            </form>
          )}
        </div>

        <p className="text-sm text-muted-foreground text-center mt-6 font-light">
          Remembered it?{" "}
          <Link href="/login" className="text-accent-readable font-semibold hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
