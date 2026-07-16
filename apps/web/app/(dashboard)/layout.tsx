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
      <aside className="w-60 shrink-0 bg-primary flex flex-col pt-8 px-4 gap-0.5 border-r border-accent/20">
        <Link href="/" className="px-2 mb-6 font-display text-xl font-semibold tracking-[0.08em] text-primary-foreground">
          <span className="text-accent">✦</span> GAADIIQ
        </Link>
        <div className="gold-rule mb-5 ml-2" />
        <p className="font-display text-primary-foreground/40 text-[10px] uppercase tracking-[0.22em] mb-3 px-2">
          Dashboard
        </p>
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-sm px-3 py-2.5 text-[13px] font-medium tracking-wide text-primary-foreground/60 hover:bg-white/8 hover:text-accent border-l-2 border-transparent hover:border-accent/60 transition-colors"
          >
            {link.label}
          </Link>
        ))}
        <div className="mt-auto pb-8 border-t border-white/10 pt-4">
          <p className="text-[10px] tracking-wide text-primary-foreground/35 px-2 truncate">{session.user.email}</p>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-8 md:p-10 surface-royal">
        {children}
      </main>
    </div>
  );
}
