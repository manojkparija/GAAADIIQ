"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

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

export default function NotificationBell() {
  const { data: session } = useSession();
  const token = (session as { accessToken?: string })?.accessToken;

  const [unread, setUnread] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

  const fetchUnread = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`${apiUrl}/notifications/unread-count`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) setUnread((await r.json()).unread_count);
    } catch { /* silent */ }
  }, [token, apiUrl]);

  const fetchNotifications = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`${apiUrl}/notifications?limit=8`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) setNotifications(await r.json());
    } catch { /* silent */ }
  }, [token, apiUrl]);

  // Poll unread count every 30s — async setState inside effect is intentional (data fetching)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void fetchUnread();
    const id = setInterval(() => { void fetchUnread(); }, 30_000);
    return () => clearInterval(id);
  }, [fetchUnread]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function handleOpen() {
    const next = !open;
    setOpen(next);
    if (next) await fetchNotifications();
  }

  async function markRead(id: string) {
    if (!token) return;
    await fetch(`${apiUrl}/notifications/${id}/read`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
    });
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
    setUnread((prev) => Math.max(0, prev - 1));
  }

  async function markAllRead() {
    if (!token) return;
    await fetch(`${apiUrl}/notifications/mark-all-read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnread(0);
  }

  if (!token) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        className="relative p-2 rounded-full hover:bg-muted transition-colors"
        aria-label="Notifications"
      >
        <span className="text-lg">🔔</span>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border bg-background shadow-lg z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <span className="font-semibold text-sm">Notifications</span>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-primary hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto divide-y">
            {notifications.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No notifications yet.
              </p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => !n.is_read && markRead(n.id)}
                  className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex gap-3 ${
                    !n.is_read ? "bg-primary/5" : ""
                  }`}
                >
                  <span className="text-lg shrink-0">{TYPE_ICONS[n.type] ?? "🔔"}</span>
                  <div className="min-w-0">
                    <p className={`text-sm leading-snug ${!n.is_read ? "font-semibold" : ""}`}>
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {n.body}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {new Date(n.created_at).toLocaleDateString("en-IN", {
                        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                      })}
                    </p>
                  </div>
                  {!n.is_read && (
                    <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />
                  )}
                </button>
              ))
            )}
          </div>

          <div className="border-t px-4 py-2">
            <Link
              href="/notifications"
              className="text-xs text-primary hover:underline"
              onClick={() => setOpen(false)}
            >
              View all notifications →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
