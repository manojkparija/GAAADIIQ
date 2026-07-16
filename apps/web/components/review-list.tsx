"use client";

import { useCallback, useEffect, useState } from "react";
import StarRating from "@/components/star-rating";

interface Review {
  id: string;
  reviewer_id: string;
  rating: number;
  title: string | null;
  body: string | null;
  is_verified: boolean;
  reviewer_name: string | null;
  created_at: string;
}

interface RatingSummary {
  seller_id: string;
  average_rating: number | null;
  review_count: number;
  rating_distribution: Record<string, number>;
}

interface Props {
  listingId: string;
  sellerId: string;
  onReviewAdded?: number; // bump to trigger refresh
}

export default function ReviewList({ listingId, sellerId, onReviewAdded }: Props) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [summary, setSummary] = useState<RatingSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [revRes, sumRes] = await Promise.all([
        fetch(`${apiUrl}/reviews/listing/${listingId}`),
        fetch(`${apiUrl}/reviews/seller/${sellerId}/summary`),
      ]);
      if (revRes.ok) setReviews(await revRes.json());
      if (sumRes.ok) setSummary(await sumRes.json());
    } finally {
      setLoading(false);
    }
  }, [listingId, sellerId, apiUrl]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { void load(); }, [load, onReviewAdded]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (loading) return <div className="text-sm text-muted-foreground py-4">Loading reviews…</div>;

  return (
    <div className="space-y-4">
      {/* Rating summary */}
      {summary && summary.review_count > 0 && (
        <div className="rounded-xl border p-4 flex items-center gap-6">
          <div className="text-center shrink-0">
            <p className="text-4xl font-bold">{summary.average_rating?.toFixed(1)}</p>
            <StarRating rating={summary.average_rating ?? 0} size="sm" />
            <p className="text-xs text-muted-foreground mt-0.5">{summary.review_count} review{summary.review_count !== 1 ? "s" : ""}</p>
          </div>
          <div className="flex-1 space-y-1 min-w-0">
            {[5, 4, 3, 2, 1].map((star) => {
              const count = summary.rating_distribution[String(star)] ?? 0;
              const pct = summary.review_count > 0 ? (count / summary.review_count) * 100 : 0;
              return (
                <div key={star} className="flex items-center gap-2 text-xs">
                  <span className="w-4 shrink-0 text-right text-muted-foreground">{star}</span>
                  <span className="text-accent shrink-0">★</span>
                  <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                    <div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-5 shrink-0 text-muted-foreground">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Individual reviews */}
      {reviews.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reviews yet. Be the first!</p>
      ) : (
        <div className="space-y-3">
          {reviews.map((rev) => (
            <div key={rev.id} className="rounded-xl border p-4 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <StarRating rating={rev.rating} size="sm" />
                  {rev.is_verified && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-success/15 text-success">
                      ✓ Verified
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {new Date(rev.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </div>
              {rev.title && <p className="text-sm font-semibold">{rev.title}</p>}
              {rev.body && <p className="text-sm text-muted-foreground leading-relaxed">{rev.body}</p>}
              {rev.reviewer_name && (
                <p className="text-xs text-muted-foreground">— {rev.reviewer_name}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
