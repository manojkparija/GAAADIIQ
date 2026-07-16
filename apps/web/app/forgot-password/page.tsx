"use client";

import { useState } from "react";
import Link from "next/link";
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
    <main className="min-h-screen bg-surface-alt flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-2xl shadow-lg border p-8">
          <div className="text-center mb-8">
            <Link href="/" className="inline-block font-display font-semibold text-2xl text-primary mb-4 tracking-wide">
              <span className="text-accent">✦</span> GAADIIQ
            </Link>
            <h1 className="text-2xl font-display font-semibold">Forgot your password?</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Enter your email and we&apos;ll send you a reset link.
            </p>
          </div>

          {submitted ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-4">✉️</div>
              <p className="font-semibold mb-2">Check your inbox</p>
              <p className="text-sm text-muted-foreground mb-6">
                If an account exists for <strong>{email}</strong>, a password reset link has been sent. It expires in 1 hour.
              </p>
              <Link href="/login" className={buttonVariants({ variant: "outline" }) + " w-full"}>
                Back to Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="email" className="text-sm font-semibold">Email Address</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="rahul@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="border rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                />
              </div>

              {error && (
                <div className="bg-destructive/10 border border-destructive/20 text-destructive text-sm px-4 py-3 rounded-lg">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className={buttonVariants({ size: "lg" }) + " w-full disabled:opacity-60 disabled:cursor-not-allowed"}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Sending…
                  </span>
                ) : "Send Reset Link"}
              </button>
            </form>
          )}
        </div>

        <p className="text-sm text-muted-foreground text-center mt-6">
          Remembered it?{" "}
          <Link href="/login" className="text-primary font-semibold hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
