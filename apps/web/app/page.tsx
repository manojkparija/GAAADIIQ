import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground px-4">
      {/* Hero */}
      <section className="text-center max-w-3xl mx-auto py-24">
        <div className="inline-block bg-primary/10 text-primary text-sm font-semibold px-4 py-1.5 rounded-full mb-6">
          India&apos;s AI-First Automotive Platform
        </div>
        <h1 className="text-5xl font-bold tracking-tight mb-6 leading-tight">
          Buy &amp; Sell Cars{" "}
          <span className="text-primary">Intelligently</span>
        </h1>
        <p className="text-xl text-muted-foreground mb-10 max-w-xl mx-auto">
          AI-powered car discovery, real-time valuations, loan comparisons, and
          dealer intelligence — all in one place.
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Button size="lg">Explore Cars</Button>
          <Button size="lg" variant="outline">
            Get Valuation
          </Button>
        </div>
      </section>

      {/* Feature pills */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl w-full pb-24">
        {[
          { icon: "🤖", label: "AI Search" },
          { icon: "📊", label: "Price Intelligence" },
          { icon: "🏦", label: "Loan Comparison" },
          { icon: "🚗", label: "Test Drive Booking" },
        ].map(({ icon, label }) => (
          <div
            key={label}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border bg-card text-card-foreground shadow-sm"
          >
            <span className="text-3xl">{icon}</span>
            <span className="text-sm font-medium">{label}</span>
          </div>
        ))}
      </section>

      <p className="text-xs text-muted-foreground pb-8">
        Phase 3 scaffold — full features coming soon
      </p>
    </main>
  );
}
