import { auth } from "@/auth";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

interface SummaryData {
  total_listings: number;
  active_listings: number;
  total_views: number;
}

async function getSummary(accessToken: string): Promise<SummaryData | null> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  try {
    const res = await fetch(`${apiUrl}/dealers/my-listings-summary`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border p-6 bg-card">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </div>
  );
}

export default async function DashboardPage() {
  const session = await auth();
  const token = (session as { accessToken?: string })?.accessToken ?? "";
  const summary = await getSummary(token);

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Overview</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Welcome back, {session?.user?.name ?? session?.user?.email}
          </p>
        </div>
        <Link href="/dashboard/listings/new" className={buttonVariants()}>
          + Add Listing
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard label="Total Listings" value={summary?.total_listings ?? 0} />
        <StatCard label="Active Listings" value={summary?.active_listings ?? 0} />
        <StatCard label="Total Views" value={summary?.total_views ?? 0} />
      </div>

      {/* Quick actions */}
      <div className="rounded-xl border p-6">
        <h2 className="font-semibold mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <Link href="/dashboard/listings" className={buttonVariants({ variant: "outline" })}>
            Manage Listings
          </Link>
          <Link href="/dashboard/leads" className={buttonVariants({ variant: "outline" })}>
            View Leads
          </Link>
          <Link href="/listings" className={buttonVariants({ variant: "outline" })}>
            Browse Marketplace
          </Link>
        </div>
      </div>
    </div>
  );
}
