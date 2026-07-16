"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: "8+ characters", ok: password.length >= 8 },
    { label: "Uppercase letter", ok: /[A-Z]/.test(password) },
    { label: "Number", ok: /[0-9]/.test(password) },
  ];
  if (!password) return null;
  return (
    <div className="flex gap-3 mt-1.5">
      {checks.map((c) => (
        <span key={c.label} className={`text-[11px] tracking-wide flex items-center gap-1 ${c.ok ? "text-success" : "text-muted-foreground"}`}>
          {c.ok ? "✓" : "○"} {c.label}
        </span>
      ))}
    </div>
  );
}

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    setError("");

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL;
      if (!apiUrl) {
        throw new Error("API URL not configured. Please contact support.");
      }

      const res = await fetch(`${apiUrl}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, full_name: fullName }),
      });

      if (!res.ok) {
        let detail = "Registration failed. Please try again.";
        try {
          const data = await res.json();
          if (res.status === 409 || (typeof data.detail === "string" && data.detail.toLowerCase().includes("exist"))) {
            detail = "An account with this email already exists. Please sign in.";
          } else if (typeof data.detail === "string") {
            detail = data.detail;
          }
        } catch { /* ignore JSON parse errors */ }
        throw new Error(detail);
      }

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        router.push("/login?registered=1");
        return;
      }
      router.push("/dashboard");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-6rem)] flex">
      <aside className="hidden md:flex w-[42%] hero-navy relative items-end p-12">
        <div>
          <p className="font-display text-5xl font-semibold tracking-[0.08em] text-primary-foreground mb-4">
            <span className="text-accent">✦</span> GAADIIQ
          </p>
          <div className="gold-rule-lg mb-5" />
          <p className="text-primary-foreground/65 text-sm font-light leading-relaxed max-w-xs">
            Join India&apos;s private gallery for considered car buying and selling.
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
              <p className="text-[11px] uppercase tracking-[0.22em] text-accent-readable font-medium mb-2">Membership</p>
              <h1 className="text-3xl font-display font-semibold text-foreground">Create your account</h1>
              <div className="gold-rule mt-3 mb-3" />
              <p className="text-sm text-muted-foreground font-light">
                Begin with India&apos;s premier automotive platform
              </p>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="fullName" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Full Name
                </label>
                <input
                  id="fullName"
                  type="text"
                  autoComplete="name"
                  placeholder="Rahul Sharma"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="input-royal"
                />
              </div>

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
                <label htmlFor="password" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  placeholder="Create a strong password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-royal"
                />
                <PasswordStrength password={password} />
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
                    Creating account…
                  </span>
                ) : "Create Account"}
              </button>

              <p className="text-xs text-muted-foreground text-center font-light">
                By registering, you agree to our terms of service and privacy policy.
              </p>
            </form>
          </div>

          <p className="text-sm text-muted-foreground text-center mt-6 font-light">
            Already have an account?{" "}
            <Link href="/login" className="text-accent-readable font-semibold hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
