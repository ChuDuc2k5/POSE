import type { Metadata } from 'next';
import { ProfileEditor } from '@/components/profile-editor';
import { requirePageSession } from '@/lib/page-session';
import { AiChatPage } from '@/components/ai-chat-provider';
export const metadata: Metadata = { title: 'Tài khoản của tôi | TERAVA', robots: { index: false, follow: false } };
export default async function Account() { const session = await requirePageSession('/account'); return <><ProfileEditor/><AiChatPage ownerKey={session.user.id} signedIn={session.role === 'User'}/></>; }
