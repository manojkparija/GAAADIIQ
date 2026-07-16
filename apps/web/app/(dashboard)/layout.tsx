import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

const NAV_LINKS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/listings", label: "My Listings" },
  { href: "/dashboard/listings/new", label: "Add Listing" },
  { href: "/dashboard/leads", label: "Leads" },
  { href: "/dashboard/analytics", label: "Analytics" },
  { href: "/dashboard/launch", label: "Launch" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar — navy royal */}
      <aside className="w-56 shrink-0 bg-primary flex flex-col pt-8 px-4 gap-0.5">
        <p className="font-display font-semibold text-primary-foreground/40 text-[10px] uppercase tracking-[0.2em] mb-5 px-2">
          Dashboard
        </p>
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-sm px-3 py-2 text-sm font-medium text-primary-foreground/60 hover:bg-white/10 hover:text-accent transition-colors"
          >
            {link.label}
          </Link>
        ))}
        <div className="mt-auto pb-8 border-t border-white/10 pt-4">
          <p className="text-[10px] text-primary-foreground/35 px-2 truncate">{session.user.email}</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-8">
        {children}
      </main>
    </div>
  );
}
