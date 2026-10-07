import type { Metadata } from 'next';
import { requirePageSession } from '@/lib/auth-server';
import { readProfile } from '@/lib/account-server';
import { CustomerHome } from '@/components/customer-home';

export const metadata: Metadata = { title: 'Trang chủ khách hàng | NexCall', robots: { index: false, follow: false } };

export default async function CustomerPage() {
  const session = await requirePageSession('/customer', ['User']);
  const profile = await readProfile(session.access);
  return <CustomerHome name={profile.name} role={session.role}/>;
}
