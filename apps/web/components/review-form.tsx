"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface Props {
  listingId: string;
  onSubmitted?: () => void;
}

export default function ReviewForm({ listingId, onSubmitted }: Props) {
  const { data: session } = useSession();
  const router = useRouter();
  const token = (session as { accessToken?: string })?.accessToken;

  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) { router.push("/login"); return; }
    if (rating === 0) { setError("Please select a rating."); return; }

    setSubmitting(true);
    setError("");
    try {
      const r = await fetch(`${apiUrl}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ listing_id: listingId, rating, title: title || null, body: body || null }),
      });
      if (r.status === 409) { setError("You have already reviewed this listing."); return; }
      if (!r.ok) { setError("Could not submit review. Please try again."); return; }
      setDone(true);
      onSubmitted?.();
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) return null;

  if (done) {
    return (
      <div className="rounded-xl border p-5 text-center bg-green-50 dark:bg-green-950">
        <p className="text-2xl mb-1">⭐</p>
        <p className="font-semibold text-green-700 dark:text-green-300">Review submitted!</p>
        <p className="text-sm text-muted-foreground mt-0.5">Thanks for sharing your experience.</p>
      </div>
    );
  }

  const display = hovered || rating;

  return (
    <div className="rounded-xl border p-5">
      <h3 className="font-semibold text-sm mb-4">Write a Review</h3>
      <form onSubmit={submit} className="space-y-4">
        {/* Star picker */}
        <div>
          <p className="text-xs text-muted-foreground mb-1.5">Your rating *</p>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setRating(s)}
                onMouseEnter={() => setHovered(s)}
                onMouseLeave={() => setHovered(0)}
                className={`text-2xl transition-colors ${s <= display ? "text-amber-400" : "text-muted-foreground/30"}`}
              >
                ★
              </button>
            ))}
          </div>
          {display > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              {["", "Poor", "Fair", "Good", "Very good", "Excellent"][display]}
            </p>
          )}
        </div>

        <div>
          <input
            type="text"
            placeholder="Summary (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div>
          <textarea
            placeholder="Tell others about your experience…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-primary text-primary-foreground py-2.5 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit Review"}
        </button>
      </form>
    </div>
  );
}
