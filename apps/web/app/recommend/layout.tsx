import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Car Advisor — Find Your Perfect Car | GAADIIQ",
  description: "Answer a few questions and get personalised car recommendations on GAADIIQ.",
};

export default function RecommendLayout({ children }: { children: React.ReactNode }) {
  return children;
}
