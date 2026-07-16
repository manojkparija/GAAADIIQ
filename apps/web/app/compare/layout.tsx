import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Compare Cars Side by Side | GAADIIQ",
  description: "Compare up to 3 cars side by side — specs, price, fuel, and more on GAADIIQ.",
};

export default function CompareLayout({ children }: { children: React.ReactNode }) {
  return children;
}
