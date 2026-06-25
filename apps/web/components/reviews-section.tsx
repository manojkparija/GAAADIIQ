"use client";

import { useState } from "react";
import ReviewForm from "@/components/review-form";
import ReviewList from "@/components/review-list";

interface Props {
  listingId: string;
  sellerId: string;
}

export default function ReviewsSection({ listingId, sellerId }: Props) {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <section className="mt-12 border-t pt-8 space-y-6">
      <h2 className="text-xl font-bold">Reviews</h2>
      <ReviewList listingId={listingId} sellerId={sellerId} onReviewAdded={refreshKey} />
      <ReviewForm listingId={listingId} onSubmitted={() => setRefreshKey((k) => k + 1)} />
    </section>
  );
}
