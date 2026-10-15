import type { Metadata } from 'next';
import { requirePageSession } from '@/lib/page-session';
import { readProfile } from '@/lib/page-profile';
import { CustomerHome } from '@/components/customer-home';
import { AiChatPage } from '@/components/ai-chat-provider';

export const metadata: Metadata = { title: 'Trang chủ khách hàng | TERAVA', robots: { index: false, follow: false } };

export default async function CustomerPage() {
  const session = await requirePageSession('/customer', ['User']);
  const profile = await readProfile();
  return <><CustomerHome name={profile.name} role={session.role}/><AiChatPage ownerKey={session.user.id} signedIn/></>;
}
