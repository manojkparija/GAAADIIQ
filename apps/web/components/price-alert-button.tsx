"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Bell, BellOff } from "lucide-react";

interface Props {
  listingId: string;
}

export default function PriceAlertButton({ listingId }: Props) {
  const { data: session } = useSession();
  const router = useRouter();
  const token = (session as { accessToken?: string })?.accessToken;

  const [subscribed, setSubscribed] = useState(false);
  const [alertId, setAlertId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

  useEffect(() => {
    if (!token) return;
    fetch(`${apiUrl}/price-alerts/listing/${listingId}/subscribed`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => {
        setSubscribed(d.subscribed);
        setAlertId(d.alert_id);
        setChecked(true);
      })
      .catch(() => setChecked(true));
  }, [token, listingId, apiUrl]);

  async function toggle() {
    if (!token) {
      router.push("/login");
      return;
    }
    setLoading(true);
    try {
      if (subscribed && alertId) {
        await fetch(`${apiUrl}/price-alerts/${alertId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        setSubscribed(false);
        setAlertId(null);
      } else {
        const r = await fetch(
          `${apiUrl}/price-alerts?listing_id=${listingId}`,
          { method: "POST", headers: { Authorization: `Bearer ${token}` } }
        );
        if (r.ok) {
          const d = await r.json();
          setSubscribed(true);
          setAlertId(d.id);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  if (!checked && !token) return null;

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`w-full flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
        subscribed
          ? "border-primary bg-primary/5 text-primary hover:bg-primary/10"
          : "border-muted-foreground/30 hover:border-primary hover:text-primary"
      } disabled:opacity-50`}
    >
      {subscribed ? (
        <>
          <Bell className="h-4 w-4" aria-hidden />
          Alerting on price drop
        </>
      ) : (
        <>
          <BellOff className="h-4 w-4" aria-hidden />
          Alert me on price drop
        </>
      )}
    </button>
  );
}
