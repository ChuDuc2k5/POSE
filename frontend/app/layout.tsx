import type { Metadata } from "next";
import "./globals.css";
import "./pose.css";
import "./account-ui.css";
import "./catalog.css";
import "./customer.css";
import "./discovery.css";
import "./ai-agent.css";
import "./campaigns.css";
import "./calls.css";
import "./search-filters.css";
import "./nexcall-theme.css";
import { cookies } from 'next/headers';
import { authenticatedSession, ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/page-session';
import { AiChatProvider } from '@/components/ai-chat-provider';
import { EmailSession } from '@/components/email-session';

export const metadata: Metadata = {
  title: "TERAVA Group | Nền tảng bất động sản, dữ liệu & AI",
  description: "TERAVA kết nối thông tin bất động sản, khách hàng và đội ngũ tư vấn trong một không gian làm việc thống nhất.",
  icons: {
    icon: { url: '/brand/terava-icon-navy.svg', type: 'image/svg+xml', sizes: 'any' },
  },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const jar=await cookies();
  const session=jar.has(ACCESS_COOKIE)||jar.has(REFRESH_COOKIE) ? await authenticatedSession():null;
  return (
    <html
      lang="vi"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col"><EmailSession/><AiChatProvider ownerKey={session?.user.id ?? 'guest'}>{children}</AiChatProvider></body>
    </html>
  );
}
