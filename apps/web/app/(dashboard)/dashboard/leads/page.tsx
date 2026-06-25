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

interface LoanInquiry {
  id: string;
  listing_id: string;
  loan_amount: number | null;
  tenure_months: number | null;
  employment_type: string | null;
  annual_income: number | null;
  status: string;
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

async function getReceivedLoanInquiries(token: string): Promise<LoanInquiry[]> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  try {
    const res = await fetch(`${apiUrl}/loans/inquiries/received`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

function formatINR(n: number) {
  if (n >= 10_00_000) return `₹${(n / 10_00_000).toFixed(2)}L`;
  return `₹${(n / 1_000).toFixed(0)}K`;
}

const BOOKING_STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  confirmed: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

const LOAN_STATUS_COLORS: Record<string, string> = {
  submitted: "bg-yellow-100 text-yellow-800",
  processing: "bg-blue-100 text-blue-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

export default async function LeadsPage() {
  const session = await auth();
  const token = (session as { accessToken?: string })?.accessToken ?? "";
  const [bookings, loanInquiries] = await Promise.all([
    getReceivedBookings(token),
    getReceivedLoanInquiries(token),
  ]);

  return (
    <div className="max-w-4xl space-y-10">
      <div>
        <h1 className="text-2xl font-bold mb-1">Leads</h1>
        <p className="text-muted-foreground text-sm">
          Test drive requests and loan inquiries on your listings.
        </p>
      </div>

      {/* Test Drive Bookings */}
      <section>
        <h2 className="text-base font-semibold mb-4">Test Drive Requests</h2>
        {bookings.length === 0 ? (
          <div className="rounded-xl border p-10 text-center text-muted-foreground text-sm">
            No test drive requests yet.
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
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${BOOKING_STATUS_COLORS[booking.status] ?? ""}`}>
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
      </section>

      {/* Loan Inquiries */}
      <section>
        <h2 className="text-base font-semibold mb-4">Loan Inquiries</h2>
        {loanInquiries.length === 0 ? (
          <div className="rounded-xl border p-10 text-center text-muted-foreground text-sm">
            No loan inquiries yet.
          </div>
        ) : (
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-left px-4 py-3 font-medium">Loan Amount</th>
                  <th className="text-left px-4 py-3 font-medium">Tenure</th>
                  <th className="text-left px-4 py-3 font-medium">Employment</th>
                  <th className="text-left px-4 py-3 font-medium">Income</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loanInquiries.map((inquiry) => (
                  <tr key={inquiry.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(inquiry.created_at).toLocaleDateString("en-IN")}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {inquiry.loan_amount ? formatINR(inquiry.loan_amount) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {inquiry.tenure_months ? `${inquiry.tenure_months} mo` : "—"}
                    </td>
                    <td className="px-4 py-3 capitalize text-muted-foreground">
                      {inquiry.employment_type?.replace("_", " ") ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {inquiry.annual_income ? formatINR(inquiry.annual_income) + " p.a." : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${LOAN_STATUS_COLORS[inquiry.status] ?? ""}`}>
                        {inquiry.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
