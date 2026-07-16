import type { Metadata } from "next";
import { Cormorant_Garamond, DM_Sans, Geist_Mono } from "next/font/google";
import AuthSessionProvider from "@/components/session-provider";
import Navbar from "@/components/navbar";
import "./globals.css";

const displayFont = Cormorant_Garamond({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const bodyFont = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

const monoFont = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GAADIIQ — India's Premium Automotive Intelligence Platform",
  description: "Discover, compare, and buy cars with AI-powered insights. Real-time valuations, loan comparisons, and curated listings.",
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
      className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable} h-full antialiased`}
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
