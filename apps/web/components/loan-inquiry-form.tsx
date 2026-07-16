"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EMPLOYMENT_TYPES = [
  { value: "salaried", label: "Salaried" },
  { value: "self_employed", label: "Self Employed" },
  { value: "business", label: "Business Owner" },
];

interface Props {
  listingId: string;
  listingPrice: number;
}

export default function LoanInquiryForm({ listingId, listingPrice }: Props) {
  const { data: session } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    loan_amount: Math.round(listingPrice * 0.8),
    tenure_months: 60,
    employment_type: "salaried",
    annual_income: "",
  });

  const token = (session as { accessToken?: string })?.accessToken ?? "";
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) { router.push("/login"); return; }

    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiUrl}/loans/inquiries`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          listing_id: listingId,
          loan_amount: form.loan_amount,
          tenure_months: form.tenure_months,
          employment_type: form.employment_type,
          annual_income: parseFloat(form.annual_income),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? "Submission failed");
      }
      setSuccess(true);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-xl border p-5 text-center space-y-2">
        <p className="text-2xl">✅</p>
        <p className="font-semibold text-sm">Loan inquiry submitted!</p>
        <p className="text-xs text-muted-foreground">
          Our lending partners will contact you within 24 hours.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border p-5">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">🏦</span>
        <h3 className="font-semibold text-sm">Check Loan Eligibility</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Get pre-approved in minutes with our lending partners.
      </p>

      {!open ? (
        <Button
          className="w-full"
          onClick={() => session ? setOpen(true) : router.push("/login")}
        >
          {session ? "Apply for Loan" : "Sign in to Apply"}
        </Button>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="loan_amt">Loan Amount (₹)</Label>
            <Input
              id="loan_amt"
              type="number"
              min={50000}
              required
              value={form.loan_amount}
              onChange={(e) => setForm({ ...form, loan_amount: parseInt(e.target.value) })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tenure">Tenure (months)</Label>
              <select
                id="tenure"
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                value={form.tenure_months}
                onChange={(e) => setForm({ ...form, tenure_months: parseInt(e.target.value) })}
              >
                {[12, 24, 36, 48, 60, 72, 84].map((t) => (
                  <option key={t} value={t}>{t} months ({t / 12} yr{t > 12 ? "s" : ""})</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp_type">Employment</Label>
              <select
                id="emp_type"
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                value={form.employment_type}
                onChange={(e) => setForm({ ...form, employment_type: e.target.value })}
              >
                {EMPLOYMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="income">Annual Income (₹)</Label>
            <Input
              id="income"
              type="number"
              min={100000}
              required
              placeholder="e.g. 1200000"
              value={form.annual_income}
              onChange={(e) => setForm({ ...form, annual_income: e.target.value })}
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? "Submitting…" : "Submit Application"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setOpen(false); setError(""); }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
