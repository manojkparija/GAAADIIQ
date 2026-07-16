import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import AuthSessionProvider from "@/components/session-provider";
import Navbar from "@/components/navbar";
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
      <head>
        {/* Prevent dark-mode flash before JS hydrates */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('gaadiiq-theme');if(t==='dark'||(t==null&&window.matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark');document.documentElement.setAttribute('data-theme','dark');}}catch(e){}` }} />
      </head>
      <body className="min-h-full flex flex-col">
          <AuthSessionProvider>
            <Navbar />
            {children}
          </AuthSessionProvider>
        </body>
    </html>
  );
}
