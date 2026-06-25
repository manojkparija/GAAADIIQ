"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CURRENT_YEAR = new Date().getFullYear();
const FUEL_TYPES = ["petrol", "diesel", "electric", "cng", "hybrid"];
const TRANSMISSIONS = ["manual", "automatic", "amt", "cvt", "dct"];
const BODY_TYPES = ["hatchback", "sedan", "suv", "muv", "coupe", "convertible"];
const CONDITIONS = ["excellent", "good", "fair", "poor"];

type Step = "car" | "listing";

export default function CreateListingForm() {
  const { data: session } = useSession();
  const router = useRouter();
  const [step, setStep] = useState<Step>("car");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [carId, setCarId] = useState<string | null>(null);

  const [car, setCar] = useState({
    make: "", model: "", variant: "", year: CURRENT_YEAR,
    fuel_type: "petrol", transmission: "manual", body_type: "hatchback",
    engine_cc: "", seating_capacity: "",
  });

  const [listing, setListing] = useState({
    listing_type: "used", price: "", km_driven: "", owners_count: "1",
    condition: "good", city: "", description: "", negotiable: false,
    registration_year: "", registration_state: "",
  });

  const token = (session as { accessToken?: string })?.accessToken ?? "";
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

  async function handleCarSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        make: car.make.trim(),
        model: car.model.trim(),
        year: car.year,
        fuel_type: car.fuel_type,
        transmission: car.transmission,
        body_type: car.body_type,
      };
      if (car.variant.trim()) body.variant = car.variant.trim();
      if (car.engine_cc) body.engine_cc = parseInt(car.engine_cc);
      if (car.seating_capacity) body.seating_capacity = parseInt(car.seating_capacity);

      const res = await fetch(`${apiUrl}/cars`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? "Failed to save car");
      }
      const data = await res.json();
      setCarId(data.id);
      setStep("listing");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleListingSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!carId) return;
    setError("");
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        car_id: carId,
        listing_type: listing.listing_type,
        price: parseInt(listing.price),
        km_driven: listing.km_driven ? parseInt(listing.km_driven) : undefined,
        owners_count: parseInt(listing.owners_count),
        condition: listing.condition,
        city: listing.city.trim() || undefined,
        description: listing.description.trim() || undefined,
        negotiable: listing.negotiable,
        registration_year: listing.registration_year ? parseInt(listing.registration_year) : undefined,
        registration_state: listing.registration_state.trim() || undefined,
      };

      const res = await fetch(`${apiUrl}/listings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? "Failed to create listing");
      }
      const data = await res.json();
      router.push(`/listings/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (step === "car") {
    return (
      <form onSubmit={handleCarSubmit} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="make">Make *</Label>
            <Input id="make" placeholder="e.g. Maruti" required value={car.make}
              onChange={(e) => setCar({ ...car, make: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="model">Model *</Label>
            <Input id="model" placeholder="e.g. Swift" required value={car.model}
              onChange={(e) => setCar({ ...car, model: e.target.value })} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="variant">Variant</Label>
            <Input id="variant" placeholder="e.g. ZXI+" value={car.variant}
              onChange={(e) => setCar({ ...car, variant: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="year">Year *</Label>
            <Input id="year" type="number" min={1980} max={CURRENT_YEAR + 1} required
              value={car.year}
              onChange={(e) => setCar({ ...car, year: parseInt(e.target.value) })} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="fuel">Fuel Type *</Label>
            <select id="fuel" className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              value={car.fuel_type} onChange={(e) => setCar({ ...car, fuel_type: e.target.value })}>
              {FUEL_TYPES.map((f) => <option key={f} value={f} className="capitalize">{f}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tx">Transmission *</Label>
            <select id="tx" className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              value={car.transmission} onChange={(e) => setCar({ ...car, transmission: e.target.value })}>
              {TRANSMISSIONS.map((t) => <option key={t} value={t} className="uppercase">{t.toUpperCase()}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="body">Body Type *</Label>
            <select id="body" className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              value={car.body_type} onChange={(e) => setCar({ ...car, body_type: e.target.value })}>
              {BODY_TYPES.map((b) => <option key={b} value={b} className="capitalize">{b}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="cc">Engine CC</Label>
            <Input id="cc" type="number" placeholder="e.g. 1197" value={car.engine_cc}
              onChange={(e) => setCar({ ...car, engine_cc: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="seats">Seating Capacity</Label>
            <Input id="seats" type="number" min={2} max={9} placeholder="e.g. 5" value={car.seating_capacity}
              onChange={(e) => setCar({ ...car, seating_capacity: e.target.value })} />
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Saving…" : "Next: Listing Details →"}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handleListingSubmit} className="space-y-5">
      <div className="rounded-lg border p-3 bg-muted/30 text-sm text-muted-foreground">
        Car saved. Now add listing details.{" "}
        <button type="button" onClick={() => setStep("car")} className="underline">Edit car</button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="ltype">Listing Type *</Label>
          <select id="ltype" className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            value={listing.listing_type}
            onChange={(e) => setListing({ ...listing, listing_type: e.target.value })}>
            <option value="used">Used</option>
            <option value="new">New</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="price">Asking Price (₹) *</Label>
          <Input id="price" type="number" min={1} required placeholder="e.g. 650000"
            value={listing.price}
            onChange={(e) => setListing({ ...listing, price: e.target.value })} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="km">KM Driven</Label>
          <Input id="km" type="number" min={0} placeholder="e.g. 35000" value={listing.km_driven}
            onChange={(e) => setListing({ ...listing, km_driven: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="owners">No. of Owners</Label>
          <Input id="owners" type="number" min={1} max={10} value={listing.owners_count}
            onChange={(e) => setListing({ ...listing, owners_count: e.target.value })} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="cond">Condition *</Label>
          <select id="cond" className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            value={listing.condition}
            onChange={(e) => setListing({ ...listing, condition: e.target.value })}>
            {CONDITIONS.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="city">City</Label>
          <Input id="city" placeholder="e.g. Bangalore" value={listing.city}
            onChange={(e) => setListing({ ...listing, city: e.target.value })} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="regyear">Registration Year</Label>
          <Input id="regyear" type="number" min={1980} max={CURRENT_YEAR + 1}
            placeholder="e.g. 2020" value={listing.registration_year}
            onChange={(e) => setListing({ ...listing, registration_year: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="regstate">Registration State</Label>
          <Input id="regstate" placeholder="e.g. KA" value={listing.registration_state}
            onChange={(e) => setListing({ ...listing, registration_state: e.target.value })} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="desc">Description</Label>
        <textarea id="desc" rows={3} placeholder="Describe the car's condition, history, modifications…"
          className="w-full border rounded-md px-3 py-2 text-sm bg-background resize-none"
          value={listing.description}
          onChange={(e) => setListing({ ...listing, description: e.target.value })} />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={listing.negotiable}
          onChange={(e) => setListing({ ...listing, negotiable: e.target.checked })}
          className="rounded" />
        Price is negotiable
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Publishing…" : "Publish Listing"}
      </Button>
    </form>
  );
}
