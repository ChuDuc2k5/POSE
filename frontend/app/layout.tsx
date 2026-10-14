import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteHeader } from '@/components/layout/site-header';
import { LanguageProvider } from '@/components/providers/language-provider';
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
  title: "Revoland | Real Estate AI",
  description: "Luxury real-estate platform with AI-powered property discovery and assistant chat",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <LanguageProvider>
          <SiteHeader />
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}
