"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUSES = ["pending", "confirmed", "cancelled", "completed"] as const;
type Status = (typeof STATUSES)[number];

export default function BookingStatusSelect({
  bookingId,
  current,
  token,
}: {
  bookingId: string;
  current: Status;
  token: string;
}) {
  const [status, setStatus] = useState<Status>(current);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleChange(next: Status) {
    if (next === status) return;
    setLoading(true);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    await fetch(`${apiUrl}/bookings/${bookingId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: next }),
    });
    setStatus(next);
    router.refresh();
    setLoading(false);
  }

  return (
    <select
      disabled={loading}
      value={status}
      onChange={(e) => handleChange(e.target.value as Status)}
      className="border rounded-md px-2 py-1 text-xs bg-background disabled:opacity-50"
    >
      {STATUSES.map((s) => (
        <option key={s} value={s} className="capitalize">{s}</option>
      ))}
    </select>
  );
}
