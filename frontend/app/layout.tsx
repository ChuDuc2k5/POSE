import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./pose.css";
import "./account-ui.css";
import "./catalog.css";
import "./customer.css";
import "./discovery.css";
import "./nexcall-theme.css";
import { EmailSession } from '@/components/email-session';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NexCall | Quản lý bất động sản & khách hàng",
  description: "NexCall kết nối thông tin bất động sản, khách hàng và đội ngũ tư vấn trong một không gian làm việc thống nhất.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="vi"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col"><EmailSession/>{children}</body>
    </html>
  );
}
