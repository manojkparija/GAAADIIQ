"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: "8+ characters", ok: password.length >= 8 },
    { label: "Uppercase", ok: /[A-Z]/.test(password) },
    { label: "Number", ok: /[0-9]/.test(password) },
  ];
  if (!password) return null;
  return (
    <div className="flex gap-3 mt-1">
      {checks.map((c) => (
        <span key={c.label} className={`text-xs flex items-center gap-1 ${c.ok ? "text-success" : "text-muted-foreground"}`}>
          {c.ok ? "✓" : "○"} {c.label}
        </span>
      ))}
    </div>
  );
}

function ResetForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const tokenError = !token ? "Missing reset token. Please use the link from your email." : "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }

    setLoading(true);
    setError("");

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL;
      if (!apiUrl) throw new Error("API URL not configured.");

      const res = await fetch(`${apiUrl}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? "Reset failed. The link may have expired.");
      }

      setSuccess(true);
      setTimeout(() => router.push("/login"), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="text-center py-4">
        <CircleCheck className="h-10 w-10 mx-auto mb-4 text-success" aria-hidden />
        <p className="font-semibold mb-2">Password updated!</p>
        <p className="text-sm text-muted-foreground mb-6">
          Redirecting you to sign in…
        </p>
        <Link href="/login" className={buttonVariants({ variant: "outline" }) + " w-full"}>
          Sign In Now
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-semibold">New Password</label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="Create a strong password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
        />
        <PasswordStrength password={password} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirm" className="text-sm font-semibold">Confirm Password</label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          placeholder="Repeat your password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="border rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
        />
      </div>

      {(tokenError || error) && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive text-sm px-4 py-3 rounded-lg">
          {tokenError || error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !token}
        className={buttonVariants({ size: "lg" }) + " w-full disabled:opacity-60 disabled:cursor-not-allowed"}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Updating…
          </span>
        ) : "Set New Password"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="min-h-[calc(100vh-6rem)] surface-royal flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-card panel-royal rounded-sm p-8 md:p-10">
          <div className="mb-8">
            <Link href="/" className="inline-block font-display font-semibold text-2xl tracking-[0.08em] text-foreground mb-5">
              <span className="text-accent">✦</span> GAADIIQ
            </Link>
            <p className="text-[11px] uppercase tracking-[0.22em] text-accent-readable font-medium mb-2">Security</p>
            <h1 className="text-3xl font-display font-semibold">Set new password</h1>
            <div className="gold-rule mt-3 mb-3" />
            <p className="text-sm text-muted-foreground font-light">
              Choose a strong password for your account.
            </p>
          </div>
          <Suspense fallback={<div className="h-48 animate-pulse rounded-sm bg-muted" />}>
            <ResetForm />
          </Suspense>
        </div>

        <p className="text-sm text-muted-foreground text-center mt-6 font-light">
          <Link href="/login" className="text-accent-readable font-semibold hover:underline">
            Back to Sign In
          </Link>
        </p>
      </div>
    </main>
  );
}
