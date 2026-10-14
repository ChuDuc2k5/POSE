import type { Metadata } from 'next';
import { requirePageSession } from '@/lib/page-session';
import { readProfile } from '@/lib/page-profile';
import { CustomerHome } from '@/components/customer-home';
import { AiChatWidget } from '@/components/ai-chat-widget';

export const metadata: Metadata = { title: 'Trang chủ khách hàng | TERAVA', robots: { index: false, follow: false } };

export default async function CustomerPage() {
  const session = await requirePageSession('/customer', ['User']);
  const profile = await readProfile();
  return <><CustomerHome name={profile.name} role={session.role}/><AiChatWidget signedIn/></>;
}
