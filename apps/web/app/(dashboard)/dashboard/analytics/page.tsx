import { auth } from "@/auth";
import StarRating from "@/components/star-rating";

interface ListingAnalytics {
  listing_id: string;
  title: string;
  price: number;
  views: number;
  bookings: number;
  loan_inquiries: number;
  reviews: number;
  avg_rating: number | null;
  is_active: boolean;
}

interface SellerAnalytics {
  total_listings: number;
  active_listings: number;
  total_views: number;
  total_bookings: number;
  total_loan_inquiries: number;
  total_reviews: number;
  overall_avg_rating: number | null;
  listings: ListingAnalytics[];
}

async function getAnalytics(token: string): Promise<SellerAnalytics | null> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  try {
    const r = await fetch(`${apiUrl}/dealers/me/analytics`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

function formatINR(n: number) {
  if (n >= 10_00_000) return `₹${(n / 10_00_000).toFixed(2)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(0)}K`;
  return `₹${n}`;
}

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
}

function StatCard({ label, value, sub }: StatCardProps) {
  return (
    <div className="rounded-xl border p-5">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-display font-semibold mt-1">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export default async function AnalyticsPage() {
  const session = await auth();
  const token = (session as { accessToken?: string })?.accessToken ?? "";
  const data = await getAnalytics(token);

  if (!data) {
    return (
      <div className="max-w-4xl space-y-6">
        <h1 className="text-3xl font-display font-semibold">Analytics</h1>
        <div className="rounded-xl border p-12 text-center text-muted-foreground text-sm">
          Could not load analytics. Please try again later.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-3xl font-display font-semibold mb-1">Analytics</h1>
        <p className="text-muted-foreground text-sm">Performance overview for your listings.</p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <StatCard label="Total listings" value={data.total_listings} sub={`${data.active_listings} active`} />
        <StatCard label="Total views" value={data.total_views.toLocaleString("en-IN")} />
        <StatCard label="Test drive leads" value={data.total_bookings} />
        <StatCard label="Loan inquiries" value={data.total_loan_inquiries} />
        <StatCard label="Reviews" value={data.total_reviews} />
        <StatCard
          label="Avg rating"
          value={data.overall_avg_rating !== null ? data.overall_avg_rating.toFixed(1) : "—"}
          sub={data.overall_avg_rating !== null ? "out of 5" : "No reviews yet"}
        />
      </div>

      {/* Per-listing breakdown */}
      {data.listings.length === 0 ? (
        <div className="rounded-xl border p-12 text-center text-muted-foreground text-sm">
          No listings yet. <a href="/dashboard/listings/new" className="text-primary hover:underline">Create your first listing →</a>
        </div>
      ) : (
        <div>
          <h2 className="text-base font-semibold mb-4">Per-Listing Breakdown</h2>
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Car</th>
                  <th className="text-left px-4 py-3 font-medium">Price</th>
                  <th className="text-right px-4 py-3 font-medium">Views</th>
                  <th className="text-right px-4 py-3 font-medium">Bookings</th>
                  <th className="text-right px-4 py-3 font-medium">Loan inqs.</th>
                  <th className="text-left px-4 py-3 font-medium">Rating</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.listings.map((l) => (
                  <tr key={l.listing_id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-medium">
                      <a href={`/listings/${l.listing_id}`} className="hover:text-primary hover:underline">
                        {l.title}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatINR(l.price)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{l.views.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{l.bookings}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{l.loan_inquiries}</td>
                    <td className="px-4 py-3">
                      {l.avg_rating !== null ? (
                        <div className="flex items-center gap-1.5">
                          <StarRating rating={l.avg_rating} size="sm" />
                          <span className="text-xs text-muted-foreground">({l.reviews})</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${l.is_active ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                        {l.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
