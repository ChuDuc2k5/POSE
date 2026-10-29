import type { Metadata } from 'next';
import { AiChatPage } from '@/components/ai-chat-provider';
import { SiteHeader } from '@/components/site-header';
import { publicPageSession } from '@/lib/page-session';

export const metadata: Metadata = {
  title: 'Trợ lý AI TERAVA | Tìm bất động sản',
  description: 'Trò chuyện với trợ lý AI TERAVA để tìm bất động sản phù hợp.',
};

export default async function AiChatPageRoute() {
  const session = await publicPageSession('/tro-ly-ai');
  const role = session?.role ?? null;
  return (
    <>
      <SiteHeader role={role} />
      <AiChatPage ownerKey={session?.user.id ?? 'guest'} signedIn={role === 'User'} />
    </>
  );
}
