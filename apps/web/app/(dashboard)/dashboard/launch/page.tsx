
interface CheckItem {
  label: string;
  detail: string;
  envKey?: string;
  category: string;
}

const CHECKLIST: CheckItem[] = [
  // Infrastructure
  { category: "Database", label: "PostgreSQL (Supabase)", detail: "Set DATABASE_URL to your Supabase connection string", envKey: "DATABASE_URL" },
  { category: "Storage", label: "Cloudflare R2 bucket", detail: "Create a public R2 bucket, set R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL", envKey: "R2_BUCKET_NAME" },
  { category: "Auth", label: "NextAuth secret", detail: "Generate with: openssl rand -base64 32 and set NEXTAUTH_SECRET", envKey: "NEXTAUTH_SECRET" },
  { category: "Auth", label: "NEXTAUTH_URL", detail: "Set to your production domain e.g. https://gaadiiq.com", envKey: "NEXTAUTH_URL" },
  { category: "API", label: "NEXT_PUBLIC_API_URL", detail: "Point to your deployed FastAPI server e.g. https://api.gaadiiq.com", envKey: "NEXT_PUBLIC_API_URL" },
  { category: "API", label: "SECRET_KEY (FastAPI)", detail: "Set a strong random JWT secret in the API environment", envKey: "SECRET_KEY" },
  // Payments
  { category: "Payments", label: "Razorpay credentials", detail: "Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to activate real payment flow", envKey: "RAZORPAY_KEY_ID" },
  // Email
  { category: "Email", label: "SMTP server", detail: "Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS to send transactional emails", envKey: "SMTP_HOST" },
  // AI
  { category: "AI", label: "Ollama server", detail: "Deploy Ollama on Oracle Cloud and set OLLAMA_BASE_URL. Pull llama3 model.", envKey: "OLLAMA_BASE_URL" },
  // CORS
  { category: "Security", label: "CORS allowed origins", detail: "Update ALLOWED_ORIGINS in FastAPI config to include your production frontend URL" },
  { category: "Security", label: "HTTPS / TLS", detail: "Ensure both frontend (Vercel) and API (Cloud Run / Railway) serve over HTTPS" },
  // SEO
  { category: "SEO", label: "NEXT_PUBLIC_SITE_URL", detail: "Set to https://gaadiiq.com so sitemap.xml uses the correct domain", envKey: "NEXT_PUBLIC_SITE_URL" },
  { category: "SEO", label: "Robots & sitemap", detail: "/robots.txt and /sitemap.xml are live and served correctly by Next.js" },
  // Database migration
  { category: "Database", label: "Run Alembic migrations", detail: "alembic upgrade head against production PostgreSQL before first deploy" },
  { category: "Database", label: "Seed admin user", detail: "Create at least one user with role=admin for the admin panel" },
];

const CATEGORIES = Array.from(new Set(CHECKLIST.map((c) => c.category)));

const CATEGORY_COLORS: Record<string, string> = {
  Database: "bg-chart-2/15 text-chart-2",
  Storage:  "bg-muted text-muted-foreground",
  Auth:     "bg-success/15 text-success",
  API:      "bg-chart-5/15 text-chart-5",
  Payments: "bg-accent/15 text-accent-foreground",
  Email:    "bg-chart-3/15 text-chart-3",
  AI:       "bg-chart-4/15 text-chart-4",
  Security: "bg-destructive/15 text-destructive",
  SEO:      "bg-success/15 text-success",
};

export default function LaunchChecklistPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-2">Production Launch Checklist</h1>
      <p className="text-muted-foreground mb-8">
        Complete these steps before going live. Each item maps to an environment variable or infrastructure decision.
      </p>

      <div className="space-y-8">
        {CATEGORIES.map((cat) => (
          <section key={cat}>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">{cat}</h2>
            <div className="rounded-xl border divide-y overflow-hidden">
              {CHECKLIST.filter((c) => c.category === cat).map((item, i) => (
                <div key={i} className="flex gap-4 px-4 py-4">
                  <div className="mt-0.5 w-5 h-5 rounded border-2 border-muted-foreground/30 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{item.label}</span>
                      {item.envKey && (
                        <code className={`text-xs px-1.5 py-0.5 rounded font-mono ${CATEGORY_COLORS[cat] ?? "bg-muted"}`}>
                          {item.envKey}
                        </code>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-10 rounded-xl border border-dashed p-6 text-center text-muted-foreground text-sm">
        <p className="font-medium mb-1">Environment files</p>
        <p>
          Copy <code className="text-xs bg-muted px-1 rounded">.env.example</code> → <code className="text-xs bg-muted px-1 rounded">.env</code> in both{" "}
          <code className="text-xs bg-muted px-1 rounded">apps/api</code> and{" "}
          <code className="text-xs bg-muted px-1 rounded">apps/web</code> and fill in real values before deploying.
        </p>
      </div>
    </div>
  );
}
