import { publicPageSession } from '@/lib/page-session';
import { SiteHeader } from '@/components/site-header';
import { InquiryForm } from '@/components/inquiry-form';
import { AiChatPage } from '@/components/ai-chat-provider';
export const metadata = { title: 'Gửi yêu cầu tư vấn | TERAVA', robots: { index: false, follow: false } };
export default async function ConsultationPage() {
  const session = await publicPageSession('/consultation'),
    role = session?.role ?? null;
  return (
    <>
      <SiteHeader role={role} />
      <main className="discovery-main container">
        <InquiryForm guest={role === null} />
      </main>
      <AiChatPage ownerKey={session?.user.id ?? 'guest'} signedIn={role === 'User'} />
    </>
  );
}
