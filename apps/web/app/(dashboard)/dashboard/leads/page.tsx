import { auth } from "@/auth";
import BookingStatusSelect from "./booking-status-select";

interface Booking {
  id: string;
  listing_id: string;
  user_id: string;
  preferred_date: string | null;
  preferred_time: string | null;
  status: "pending" | "confirmed" | "cancelled" | "completed";
  notes: string | null;
  created_at: string;
}

async function getReceivedBookings(token: string): Promise<Booking[]> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  try {
    const res = await fetch(`${apiUrl}/bookings/received`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  confirmed: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

export default async function LeadsPage() {
  const session = await auth();
  const token = (session as { accessToken?: string })?.accessToken ?? "";
  const bookings = await getReceivedBookings(token);

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold mb-2">Leads</h1>
      <p className="text-muted-foreground text-sm mb-8">
        Test drive requests on your listings.
      </p>

      {bookings.length === 0 ? (
        <div className="rounded-xl border p-12 text-center text-muted-foreground">
          <p>No test drive requests yet.</p>
          <p className="text-sm mt-2">Once buyers request test drives on your listings, they&apos;ll appear here.</p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-left px-4 py-3 font-medium">Preferred Date</th>
                <th className="text-left px-4 py-3 font-medium">Notes</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Update</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {bookings.map((booking) => (
                <tr key={booking.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(booking.created_at).toLocaleDateString("en-IN")}
                  </td>
                  <td className="px-4 py-3">
                    {booking.preferred_date
                      ? new Date(booking.preferred_date).toLocaleDateString("en-IN")
                      : "—"}
                    {booking.preferred_time && ` ${booking.preferred_time}`}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">
                    {booking.notes ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[booking.status] ?? ""}`}>
                      {booking.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <BookingStatusSelect bookingId={booking.id} current={booking.status} token={token} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
