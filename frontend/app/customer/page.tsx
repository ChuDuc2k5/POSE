import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requirePageSession } from '@/lib/page-session';

export const metadata: Metadata = { title: 'Trang chủ khách hàng | TERAVA', robots: { index: false, follow: false } };

export default async function CustomerPage() {
  await requirePageSession('/customer', ['User']);
  redirect('/');
}
