"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  listing_id: string | null;
  is_read: boolean;
  created_at: string;
}

const TYPE_ICONS: Record<string, string> = {
  booking_received: "🚗",
  booking_confirmed: "✅",
  booking_cancelled: "❌",
  loan_inquiry_received: "💰",
  price_drop: "📉",
  listing_viewed: "👁",
  system: "🔔",
};

export default function NotificationsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const token = (session as { accessToken?: string })?.accessToken;

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  const fetchNotifications = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch(`${apiUrl}/notifications?limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) setNotifications(await r.json());
    } finally {
      setLoading(false);
    }
  }, [token, apiUrl]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  async function markRead(id: string) {
    if (!token) return;
    await fetch(`${apiUrl}/notifications/${id}/read`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
    });
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
  }

  async function markAllRead() {
    if (!token) return;
    await fetch(`${apiUrl}/notifications/mark-all-read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }

  const unread = notifications.filter((n) => !n.is_read).length;

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          {unread > 0 && (
            <p className="text-sm text-muted-foreground mt-0.5">{unread} unread</p>
          )}
        </div>
        {unread > 0 && (
          <button
            onClick={markAllRead}
            className="text-sm text-primary hover:underline"
          >
            Mark all read
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-20 text-muted-foreground text-sm">Loading…</div>
      ) : notifications.length === 0 ? (
        <div className="rounded-xl border p-16 text-center">
          <p className="text-4xl mb-3">🔔</p>
          <p className="font-medium">No notifications yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            You'll get alerts for bookings, inquiries, and price drops here.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border divide-y overflow-hidden">
          {notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => !n.is_read && markRead(n.id)}
              className={`flex gap-4 px-5 py-4 cursor-pointer hover:bg-muted/40 transition-colors ${
                !n.is_read ? "bg-primary/5" : ""
              }`}
            >
              <span className="text-xl shrink-0 mt-0.5">{TYPE_ICONS[n.type] ?? "🔔"}</span>
              <div className="flex-1 min-w-0">
                <p className={`text-sm leading-snug ${!n.is_read ? "font-semibold" : ""}`}>
                  {n.title}
                </p>
                {n.body && (
                  <p className="text-sm text-muted-foreground mt-0.5">{n.body}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(n.created_at).toLocaleDateString("en-IN", {
                    weekday: "short", day: "numeric", month: "short",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </p>
              </div>
              {!n.is_read && (
                <span className="w-2.5 h-2.5 rounded-full bg-primary shrink-0 mt-1.5" />
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
