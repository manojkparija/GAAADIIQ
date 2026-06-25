import type { Listing, ListingFilters, ListingListResponse } from "@/types/listing";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function buildQuery(filters: ListingFilters): string {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  });
  return params.toString() ? `?${params.toString()}` : "";
}

export async function getListings(filters: ListingFilters = {}): Promise<ListingListResponse> {
  return apiFetch<ListingListResponse>(`/listings${buildQuery(filters)}`, {
    next: { revalidate: 30 },
  });
}

export async function getListing(id: string): Promise<Listing> {
  return apiFetch<Listing>(`/listings/${id}`, { next: { revalidate: 0 } });
}
