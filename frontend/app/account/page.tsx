import type { Metadata } from 'next';
import { ProfileEditor } from '@/components/profile-editor';
import { requirePageSession } from '@/lib/auth-server';
export const metadata: Metadata = { title: 'Tài khoản của tôi | NexCall', robots: { index: false, follow: false } };
export default async function Account() { await requirePageSession('/account'); return <ProfileEditor/>; }
