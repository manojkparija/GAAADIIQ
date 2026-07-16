import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Search Cars | GAADIIQ",
  description: "Search cars by make, model, or city on GAADIIQ.",
};

export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
