import CreateListingForm from "./create-listing-form";

export const metadata = { title: "Add Listing — GAADIIQ Dashboard" };

export default function NewListingPage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-display font-semibold mb-2">Add a New Listing</h1>
      <p className="text-muted-foreground text-sm mb-8">
        Fill in the car details and we&apos;ll publish your listing to the marketplace.
      </p>
      <CreateListingForm />
    </div>
  );
}
