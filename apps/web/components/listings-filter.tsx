"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const FUEL_TYPES = ["petrol", "diesel", "electric", "cng", "hybrid"];
const BODY_TYPES = ["hatchback", "sedan", "suv", "muv", "coupe", "convertible"];

export default function ListingsFilter() {
  const router = useRouter();
  const params = useSearchParams();

  const get = (key: string) => params.get(key) ?? "";

  const update = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      next.delete("page"); // reset to page 1 on filter change
      router.push(`/listings?${next.toString()}`);
    },
    [params, router]
  );

  const clear = () => router.push("/listings");

  return (
    <aside className="w-full md:w-56 shrink-0 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">Filters</h2>
        <button onClick={clear} className="text-xs text-primary hover:underline">
          Clear all
        </button>
      </div>

      {/* Search by make/model */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Make / Model</label>
        <Input
          placeholder="e.g. Swift, Creta"
          defaultValue={get("make") || get("model")}
          onBlur={(e) => update("make", e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && update("make", (e.target as HTMLInputElement).value)}
        />
      </div>

      {/* Listing type */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Type</label>
        <Select value={get("listing_type")} onValueChange={(v) => update("listing_type", v === "all" ? "" : v)}>
          <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="used">Used</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Fuel */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Fuel</label>
        <Select value={get("fuel_type")} onValueChange={(v) => update("fuel_type", v === "all" ? "" : v)}>
          <SelectTrigger><SelectValue placeholder="Any fuel" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any</SelectItem>
            {FUEL_TYPES.map((f) => (
              <SelectItem key={f} value={f} className="capitalize">{f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Body type */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Body type</label>
        <Select value={get("body_type")} onValueChange={(v) => update("body_type", v === "all" ? "" : v)}>
          <SelectTrigger><SelectValue placeholder="Any body" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any</SelectItem>
            {BODY_TYPES.map((b) => (
              <SelectItem key={b} value={b} className="capitalize">{b}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Price range */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Price (₹)</label>
        <div className="flex gap-2">
          <Input
            placeholder="Min"
            type="number"
            defaultValue={get("min_price")}
            onBlur={(e) => update("min_price", e.target.value)}
          />
          <Input
            placeholder="Max"
            type="number"
            defaultValue={get("max_price")}
            onBlur={(e) => update("max_price", e.target.value)}
          />
        </div>
      </div>

      {/* City */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">City</label>
        <Input
          placeholder="Mumbai, Delhi…"
          defaultValue={get("city")}
          onBlur={(e) => update("city", e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && update("city", (e.target as HTMLInputElement).value)}
        />
      </div>

      <Button variant="outline" size="sm" onClick={clear} className="mt-2">
        Reset filters
      </Button>
    </aside>
  );
}
