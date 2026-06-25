import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import AuthSessionProvider from "@/components/session-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GAADIIQ — India's AI-First Automotive Intelligence Platform",
  description: "Discover, compare, and buy cars smarter with AI-powered insights. Get real-time valuations, loan comparisons, and dealer intelligence.",
  keywords: ["cars", "automotive", "AI", "India", "car buying", "used cars"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
          <AuthSessionProvider>{children}</AuthSessionProvider>
        </body>
    </html>
  );
}
