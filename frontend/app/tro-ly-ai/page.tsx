import type { Metadata } from 'next';
import { AiChatPage } from '@/components/ai-chat-provider';
import { SiteHeader } from '@/components/site-header';
import { publicPageSession } from '@/lib/page-session';

export const metadata: Metadata = {
  title: 'TERAVA AI assistant | Find a property',
  description: 'Chat with the TERAVA AI assistant to find a suitable property.',
};

export default async function AiChatPageRoute() {
  const session = await publicPageSession('/tro-ly-ai');
  const role = session?.role ?? null;
  return <>
    <SiteHeader role={role} />
    <main className="ai-page-main">
      <AiChatPage ownerKey={session?.user.id ?? 'guest'} signedIn={role === 'User'} />
    </main>
  </>;
}
