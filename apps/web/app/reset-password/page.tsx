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
    <main className="min-h-screen bg-surface-alt flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-2xl shadow-lg border p-8">
          <div className="text-center mb-8">
            <Link href="/" className="inline-block font-bold text-2xl text-primary mb-4 tracking-tight">
              GAADIIQ
            </Link>
            <h1 className="text-2xl font-bold">Set new password</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Choose a strong password for your account.
            </p>
          </div>
          <Suspense fallback={<div className="h-48 animate-pulse rounded-lg bg-muted" />}>
            <ResetForm />
          </Suspense>
        </div>

        <p className="text-sm text-muted-foreground text-center mt-6">
          <Link href="/login" className="text-primary font-semibold hover:underline">
            Back to Sign In
          </Link>
        </p>
      </div>
    </main>
  );
}
