import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TCO Calculator — Total Cost of Ownership | GAADIIQ",
  description: "Estimate the true multi-year cost of owning a car — fuel, insurance, maintenance, and depreciation.",
};

export default function TcoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
