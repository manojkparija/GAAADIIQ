import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

const NAV_LINKS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/listings", label: "My Listings" },
  { href: "/dashboard/listings/new", label: "Add Listing" },
  { href: "/dashboard/leads", label: "Leads" },
  { href: "/dashboard/analytics", label: "Analytics" },
  { href: "/dashboard/launch", label: "🚀 Launch" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r bg-muted/30 flex flex-col pt-8 px-4 gap-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4 px-2">
          Dashboard
        </p>
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-lg px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            {link.label}
          </Link>
        ))}
        <div className="mt-auto pb-8">
          <p className="text-xs text-muted-foreground px-2 truncate">{session.user.email}</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-8">
        {children}
      </main>
    </div>
  );
}
