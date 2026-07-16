"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

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
        <div className="bg-success/10 border border-success/30 text-success text-sm px-4 py-3 rounded-lg">
          {success}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-semibold">
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
          className="border rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="text-sm font-semibold">
            Password
          </label>
          <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-primary transition-colors">
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
            Signing in…
          </span>
        ) : "Sign In"}
      </button>
    </form>
  );
}

import { Suspense } from "react";

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-surface-alt flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-2xl shadow-lg border p-8">
          <div className="text-center mb-8">
            <Link href="/" className="inline-block font-display font-semibold text-2xl text-primary mb-4 tracking-wide">
              <span className="text-accent">✦</span> GAADIIQ
            </Link>
            <h1 className="text-2xl font-display font-semibold">Welcome back</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Sign in to your GAADIIQ account
            </p>
          </div>
          <Suspense fallback={<div className="h-48 animate-pulse rounded-lg bg-muted" />}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="text-sm text-muted-foreground text-center mt-6">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="text-primary font-semibold hover:underline">
            Register free
          </Link>
        </p>
      </div>
    </main>
  );
}
