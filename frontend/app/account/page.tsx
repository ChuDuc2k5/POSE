import type { Metadata } from 'next';
import { ProfileEditor } from '@/components/profile-editor';
import { requirePageSession } from '@/lib/page-session';
export const metadata: Metadata = { title: 'Tài khoản của tôi | TERAVA', robots: { index: false, follow: false } };
export default async function Account() { await requirePageSession('/account'); return <ProfileEditor/>; }
