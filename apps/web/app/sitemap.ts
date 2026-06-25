import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://gaadiiq.com";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: `${BASE_URL}/listings`, lastModified: new Date(), changeFrequency: "hourly", priority: 0.9 },
    { url: `${BASE_URL}/login`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
    { url: `${BASE_URL}/register`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
  ];

  let listingRoutes: MetadataRoute.Sitemap = [];
  try {
    const res = await fetch(`${API_URL}/listings?limit=1000&offset=0`, { next: { revalidate: 3600 } });
    if (res.ok) {
      const data = await res.json();
      const listings: Array<{ id: string; updated_at: string }> = data.items ?? data;
      listingRoutes = listings.map((l) => ({
        url: `${BASE_URL}/listings/${l.id}`,
        lastModified: new Date(l.updated_at),
        changeFrequency: "weekly",
        priority: 0.7,
      }));
    }
  } catch {
    // API unavailable at build time — skip dynamic routes
  }

  return [...staticRoutes, ...listingRoutes];
}
